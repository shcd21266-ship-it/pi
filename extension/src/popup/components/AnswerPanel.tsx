import React from 'react';
import { AppState, BGMessageType } from '../../types';
import { RefreshCw, Zap, BookOpen } from 'lucide-react';

interface Props {
  appState: AppState;
}

const AnswerPanel: React.FC<Props> = ({ appState }) => {
  const { currentQuestion, currentAnswer, status, isScreenSharing } = appState;

  const handleReanalyze = () => {
    chrome.runtime.sendMessage({ type: BGMessageType.REANALYZE });
  };

  if (!isScreenSharing) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 px-6">
        <Zap size={48} className="mb-4 opacity-20" />
        <p>Screen sharing is paused.</p>
        <p className="text-sm mt-2 opacity-70">Start sharing from the Dashboard to detect quiz questions.</p>
      </div>
    );
  }

  if (status === 'detecting' || status === 'analyzing') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full border-4 border-blue-500/20 animate-[spin_3s_linear_infinite]" />
          <div className="w-24 h-24 rounded-full border-4 border-t-blue-400 border-r-transparent border-b-transparent border-l-transparent absolute top-0 left-0 animate-spin" />
        </div>
        <p className="text-lg font-medium text-blue-100">
          {status === 'analyzing' ? 'Analyzing Screen...' : 'Waiting for Question...'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Question Details */}
      <div className="bg-glass border border-glass-border rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-blue-300 mb-2">Detected Question</h3>
        {currentQuestion ? (
          <>
            <p className="text-sm mb-3 line-clamp-3">{currentQuestion.question}</p>
            <div className="grid grid-cols-2 gap-2 text-xs opacity-80">
              <div className="bg-white/5 p-2 rounded truncate">A: {currentQuestion.options.A}</div>
              <div className="bg-white/5 p-2 rounded truncate">B: {currentQuestion.options.B}</div>
              <div className="bg-white/5 p-2 rounded truncate">C: {currentQuestion.options.C}</div>
              <div className="bg-white/5 p-2 rounded truncate">D: {currentQuestion.options.D}</div>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400 italic">No text extracted.</p>
        )}
      </div>

      {/* Answer Display */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
        <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full" />
        <div className="text-[120px] font-black leading-none bg-clip-text text-transparent bg-gradient-to-br from-blue-400 to-purple-500 filter drop-shadow-lg z-10">
          {currentAnswer?.answer || '?'}
        </div>
      </div>

      {/* Metadata & Controls */}
      <div className="mt-4 space-y-3">
        <div className="flex justify-between items-center bg-black/20 p-3 rounded-lg text-sm">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: currentAnswer?.confidence === 'High' ? '#22c55e' : '#eab308' }}
            />
            {currentAnswer?.confidence || 'Unknown'} Confidence
          </div>
          <div className="flex items-center gap-2 opacity-80">
            {currentAnswer?.source === 'documents' ? <BookOpen size={14} /> : <Zap size={14} />}
            {currentAnswer?.source === 'documents' ? 'Documents' : 'AI Agent'}
          </div>
        </div>

        <button 
          onClick={handleReanalyze}
          className="w-full py-3 bg-glass border border-glass-border hover:bg-white/10 rounded-xl flex items-center justify-center gap-2 transition-colors text-sm font-medium"
        >
          <RefreshCw size={16} /> Force Re-analyze
        </button>
      </div>
    </div>
  );
};

export default AnswerPanel;
