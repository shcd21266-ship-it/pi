/**
 * App.tsx — Root component
 *
 * ALL screen-capture state (stream, video, canvas, timers, phase) lives here
 * so it survives tab navigation. When the user switches from Dashboard → Docs,
 * the capture loop keeps running because App never unmounts.
 *
 * Dashboard receives callbacks (onStartShare, onStopShare) and display props
 * (capturePhase, captureStats, captureError) — it owns NO capture state.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, BGMessageType, BGMessage, CaptureStats } from '../types';
import Dashboard from './components/Dashboard';
import DocumentManager from './components/DocumentManager';
import AnswerPanel from './components/AnswerPanel';
import Settings from './components/Settings';
import { LayoutDashboard, FileText, Crosshair, Settings as SettingsIcon } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'documents' | 'assistant' | 'settings';
export type CapturePhase = 'idle' | 'picker' | 'connecting' | 'capturing' | 'error';

// ─── Capture config ───────────────────────────────────────────────────────────

const HASH_GRID        = 32;
const DIFF_THRESHOLD   = 0.18;
const MIN_SEND_MS      = 600;
const CAPTURE_INTERVAL = 300;
const STATS_INTERVAL   = 1500;
const MAX_WIDTH        = 960;

// ─── Perceptual hash utils ────────────────────────────────────────────────────

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

// ─── Tab button ───────────────────────────────────────────────────────────────

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dot?: boolean;
}> = ({ active, onClick, children, dot }) => (
  <button
    onClick={onClick}
    className={[
      'flex flex-col items-center p-2 rounded-lg transition-colors relative',
      active ? 'text-blue-400 bg-white/5' : 'text-gray-400 hover:text-gray-200',
    ].join(' ')}
  >
    {children}
    {dot && (
      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400"
            style={{ boxShadow: '0 0 4px #22c55e' }} />
    )}
  </button>
);

// ─── App ──────────────────────────────────────────────────────────────────────

const defaultAppState: AppState = {
  sessionId: Date.now().toString(16) + Math.random().toString(16).substring(2, 8),
  isScreenSharing: false,
  documents: [],
  status: 'idle',
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [appState, setAppState]   = useState<AppState>(defaultAppState);

  // ── Capture state (survives tab switches) ─────────────────────────────────
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureStats, setCaptureStats] = useState<CaptureStats | null>(null);

  // Refs for media elements and timers
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const capTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevHash    = useRef('');
  const lastSentMs  = useRef(0);
  const framesCap   = useRef(0);
  const framesChg   = useRef(0);
  const lastFrameAt = useRef(0);
  const appStateRef = useRef<AppState>(defaultAppState);
  appStateRef.current = appState;

  // ── Background state sync ─────────────────────────────────────────────────
  useEffect(() => {
    chrome.runtime.sendMessage({ type: BGMessageType.GET_STATE }, (res) => {
      if (res?.success && res.data) setAppState(res.data);
    });
    const listener = (message: BGMessage) => {
      if (message.type === BGMessageType.STATE_UPDATED && message.payload) {
        setAppState(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Cleanup on unmount (popup window closed) ──────────────────────────────
  useEffect(() => () => { stopCapture(false); }, []);

  // ── Frame capture loop ────────────────────────────────────────────────────

  const captureFrame = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;
    if (video.paused || video.ended || video.readyState < 2) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch { return; }

    framesCap.current++;
    lastFrameAt.current = Date.now();

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hash      = computePHash(imageData);
    const diff      = comparePHash(hash, prevHash.current);
    const now       = Date.now();
    const timeSinceLastSend = now - lastSentMs.current;

    const currentStatus = appStateRef.current?.status;
    const hasAnswer = Boolean(appStateRef.current?.currentAnswer);
    const isAnalyzing = currentStatus === 'analyzing';
    const isDetecting = currentStatus === 'detecting' || !hasAnswer;

    // Do not overload while backend is currently processing a frame
    if (isAnalyzing && timeSinceLastSend < 2500) return;

    // Send frame if:
    // 1. First frame ever
    // 2. Significant visual change (diff > DIFF_THRESHOLD) and min debounce interval passed (600ms)
    // 3. Waiting for a question and 2500ms passed
    const shouldSend = !prevHash.current ||
                       (diff > DIFF_THRESHOLD && timeSinceLastSend >= MIN_SEND_MS) ||
                       (isDetecting && timeSinceLastSend >= 2500);

    if (!shouldSend) return;

    framesChg.current++;
    prevHash.current   = hash;
    lastSentMs.current = now;

    // Lightweight 0.7 JPEG at 960px (~35KB) for lightning-fast network & AI transfer
    chrome.runtime.sendMessage({
      type: BGMessageType.FRAME_CHANGED,
      payload: { imageData: canvas.toDataURL('image/jpeg', 0.7), mimeType: 'image/jpeg' },
    }).catch(() => {});
  }, []);

  const sendStats = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    const stream = streamRef.current;
    if (!stream || !video || !canvas) return;
    const track = stream.getVideoTracks()[0];
    const s: CaptureStats = {
      streamConnected: true,
      trackReadyState: track?.readyState ?? 'unknown',
      videoPlaying:    !video.paused && !video.ended,
      resolution:      `${canvas.width}×${canvas.height}`,
      framesCaptured:  framesCap.current,
      framesChanged:   framesChg.current,
      lastFrameMs:     lastFrameAt.current ? Date.now() - lastFrameAt.current : 0,
    };
    setCaptureStats(s);
    chrome.runtime.sendMessage({ type: BGMessageType.CAPTURE_STATS, payload: s }).catch(() => {});
  }, []);

  // ── stopCapture ───────────────────────────────────────────────────────────

  const stopCapture = useCallback((notifyBg = true) => {
    if (capTimer.current)   { clearInterval(capTimer.current);   capTimer.current   = null; }
    if (statsTimer.current) { clearInterval(statsTimer.current); statsTimer.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
    prevHash.current = ''; lastSentMs.current = 0;
    framesCap.current = 0; framesChg.current = 0; lastFrameAt.current = 0;
    setCaptureStats(null);
    setCapturePhase('idle');
    setCaptureError(null);
    if (notifyBg) chrome.runtime.sendMessage({ type: BGMessageType.STOP_SCREEN_SHARE }).catch(() => {});
  }, []);

  // ── startShare ────────────────────────────────────────────────────────────
  // Called by Dashboard button. MUST be triggered by a user gesture (click).

  const startShare = useCallback(() => {
    console.log('[App] Start Screen Share');
    setCapturePhase('picker');
    setCaptureError(null);

    // STEP 1: Show Chrome's source picker.
    // chooseDesktopMedia MUST be called synchronously in a click handler.
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen', 'window', 'tab'],
      async (streamId: string) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message ?? 'Picker error';
          setCaptureError(msg); setCapturePhase('error'); return;
        }
        if (!streamId) { setCapturePhase('idle'); return; } // user cancelled

        setCapturePhase('connecting');

        // STEP 2: getUserMedia — SAME context (critical for chromeMediaSourceId)
        const tryGet = (source: 'desktop' | 'tab') =>
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { // @ts-ignore
              mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId },
            },
          });

        let stream: MediaStream | null = null;
        try {
          stream = await tryGet('desktop');
        } catch (e1: any) {
          try { stream = await tryGet('tab'); }
          catch (e2: any) {
            const msg = `getUserMedia failed.\ndesktop: ${e1.name}: ${e1.message}\ntab: ${e2.name}: ${e2.message}`;
            setCaptureError(msg); setCapturePhase('error');
            chrome.runtime.sendMessage({ type: BGMessageType.SCREEN_SHARE_ERROR, payload: { error: msg } }).catch(() => {});
            return;
          }
        }

        // STEP 3: Verify live track
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState !== 'live') {
          setCaptureError('No live video track'); setCapturePhase('error');
          stream.getTracks().forEach(t => t.stop()); return;
        }
        track.onended = () => { console.log('[App] Track ended'); stopCapture(true); };

        // STEP 4: Attach to hidden video
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) {
          setCaptureError('Video elements not ready'); setCapturePhase('error');
          stream.getTracks().forEach(t => t.stop()); return;
        }

        video.srcObject = stream;
        streamRef.current = stream;

        try {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('Video load timeout (8s)')), 8000);
            video.onloadedmetadata = () => {
              video.play().then(() => { clearTimeout(t); resolve(); }).catch(e => { clearTimeout(t); reject(e); });
            };
            video.onerror = () => { clearTimeout(t); reject(new Error(video.error?.message ?? 'Video error')); };
          });
        } catch (e: any) {
          setCaptureError('Video start failed: ' + e.message); setCapturePhase('error');
          stream.getTracks().forEach(t => t.stop()); return;
        }

        // STEP 5: Size canvas
        if (!video.videoWidth || !video.videoHeight) {
          setCaptureError('Video has zero dimensions'); setCapturePhase('error');
          stream.getTracks().forEach(t => t.stop()); return;
        }
        canvas.width  = Math.min(MAX_WIDTH, video.videoWidth);
        canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);

        // STEP 6: Confirm first frame
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        framesCap.current = 1;
        lastFrameAt.current = Date.now();

        // STEP 7: Notify background
        const initStats: CaptureStats = {
          streamConnected: true,
          trackReadyState: track.readyState,
          videoPlaying:    true,
          resolution:      `${video.videoWidth}×${video.videoHeight}`,
          framesCaptured:  1,
          framesChanged:   0,
          lastFrameMs:     0,
        };
        chrome.runtime.sendMessage({ type: BGMessageType.STREAM_STARTED, payload: initStats }).catch(() => {});
        setCaptureStats(initStats);
        setCapturePhase('capturing');
        console.log('[App] ✓ Capture live —', initStats.resolution);

        // STEP 8: Start loops
        prevHash.current = ''; lastSentMs.current = 0; framesChg.current = 0;
        capTimer.current   = setInterval(captureFrame, CAPTURE_INTERVAL);
        statsTimer.current = setInterval(sendStats,    STATS_INTERVAL);
      },
    );
  }, [captureFrame, sendStats, stopCapture]);

  // ── Render ────────────────────────────────────────────────────────────────
  const isCapturing = capturePhase === 'capturing';

  return (
    <>
      {/* Hidden capture elements — always mounted, survive tab switches */}
      <video
        ref={videoRef}
        autoPlay muted playsInline
        style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      <div className="flex flex-col h-screen w-full bg-gradient-to-b from-[#0a0a1e] to-[#0f0f2e]">
        <div className="flex-1 overflow-y-auto p-4 pb-20">
          {activeTab === 'dashboard' && (
            <Dashboard
              appState={appState}
              capturePhase={capturePhase}
              captureError={captureError}
              captureStats={captureStats}
              onStartShare={startShare}
              onStopShare={() => stopCapture(true)}
              setActiveTab={setActiveTab}
            />
          )}
          {activeTab === 'documents' && <DocumentManager appState={appState} />}
          {activeTab === 'assistant' && <AnswerPanel appState={appState} />}
          {activeTab === 'settings'  && <Settings />}
        </div>

        {/* Bottom tab bar */}
        <div className="fixed bottom-0 w-full bg-[#0f0f2e]/90 backdrop-blur-md border-t border-white/10 p-2 flex justify-around">
          <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>
            <LayoutDashboard size={20} />
            <span className="text-[10px] mt-1">Dashboard</span>
          </TabButton>
          <TabButton active={activeTab === 'documents'} onClick={() => setActiveTab('documents')}>
            <FileText size={20} />
            <span className="text-[10px] mt-1">Docs</span>
          </TabButton>
          <TabButton active={activeTab === 'assistant'} onClick={() => setActiveTab('assistant')}>
            <Crosshair size={20} />
            <span className="text-[10px] mt-1">Assistant</span>
          </TabButton>
          <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} dot={isCapturing}>
            <SettingsIcon size={20} />
            <span className="text-[10px] mt-1">Settings</span>
          </TabButton>
        </div>
      </div>
    </>
  );
};

export default App;
