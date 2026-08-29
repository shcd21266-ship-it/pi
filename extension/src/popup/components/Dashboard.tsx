/**
 * Dashboard.tsx — Display-only component
 *
 * All capture state (stream, video, canvas, timers) now lives in App.tsx.
 * Dashboard receives callbacks and display props, owns NO capture state.
 * This means navigating to Docs/Assistant no longer kills the stream.
 */

import React, { useState, useEffect } from 'react';
import { AppState, BGMessageType, AppStatus, CaptureStats } from '../../types';
import { checkHealth } from '../../services/api';
import { CapturePhase } from '../App';
import {
  Square, Activity, Database, RefreshCw,
  AlertCircle, Loader2, Monitor, CheckCircle, XCircle,
} from 'lucide-react';

interface Props {
  appState:     AppState;
  capturePhase: CapturePhase;
  captureError: string | null;
  captureStats: CaptureStats | null;
  onStartShare: () => void;
  onStopShare:  () => void;
  setActiveTab: (tab: 'dashboard' | 'documents' | 'assistant' | 'settings') => void;
}

function statusLabel(status: AppStatus, phase: CapturePhase): { text: string; color: string } {
  if (phase === 'picker')     return { text: 'Choose what to share…', color: '#f59e0b' };
  if (phase === 'connecting') return { text: 'Starting stream…',       color: '#f59e0b' };
  if (phase === 'capturing') {
    switch (status) {
      case 'detecting':  return { text: 'Detecting question…',  color: '#60a5fa' };
      case 'analyzing':  return { text: 'Analyzing question…',  color: '#a78bfa' };
      case 'answered':   return { text: 'Question answered',    color: '#22c55e' };
      default:           return { text: 'Screen Sharing Active', color: '#22c55e' };
    }
  }
  if (phase === 'error') return { text: 'Error', color: '#ef4444' };
  switch (status) {
    case 'error': return { text: 'Error', color: '#ef4444' };
    default:      return { text: 'Not sharing', color: '#6b7280' };
  }
}

function DebugRow({ label, ok, value }: { label: string; ok: boolean | null; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span className="text-gray-400">{label}</span>
      <span className="flex items-center gap-1" style={{ color: ok === false ? '#ef4444' : '#9ca3af' }}>
        {ok === true  && <CheckCircle size={10} color="#22c55e" />}
        {ok === false && <XCircle     size={10} color="#ef4444" />}
        {value}
      </span>
    </div>
  );
}

const Dashboard: React.FC<Props> = ({
  appState, capturePhase, captureError, captureStats,
  onStartShare, onStopShare, setActiveTab,
}) => {
  const [apiOk, setApiOk] = useState(false);
  useEffect(() => { checkHealth().then(setApiOk); }, []);

  const isCapturing = capturePhase === 'capturing';
  const isBusy      = capturePhase === 'picker' || capturePhase === 'connecting';
  const isError     = capturePhase === 'error';
  const { text: statusText, color: statusColor } = statusLabel(appState.status, capturePhase);

  return (
    <div className="space-y-3">

      {/* Status card */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 shadow-lg">

        {/* Status row */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Activity size={18} className="text-blue-400" /> Status
          </h2>
          <div className="flex items-center gap-2">
            {isBusy
              ? <Loader2 size={12} className="animate-spin" style={{ color: statusColor }} />
              : <span className="w-2 h-2 rounded-full" style={{
                  backgroundColor: statusColor,
                  boxShadow: isCapturing ? `0 0 6px ${statusColor}` : 'none',
                }} />
            }
            <span className="text-xs font-medium" style={{ color: statusColor }}>{statusText}</span>
          </div>
        </div>

        {/* Error box */}
        {isError && captureError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-red-300 font-semibold mb-0.5">Screen share failed</p>
                <p className="text-xs text-red-400 font-mono break-all whitespace-pre-wrap leading-relaxed">{captureError}</p>
              </div>
            </div>
          </div>
        )}

        {/* Picker hint */}
        {capturePhase === 'picker' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-3 text-xs text-amber-300">
            <p className="font-semibold">📺 Chrome picker is open</p>
            <p className="opacity-80 mt-0.5">Select the quiz window or <strong>Entire Screen</strong>.</p>
          </div>
        )}

        {/* Connecting hint */}
        {capturePhase === 'connecting' && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-3 text-xs text-blue-300">
            <Loader2 size={12} className="animate-spin inline mr-1.5" />
            Connecting MediaStream…
          </div>
        )}

        {/* Sharing active hint */}
        {isCapturing && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-3 text-xs text-green-300">
            ✓ Capturing screen — <strong>you can switch tabs freely</strong>, sharing continues.
          </div>
        )}

        {/* Action buttons */}
        {!isCapturing ? (
          <button
            onClick={onStartShare}
            disabled={isBusy}
            className="w-full py-2.5 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
            style={{ background: 'linear-gradient(to right,#2563eb,#4f46e5)', color: 'white' }}
          >
            {isBusy
              ? <><Loader2 size={16} className="animate-spin" /> Starting…</>
              : isError
              ? <><Monitor size={16} /> Try Again</>
              : <><Monitor size={16} /> Start Screen Share</>
            }
          </button>
        ) : (
          <button
            onClick={onStopShare}
            className="w-full py-2.5 px-4 rounded-xl font-medium flex items-center justify-center gap-2"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)' }}
          >
            <Square size={16} fill="currentColor" /> Stop Sharing
          </button>
        )}
      </div>

      {/* Capture stats panel */}
      {(isCapturing || capturePhase === 'connecting') && captureStats && (
        <div className="bg-black/30 border border-white/10 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-300 mb-2">Capture Pipeline</p>
          <div className="space-y-0.5">
            <DebugRow label="Stream"        ok={captureStats.streamConnected}              value={captureStats.streamConnected ? 'CONNECTED ✓' : 'DISCONNECTED'} />
            <DebugRow label="Video Track"   ok={captureStats.trackReadyState === 'live'}   value={captureStats.trackReadyState.toUpperCase()} />
            <DebugRow label="Video Playing" ok={captureStats.videoPlaying}                  value={captureStats.videoPlaying ? 'YES ✓' : 'NO'} />
            <DebugRow label="Resolution"    ok={!captureStats.resolution.startsWith('?')}  value={captureStats.resolution} />
            <DebugRow label="Frames Sampled" ok={captureStats.framesCaptured > 0}          value={String(captureStats.framesCaptured)} />
            <DebugRow label="Frames Sent"   ok={null}                                       value={String(captureStats.framesChanged)} />
          </div>
        </div>
      )}

      {/* Latest answer */}
      <div
        className="bg-white/5 border border-white/10 rounded-2xl p-4 cursor-pointer hover:bg-white/8 transition-colors"
        onClick={() => setActiveTab('assistant')}
      >
        <h2 className="text-xs text-gray-400 mb-1.5">Latest Answer</h2>
        {appState.currentAnswer ? (
          <div className="flex items-center justify-between">
            <div className="text-5xl font-black" style={{
              background: 'linear-gradient(135deg,#60a5fa,#a78bfa)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              {appState.currentAnswer.answer}
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">Confidence</div>
              <div className="text-sm font-semibold" style={{
                color: appState.currentAnswer.confidence === 'High' ? '#22c55e'
                     : appState.currentAnswer.confidence === 'Medium' ? '#eab308' : '#ef4444',
              }}>
                {appState.currentAnswer.confidence}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {appState.currentAnswer.source === 'documents' ? '📄 Docs' : '🧠 AI'}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-gray-500 text-sm italic py-1">
            {isCapturing ? 'Waiting for quiz question…' : 'Start screen sharing to detect questions'}
          </div>
        )}
      </div>

      {/* Bottom stats row */}
      <div className="flex gap-3">
        <div
          onClick={() => setActiveTab('documents')}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 cursor-pointer hover:bg-white/8 transition-colors"
        >
          <Database size={18} className="text-purple-400 mb-1" />
          <div className="text-2xl font-bold">{appState.documents.length}</div>
          <div className="text-xs text-gray-400">Documents</div>
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <button
            onClick={() => {
              if (confirm('Start a new session? This clears the knowledge base.')) {
                chrome.runtime.sendMessage({ type: BGMessageType.NEW_SESSION });
              }
            }}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center justify-center gap-1.5 hover:bg-white/8 transition-colors text-xs"
          >
            <RefreshCw size={14} /> New Session
          </button>
          <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center justify-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: apiOk ? '#22c55e' : '#ef4444' }} />
            {apiOk ? 'Server Online' : 'Server Offline'}
          </div>
        </div>
      </div>

      {!apiOk && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2.5 text-xs text-yellow-300">
          ⚠️ Backend not running. Start with{' '}
          <code className="bg-white/10 px-1 rounded">npm start</code> in{' '}
          <code className="bg-white/10 px-1 rounded">server/</code>.
        </div>
      )}
    </div>
  );
};

export default Dashboard;
