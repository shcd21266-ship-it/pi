import { AppState, BGMessage, BGMessageType } from '../types';

let overlay: HTMLElement | null = null;
let isDragging = false;
let currentX: number;
let currentY: number;
let initialX: number;
let initialY: number;
let xOffset = 0;
let yOffset = 0;
let collapsed = false;
let currentState: AppState | null = null;

function initOverlay() {
  if (document.getElementById('quiz-assistant-overlay')) return;

  overlay = document.createElement('div');
  overlay.id = 'quiz-assistant-overlay';
  
  // Default position: bottom right
  xOffset = window.innerWidth - 260;
  yOffset = window.innerHeight - 300;
  
  Object.assign(overlay.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    transform: `translate(${xOffset}px, ${yOffset}px)`,
    zIndex: '2147483647',
    background: 'rgba(10, 10, 30, 0.85)',
    backdropFilter: 'blur(20px)',
    borderRadius: '12px',
    color: 'white',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    minWidth: '220px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'none',
    userSelect: 'none'
  });

  document.body.appendChild(overlay);

  overlay.addEventListener('mousedown', dragStart);
  window.addEventListener('mousemove', drag);
  window.addEventListener('mouseup', dragEnd);

  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.minimize-btn')) {
      collapsed = !collapsed;
      render();
    } else if (target.closest('.reanalyze-btn')) {
      chrome.runtime.sendMessage({ type: BGMessageType.REANALYZE });
    }
  });

  render();
}

function dragStart(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button')) return;
  initialX = e.clientX - xOffset;
  initialY = e.clientY - yOffset;
  isDragging = true;
}

function drag(e: MouseEvent) {
  if (isDragging && overlay) {
    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;
    xOffset = currentX;
    yOffset = currentY;
    overlay.style.transform = `translate(${currentX}px, ${currentY}px)`;
  }
}

function dragEnd() {
  initialX = currentX;
  initialY = currentY;
  isDragging = false;
}

function render() {
  if (!overlay || !currentState) return;

  if (!currentState.isScreenSharing) {
    overlay.style.display = 'none';
    return;
  }
  
  overlay.style.display = 'block';

  if (collapsed) {
    overlay.style.minWidth = 'auto';
    overlay.innerHTML = `
      <div style="padding: 10px; cursor: move; display: flex; align-items: center; gap: 10px;">
        <span class="answer-letter" style="font-size: 32px;">${currentState.currentAnswer?.answer || '?'}</span>
        <button class="minimize-btn" style="background: none; border: none; color: white; cursor: pointer; padding: 4px;">⛶</button>
      </div>
    `;
    return;
  }

  overlay.style.minWidth = '220px';

  let contentHtml = '';
  
  if (currentState.status === 'detecting') {
    contentHtml = `
      <div style="text-align: center; padding: 20px 10px;">
        <div class="pulse-dot" style="margin-right: 8px;"></div>
        <span style="opacity: 0.8; font-size: 14px;">Waiting for question...</span>
      </div>
    `;
  } else if (currentState.status === 'analyzing') {
    contentHtml = `
      <div style="text-align: center; padding: 20px 10px;">
        <div class="pulse-dot" style="margin-right: 8px; background: #3b82f6;"></div>
        <span style="opacity: 0.8; font-size: 14px;">Analyzing...</span>
      </div>
    `;
  } else if (currentState.currentAnswer) {
    const { answer, confidence, source } = currentState.currentAnswer;
    const confColor = confidence === 'High' ? '#22c55e' : confidence === 'Medium' ? '#eab308' : '#ef4444';
    
    contentHtml = `
      <div style="text-align: center; padding: 15px 10px;">
        <div class="answer-letter">${answer}</div>
        <div style="display: flex; justify-content: center; gap: 8px; margin-top: 10px; font-size: 12px;">
          <span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 12px; border: 1px solid ${confColor}">
            ${confidence}
          </span>
          <span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 12px;">
            ${source === 'documents' ? '📄 Docs' : '🧠 AI'}
          </span>
        </div>
        <button class="reanalyze-btn" style="margin-top: 15px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; width: 100%; font-size: 13px; transition: background 0.2s;">
          Re-analyze
        </button>
      </div>
    `;
  } else {
    contentHtml = `
      <div style="text-align: center; padding: 20px 10px;">
        <span style="opacity: 0.8; font-size: 14px;">Share screen to start</span>
      </div>
    `;
  }

  overlay.innerHTML = `
    <div style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; cursor: move; background: rgba(0,0,0,0.2); border-radius: 12px 12px 0 0;">
      <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px;">
        <span style="color: #60a5fa">🎯</span> Assistant
      </div>
      <button class="minimize-btn" style="background: none; border: none; color: white; cursor: pointer; opacity: 0.7; font-size: 16px;">_</button>
    </div>
    ${contentHtml}
  `;
}

chrome.runtime.onMessage.addListener((message: BGMessage) => {
  if (message.type === BGMessageType.STATE_UPDATED) {
    currentState = message.payload as AppState;
    if (!overlay) initOverlay();
    render();
  }
});

// Init on load
chrome.runtime.sendMessage({ type: BGMessageType.GET_STATE }, (res) => {
  if (res && res.data) {
    currentState = res.data;
    if (currentState.isScreenSharing) {
      initOverlay();
    }
  }
});
