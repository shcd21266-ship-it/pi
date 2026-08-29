/**
 * background.ts — Service Worker
 *
 * KEY ARCHITECTURE DECISION:
 * ──────────────────────────────────────────────────────────────────────────
 * Chrome extension popups close the instant they lose focus — destroying any
 * MediaStream inside them. A quiz assistant that needs to capture the screen
 * continuously while the user is on a quiz page CANNOT use a popup.
 *
 * Solution: when the user clicks the extension icon, background opens a
 * PERSISTENT WINDOW (chrome.windows.create, type:'popup') instead of the
 * browser's temporary popup. This window:
 *   - Stays open when the user focuses on the quiz tab
 *   - Can call chooseDesktopMedia + getUserMedia directly (user gesture)
 *   - Survives until the user explicitly closes it
 *
 * The same window is reused on subsequent icon clicks (it is focused, not
 * re-created).
 * ──────────────────────────────────────────────────────────────────────────
 */

import { AppState, BGMessage, BGMessageType, AnswerResult, CaptureStats } from '../types';
import { analyzeFrame, listDocuments } from '../services/api';

// ─── Persistent window tracking ───────────────────────────────────────────────

let quizWindowId: number | null = null;

async function openOrFocusWindow(): Promise<void> {
  // Try to focus existing window first
  if (quizWindowId !== null) {
    try {
      await chrome.windows.update(quizWindowId, { focused: true });
      console.log('[BG] Focused existing quiz window:', quizWindowId);
      return;
    } catch {
      // Window no longer exists
      quizWindowId = null;
    }
  }

  // Open a new persistent window
  const url = chrome.runtime.getURL('src/popup/index.html');
  console.log('[BG] Opening persistent quiz window:', url);
  const win = await chrome.windows.create({
    url,
    type:    'popup',
    width:   420,
    height:  680,
    focused: true,
    top:     50,
    left:    50,
  });
  quizWindowId = win?.id ?? null;
  console.log('[BG] Quiz window created, id:', quizWindowId);
}

// When the user clicks the extension icon, open/focus the persistent window
chrome.action.onClicked.addListener(() => {
  openOrFocusWindow().catch(e => console.error('[BG] openOrFocusWindow error:', e));
});

// Track window close so next click creates a fresh one
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === quizWindowId) {
    console.log('[BG] Quiz window closed');
    quizWindowId = null;
    // Reset sharing state — stream died with the window
    updateState({
      isScreenSharing: false,
      status: 'idle',
      streamId: undefined,
      captureStats: undefined,
    });
  }
});

// ─── App state ────────────────────────────────────────────────────────────────

let currentState: AppState = {
  sessionId: generateSessionId(),
  isScreenSharing: false,
  documents: [],
  status: 'idle',
};

function generateSessionId(): string {
  return Date.now().toString(16) + Math.random().toString(16).substring(2, 10);
}

async function updateState(patch: Partial<AppState>): Promise<void> {
  currentState = { ...currentState, ...patch };
  try { await chrome.storage.session.set({ appState: currentState }); } catch { /* non-fatal */ }
  broadcastState();
}

async function loadState(): Promise<void> {
  try {
    const result = await chrome.storage.session.get('appState');
    if (result.appState) {
      currentState = result.appState;
      if (currentState.isScreenSharing || currentState.status !== 'idle') {
        currentState = {
          ...currentState,
          isScreenSharing: false,
          status: 'idle',
          streamId: undefined,
          captureStats: undefined,
          error: undefined,
        };
      }
    }
  } catch { /* ignore */ }
}

function broadcastState(): void {
  chrome.runtime.sendMessage({ type: BGMessageType.STATE_UPDATED, payload: currentState })
    .catch(() => {});
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: BGMessageType.STATE_UPDATED,
          payload: currentState,
        }).catch(() => {});
      }
    }
  });
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: BGMessage, _sender, sendResponse) => {

  // STREAM_STARTED — window confirmed getUserMedia + video playing
  if (message.type === BGMessageType.STREAM_STARTED) {
    const stats: CaptureStats = message.payload;
    console.log('[BG] STREAM_STARTED —', stats.resolution, '| track:', stats.trackReadyState);
    updateState({ isScreenSharing: true, status: 'detecting', captureStats: stats, error: undefined });
    sendResponse({ success: true });
    return false;
  }

  // STOP_SCREEN_SHARE — user clicked Stop button
  if (message.type === BGMessageType.STOP_SCREEN_SHARE) {
    updateState({
      isScreenSharing: false,
      status: 'idle',
      streamId: undefined,
      currentQuestion: undefined,
      currentAnswer: undefined,
      captureStats: undefined,
      error: undefined,
    }).then(() => sendResponse({ success: true }));
    return true;
  }

  // SCREEN_SHARE_ERROR — getUserMedia or video setup failed in window
  if (message.type === BGMessageType.SCREEN_SHARE_ERROR) {
    const msg: string = message.payload?.error ?? 'Unknown capture error';
    console.error('[BG] SCREEN_SHARE_ERROR:', msg);
    updateState({ status: 'error', error: msg, isScreenSharing: false, captureStats: undefined });
    sendResponse({ success: true });
    return false;
  }

  // CAPTURE_STATS — periodic diagnostics
  if (message.type === BGMessageType.CAPTURE_STATS) {
    currentState = { ...currentState, captureStats: message.payload as CaptureStats };
    broadcastState();
    sendResponse({ success: true });
    return false;
  }

  // FRAME_CHANGED — send to AI backend
  if (message.type === BGMessageType.FRAME_CHANGED) {
    const { imageData, mimeType } = message.payload;
    const previousHash = currentState.currentAnswer?.hash;
    updateState({ status: 'analyzing' });
    analyzeFrame(currentState.sessionId, imageData, mimeType, previousHash)
      .then((result) => {
        if (result.detected && !result.unchanged && result.answer && result.question) {
          const answerResult: AnswerResult = {
            answer: result.answer,
            confidence: result.confidence ?? 'Medium',
            source: result.source ?? 'general',
            sourceDocuments: result.sourceDocuments ?? [],
            hash: result.hash ?? Date.now().toString(),
            timestamp: Date.now(),
          };
          updateState({ currentQuestion: result.question, currentAnswer: answerResult, status: 'answered', error: undefined });
        } else if (result.detected && result.unchanged) {
          updateState({ status: currentState.currentAnswer ? 'answered' : 'detecting' });
        } else {
          updateState({ status: 'detecting' });
        }
      })
      .catch((err) => {
        console.error('[BG] analyzeFrame error:', err);
        updateState({
          status: currentState.currentAnswer ? 'answered' : 'error',
          error: 'AI analysis failed: ' + (err?.message ?? err),
        });
      });
    sendResponse({ success: true });
    return false;
  }

  // GET_STATE
  if (message.type === BGMessageType.GET_STATE) {
    sendResponse({ success: true, data: currentState });
    return false;
  }

  // NEW_SESSION
  if (message.type === BGMessageType.NEW_SESSION) {
    const newSessionId = generateSessionId();
    updateState({
      sessionId: newSessionId,
      documents: [],
      currentQuestion: undefined,
      currentAnswer: undefined,
      error: undefined,
      captureStats: undefined,
      status: currentState.isScreenSharing ? 'detecting' : 'idle',
    }).then(() => sendResponse({ success: true, data: newSessionId }));
    return true;
  }

  // REFRESH_DOCUMENTS
  if (message.type === BGMessageType.REFRESH_DOCUMENTS) {
    listDocuments(currentState.sessionId)
      .then((docs) => { updateState({ documents: docs }); sendResponse({ success: true, data: docs }); })
      .catch((err) => { console.error('[BG] listDocuments:', err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  // REANALYZE
  if (message.type === BGMessageType.REANALYZE) {
    updateState({ currentQuestion: undefined, currentAnswer: undefined, status: 'detecting', error: undefined })
      .then(() => sendResponse({ success: true }));
    return true;
  }

  // Legacy / no-op
  if ([
    BGMessageType.START_SCREEN_SHARE,
    BGMessageType.OFFSCREEN_READY,
    BGMessageType.STOP_CAPTURE,
    BGMessageType.STREAM_ID_OBTAINED,
  ].includes(message.type)) {
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// Open side panel on action click (alternative to window — Chrome 114+)
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

// ─── Startup ──────────────────────────────────────────────────────────────────
loadState();
