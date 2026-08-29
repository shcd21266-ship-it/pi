/**
 * capture.ts — Runs inside a small background window (chrome.windows.create).
 *
 * Why a real window instead of an offscreen document:
 *   Offscreen documents cannot call getUserMedia() with chromeMediaSource:'desktop'
 *   or 'tab' — Chrome blocks it because offscreen docs lack a full browsing context.
 *   A regular extension page opened via chrome.windows.create() has full context
 *   and can successfully call getUserMedia with any constraints.
 *
 * Flow:
 *   1. background.ts creates this window with ?streamId=... in the URL
 *   2. This script reads the streamId from location.search on load
 *   3. Calls getUserMedia({ chromeMediaSourceId: streamId })
 *   4. Video plays → canvas samples frames every second
 *   5. On significant change → sends FRAME_CHANGED to background
 *   6. Sends CAPTURE_STATS every 2s for the debug panel
 */

import { BGMessageType, CaptureStats } from '../types';

// ─── Config ───────────────────────────────────────────────────────────────────

const HASH_GRID        = 32;
const DIFF_THRESHOLD   = 10;
const MIN_SEND_MS      = 2000;
const CAPTURE_INTERVAL = 1000;
const STATS_INTERVAL   = 2000;
const MAX_WIDTH        = 1280;

// ─── State ────────────────────────────────────────────────────────────────────

let stream: MediaStream | null = null;
let captureTimer: ReturnType<typeof setInterval> | null = null;
let statsTimer:   ReturnType<typeof setInterval> | null = null;

let prevHash      = '';
let lastSentMs    = 0;
let framesCap     = 0;
let framesChanged = 0;
let lastFrameAt   = 0;

const video  = document.getElementById('captureVideo')  as HTMLVideoElement;
const canvas = document.getElementById('captureCanvas') as HTMLCanvasElement;
const ctx    = canvas.getContext('2d', { willReadFrequently: true })!;

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
  const params   = new URLSearchParams(location.search);
  const streamId = params.get('streamId');

  if (!streamId) {
    console.error('[Capture] No streamId in URL — cannot start');
    return;
  }

  console.log('[Capture] Starting with streamId:', streamId.substring(0, 16) + '…');
  await startCapture(streamId);
})();

// ─── Message listener (for STOP_CAPTURE and REANALYZE from background) ────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === BGMessageType.STATE_UPDATED) return false;

  if (message.type === BGMessageType.STOP_CAPTURE) {
    stopCapture();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === BGMessageType.REANALYZE) {
    prevHash = '';
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// ─── Capture lifecycle ────────────────────────────────────────────────────────

async function startCapture(streamId: string): Promise<void> {
  // ── getUserMedia ───────────────────────────────────────────────────────────
  // Try 'desktop' source (screens, windows) first, fall back to 'tab' source.
  const tryGet = (source: 'desktop' | 'tab') =>
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // @ts-ignore — Chromium-specific constraint
        mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId },
      },
    });

  try {
    stream = await tryGet('desktop');
    console.log('[Capture] getUserMedia OK (desktop)');
  } catch (e1: any) {
    console.warn('[Capture] desktop failed:', e1.message, '— trying tab…');
    try {
      stream = await tryGet('tab');
      console.log('[Capture] getUserMedia OK (tab)');
    } catch (e2: any) {
      const msg = `getUserMedia failed.\ndesktop: ${e1.name}: ${e1.message}\ntab: ${e2.name}: ${e2.message}`;
      reportError(msg);
      return;
    }
  }

  // ── Verify track ───────────────────────────────────────────────────────────
  const tracks = stream.getVideoTracks();
  if (!tracks.length || tracks[0].readyState !== 'live') {
    reportError('No live video track in MediaStream');
    return;
  }

  const track = tracks[0];
  console.log('[Capture] track:', track.kind, track.readyState, track.label);

  tracks[0].onended = () => {
    console.log('[Capture] Track ended — user stopped sharing');
    stopCapture();
    chrome.runtime.sendMessage({ type: BGMessageType.STOP_SCREEN_SHARE }).catch(() => {});
  };

  // ── Attach to video element ────────────────────────────────────────────────
  video.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Video load timed out after 8s')), 8000);
    video.onloadedmetadata = () => {
      video.play()
        .then(() => { clearTimeout(t); resolve(); })
        .catch(e => { clearTimeout(t); reject(e); });
    };
    video.onerror = () => { clearTimeout(t); reject(new Error(video.error?.message ?? 'Video error')); };
  });

  // ── Canvas setup ───────────────────────────────────────────────────────────
  if (!video.videoWidth || !video.videoHeight) {
    reportError('Video dimensions are 0 — stream appears empty');
    return;
  }

  canvas.width  = Math.min(MAX_WIDTH, video.videoWidth);
  canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
  console.log(`[Capture] Canvas: ${canvas.width}×${canvas.height}`);

  // ── First frame check ─────────────────────────────────────────────────────
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  framesCap++;
  lastFrameAt = Date.now();

  // ── Notify background stream is live ──────────────────────────────────────
  const initStats: CaptureStats = {
    streamConnected: true,
    trackReadyState: track.readyState,
    videoPlaying: !video.paused,
    resolution: `${video.videoWidth}×${video.videoHeight}`,
    framesCaptured: framesCap,
    framesChanged: 0,
    lastFrameMs: 0,
  };
  chrome.runtime.sendMessage({ type: BGMessageType.STREAM_STARTED, payload: initStats }).catch(() => {});
  console.log('[Capture] ✓ Pipeline live —', initStats.resolution);

  // ── Start loops ────────────────────────────────────────────────────────────
  prevHash   = '';
  lastSentMs = 0;
  captureTimer = setInterval(captureFrame, CAPTURE_INTERVAL);
  statsTimer   = setInterval(sendStats, STATS_INTERVAL);
}

function stopCapture(): void {
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  if (statsTimer)   { clearInterval(statsTimer);   statsTimer   = null; }
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  prevHash = ''; framesCap = 0; framesChanged = 0; lastFrameAt = 0; lastSentMs = 0;
  console.log('[Capture] Stopped');
}

// ─── Frame capture ────────────────────────────────────────────────────────────

function captureFrame(): void {
  if (!stream || video.paused || video.ended || video.readyState < 2) return;

  try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch { return; }

  framesCap++;
  lastFrameAt = Date.now();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const hash      = computePHash(imageData);
  const diff      = comparePHash(hash, prevHash);

  if (prevHash && diff <= DIFF_THRESHOLD) return;

  const now = Date.now();
  if (prevHash && now - lastSentMs < MIN_SEND_MS) return;

  framesChanged++;
  console.log(`[Capture] Frame #${framesCap} changed (diff=${diff.toFixed(2)})`);

  prevHash   = hash;
  lastSentMs = now;

  chrome.runtime.sendMessage({
    type: BGMessageType.FRAME_CHANGED,
    payload: { imageData: canvas.toDataURL('image/jpeg', 0.85), mimeType: 'image/jpeg' },
  }).catch(e => console.warn('[Capture] FRAME_CHANGED error:', e));
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function sendStats(): void {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  chrome.runtime.sendMessage({
    type: BGMessageType.CAPTURE_STATS,
    payload: {
      streamConnected: !!stream,
      trackReadyState: track?.readyState ?? 'unknown',
      videoPlaying: !video.paused && !video.ended,
      resolution: `${canvas.width}×${canvas.height}`,
      framesCaptured: framesCap,
      framesChanged,
      lastFrameMs: lastFrameAt ? Date.now() - lastFrameAt : 0,
    } as CaptureStats,
  }).catch(() => {});
}

function reportError(msg: string): void {
  console.error('[Capture]', msg);
  chrome.runtime.sendMessage({
    type: BGMessageType.SCREEN_SHARE_ERROR,
    payload: { error: msg },
  }).catch(() => {});
}

// ─── Perceptual hash ─────────────────────────────────────────────────────────

function computePHash(d: ImageData): string {
  const { data, width, height } = d;
  const sx = Math.max(1, Math.floor(width  / HASH_GRID));
  const sy = Math.max(1, Math.floor(height / HASH_GRID));
  let h = '';
  for (let gy = 0; gy < HASH_GRID; gy++)
    for (let gx = 0; gx < HASH_GRID; gx++) {
      const i = ((gy * sy) * width + (gx * sx)) * 4;
      h += (data[i]   >> 4).toString(16);
      h += (data[i+1] >> 4).toString(16);
      h += (data[i+2] >> 4).toString(16);
    }
  return h;
}

function comparePHash(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 15;
  let t = 0;
  for (let i = 0; i < a.length; i++) t += Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16));
  return t / a.length;
}
