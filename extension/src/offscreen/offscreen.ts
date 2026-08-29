/**
 * offscreen.ts — Offscreen Document (USER_MEDIA reason)
 *
 * Start-up flow:
 *   1. Script loads → reads streamId from chrome.storage.session ('offscreenStreamId')
 *   2. Calls getUserMedia({ chromeMediaSource:'desktop', chromeMediaSourceId })
 *   3. Attaches stream to <video>, waits for playback
 *   4. Sends STREAM_STARTED to background
 *   5. Frame capture loop runs, sends FRAME_CHANGED on visual change
 *   6. Sends CAPTURE_STATS every 2 s for the debug panel
 *
 * Also handles INIT_STREAM message (for when the offscreen doc already exists
 * and background sends a new streamId directly).
 */

import { BGMessage, BGMessageType, CaptureStats } from '../types';

// ─── Config ───────────────────────────────────────────────────────────────────

const HASH_GRID        = 32;
const DIFF_THRESHOLD   = 10;   // nibble diff threshold (0–15 scale)
const MIN_SEND_MS      = 2000; // minimum ms between frame sends
const CAPTURE_INTERVAL = 1000; // sampling interval ms
const STATS_INTERVAL   = 2000; // debug stats broadcast interval ms
const MAX_WIDTH        = 1280;

// ─── State ────────────────────────────────────────────────────────────────────

let video: HTMLVideoElement;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

let stream: MediaStream | null = null;
let captureTimer: ReturnType<typeof setInterval> | null = null;
let statsTimer:   ReturnType<typeof setInterval> | null = null;

let prevHash      = '';
let lastSentMs    = 0;
let framesCap     = 0;
let framesChanged = 0;
let lastFrameAt   = 0;

// ─── Boot: read streamId from URL parameter and start capture ────────────────
//
// Background passes the streamId as ?streamId=... in the offscreen document URL.
// Reading location.search requires no Chrome APIs and has no timing race.

(async function boot() {
  try {
    const params   = new URLSearchParams(location.search);
    const streamId = params.get('streamId');

    if (streamId) {
      console.log('[Offscreen] boot: streamId from URL param, starting capture');
      await startCapture(streamId);
    } else {
      console.log('[Offscreen] boot: no streamId in URL, waiting for INIT_STREAM message');
    }
  } catch (e) {
    console.error('[Offscreen] boot error:', e);
    reportError('Boot error: ' + String(e));
  }
})();

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: BGMessage, _sender, sendResponse) => {
  // Ignore broadcasts not meant for this context
  if (message.type === BGMessageType.STATE_UPDATED) return false;

  if (message.type === BGMessageType.INIT_STREAM) {
    const { streamId } = message.payload as { streamId: string };
    console.log('[Offscreen] INIT_STREAM message received, streamId:', streamId.substring(0, 16) + '…');
    startCapture(streamId)
      .then(() => sendResponse({ success: true }))
      .catch((e: any) => {
        console.error('[Offscreen] INIT_STREAM startCapture failed:', e?.message ?? e);
        sendResponse({ success: false, error: e?.message ?? String(e) });
      });
    return true;
  }

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
  stopCapture(); // clean up any previous session

  video  = document.getElementById('captureVideo')  as HTMLVideoElement;
  canvas = document.getElementById('captureCanvas') as HTMLCanvasElement;
  const _ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!video || !canvas || !_ctx) {
    throw new Error('Required DOM elements not found in offscreen document');
  }
  ctx = _ctx;

  // ── getUserMedia with desktop capture constraints ─────────────────────────
  //
  // chromeMediaSource:'desktop' works for screen and window sources.
  // chromeMediaSource:'tab' is needed when the user chose a browser tab.
  // We try 'desktop' first, then fall back to 'tab' on AbortError.
  console.log('[Offscreen] Calling getUserMedia with streamId:', streamId.substring(0, 16) + '…');

  const tryGetUserMedia = async (source: 'desktop' | 'tab'): Promise<MediaStream> => {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // @ts-ignore — Chromium-specific constraint not in TypeScript typedefs
        mandatory: {
          chromeMediaSource:   source,
          chromeMediaSourceId: streamId,
        },
      },
    });
  };

  try {
    stream = await tryGetUserMedia('desktop');
    console.log('[Offscreen] getUserMedia succeeded with chromeMediaSource:desktop');
  } catch (desktopErr: any) {
    if (desktopErr?.name === 'AbortError') {
      // AbortError often means the source is a browser tab — retry with 'tab'
      console.warn('[Offscreen] desktop source failed, retrying with tab source…', desktopErr.message);
      try {
        stream = await tryGetUserMedia('tab');
        console.log('[Offscreen] getUserMedia succeeded with chromeMediaSource:tab');
      } catch (tabErr: any) {
        const msg = `getUserMedia failed for both desktop and tab sources.\n` +
                    `desktop error: ${desktopErr?.name}: ${desktopErr?.message}\n` +
                    `tab error: ${tabErr?.name}: ${tabErr?.message}`;
        reportError(msg);
        throw new Error(msg);
      }
    } else {
      const msg = `getUserMedia failed — ${desktopErr?.name ?? 'Error'}: ${desktopErr?.message ?? desktopErr}`;
      reportError(msg);
      throw new Error(msg);
    }
  }

  // ── Verify live video track ────────────────────────────────────────────────
  const tracks = stream.getVideoTracks();
  if (tracks.length === 0) {
    const msg = 'MediaStream has no video tracks';
    reportError(msg);
    throw new Error(msg);
  }

  const track = tracks[0];
  console.log(`[Offscreen] Track — kind:${track.kind} readyState:${track.readyState} label:"${track.label}"`);

  if (track.readyState !== 'live') {
    const msg = `Video track readyState="${track.readyState}", expected "live"`;
    reportError(msg);
    throw new Error(msg);
  }

  // ── Attach stream to video element ─────────────────────────────────────────
  video.srcObject = stream;

  track.onended = () => {
    console.log('[Offscreen] Track ended — user stopped sharing via Chrome toolbar');
    stopCapture();
    chrome.runtime.sendMessage({ type: BGMessageType.STOP_SCREEN_SHARE }).catch(() => {});
  };

  // ── Wait for video to play ─────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Video did not start playing within 8 s')),
      8000,
    );

    video.onloadedmetadata = () => {
      console.log(`[Offscreen] Video metadata loaded: ${video.videoWidth}×${video.videoHeight}`);
      video.play()
        .then(() => { clearTimeout(timeout); resolve(); })
        .catch((e: any) => {
          clearTimeout(timeout);
          reject(new Error('video.play() failed: ' + (e?.message ?? String(e))));
        });
    };

    video.onerror = () => {
      clearTimeout(timeout);
      const msg = video.error?.message ?? 'unknown video element error';
      reject(new Error('HTMLVideoElement error: ' + msg));
    };
  });

  // ── Configure canvas ───────────────────────────────────────────────────────
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    const msg = 'Video dimensions are 0×0 — stream appears empty';
    reportError(msg);
    throw new Error(msg);
  }

  const aspect = video.videoWidth / video.videoHeight;
  canvas.width  = Math.min(MAX_WIDTH, video.videoWidth);
  canvas.height = Math.round(canvas.width / aspect);

  console.log(`[Offscreen] Canvas: ${canvas.width}×${canvas.height}`);

  // ── Capture first frame to verify pixels are arriving ─────────────────────
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  framesCap++;
  lastFrameAt = Date.now();

  // ── Notify background that stream is confirmed live ────────────────────────
  const initStats: CaptureStats = {
    streamConnected: true,
    trackReadyState: track.readyState,
    videoPlaying:    !video.paused,
    resolution:      `${video.videoWidth}×${video.videoHeight}`,
    framesCaptured:  framesCap,
    framesChanged:   0,
    lastFrameMs:     0,
  };

  chrome.runtime.sendMessage({ type: BGMessageType.STREAM_STARTED, payload: initStats })
    .catch(() => {});

  console.log(`[Offscreen] ✓ Capture pipeline live — ${initStats.resolution}`);

  // ── Start loops ────────────────────────────────────────────────────────────
  prevHash   = '';
  lastSentMs = 0;
  captureTimer = setInterval(captureFrame, CAPTURE_INTERVAL);
  statsTimer   = setInterval(sendStats, STATS_INTERVAL);
}

function stopCapture(): void {
  if (captureTimer !== null) { clearInterval(captureTimer); captureTimer = null; }
  if (statsTimer   !== null) { clearInterval(statsTimer);   statsTimer   = null; }

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (video) {
    video.pause();
    video.srcObject = null;
  }

  prevHash      = '';
  framesCap     = 0;
  framesChanged = 0;
  lastFrameAt   = 0;
  lastSentMs    = 0;
  console.log('[Offscreen] Capture stopped, resources released');
}

// ─── Frame capture ────────────────────────────────────────────────────────────

function captureFrame(): void {
  if (!stream || !video || !canvas || !ctx) return;
  if (video.paused || video.ended || video.readyState < 2) return;

  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch {
    return;
  }

  framesCap++;
  lastFrameAt = Date.now();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const hash      = computePHash(imageData);
  const diff      = comparePHash(hash, prevHash);

  if (prevHash !== '' && diff <= DIFF_THRESHOLD) return;

  const now = Date.now();
  if (prevHash !== '' && now - lastSentMs < MIN_SEND_MS) return;

  framesChanged++;
  console.log(`[Offscreen] Frame #${framesCap} changed (diff=${diff.toFixed(2)}) — sending`);

  prevHash   = hash;
  lastSentMs = now;

  const jpeg = canvas.toDataURL('image/jpeg', 0.85);
  chrome.runtime.sendMessage({
    type: BGMessageType.FRAME_CHANGED,
    payload: { imageData: jpeg, mimeType: 'image/jpeg' },
  }).catch((e) => {
    console.warn('[Offscreen] FRAME_CHANGED send error:', e);
  });
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function sendStats(): void {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  const stats: CaptureStats = {
    streamConnected: !!stream,
    trackReadyState: track?.readyState ?? 'unknown',
    videoPlaying:    !video.paused && !video.ended,
    resolution:      canvas ? `${canvas.width}×${canvas.height}` : '?×?',
    framesCaptured:  framesCap,
    framesChanged,
    lastFrameMs:     lastFrameAt ? Date.now() - lastFrameAt : 0,
  };
  chrome.runtime.sendMessage({ type: BGMessageType.CAPTURE_STATS, payload: stats }).catch(() => {});
}

// ─── Error reporting ─────────────────────────────────────────────────────────

function reportError(msg: string): void {
  console.error('[Offscreen]', msg);
  chrome.runtime.sendMessage({
    type: BGMessageType.SCREEN_SHARE_ERROR,
    payload: { error: msg },
  }).catch(() => {});
}

// ─── Perceptual hash ─────────────────────────────────────────────────────────

function computePHash(imageData: ImageData): string {
  const { data, width, height } = imageData;
  const stepX = Math.max(1, Math.floor(width  / HASH_GRID));
  const stepY = Math.max(1, Math.floor(height / HASH_GRID));
  let hash = '';
  for (let gy = 0; gy < HASH_GRID; gy++) {
    for (let gx = 0; gx < HASH_GRID; gx++) {
      const i = ((gy * stepY) * width + (gx * stepX)) * 4;
      hash += (data[i]   >> 4).toString(16);
      hash += (data[i+1] >> 4).toString(16);
      hash += (data[i+2] >> 4).toString(16);
    }
  }
  return hash;
}

function comparePHash(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 15;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16));
  }
  return total / a.length;
}
