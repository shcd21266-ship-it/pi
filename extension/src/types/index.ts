export interface QuizQuestion {
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
}

export type AnswerLetter    = 'A' | 'B' | 'C' | 'D' | '?';
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';
export type AnswerSource    = 'documents' | 'reasoning' | 'general';

export type AppStatus =
  | 'idle'
  | 'requesting'   // desktopCapture picker is open
  | 'sharing'      // stream live, detecting
  | 'detecting'    // actively looking for a question
  | 'analyzing'    // question found, calling AI
  | 'answered'     // answer available
  | 'error';

/** Capture diagnostics pushed from offscreen → background → popup. */
export interface CaptureStats {
  streamConnected: boolean;
  trackReadyState: string;
  videoPlaying: boolean;
  resolution: string;       // e.g. "1920×1080"
  framesCaptured: number;
  framesChanged: number;
  lastFrameMs: number;      // ms since last captured frame (0 = never)
  error?: string;
}

export interface AnalysisResult {
  detected: boolean;
  unchanged?: boolean;
  hash?: string;
  question?: QuizQuestion;
  answer?: AnswerLetter;
  confidence?: ConfidenceLevel;
  source?: AnswerSource;
  sourceDocuments?: string[];
  message?: string;
}

export interface DocumentInfo {
  id: string;
  fileName: string;
  fileType: string;
  status: 'processing' | 'ready' | 'error';
  chunkCount: number;
  size: number;
  uploadedAt: string;
}

export interface AnswerResult {
  answer: AnswerLetter;
  confidence: ConfidenceLevel;
  source: AnswerSource;
  sourceDocuments: string[];
  hash: string;
  timestamp: number;
}

export interface AppState {
  sessionId: string;
  isScreenSharing: boolean;
  streamId?: string;
  currentQuestion?: QuizQuestion;
  currentAnswer?: AnswerResult;
  documents: DocumentInfo[];
  status: AppStatus;
  error?: string;
  captureStats?: CaptureStats;
}

export enum BGMessageType {
  // Popup → Background
  START_SCREEN_SHARE  = 'START_SCREEN_SHARE',  // kept for STOP flow
  STOP_SCREEN_SHARE   = 'STOP_SCREEN_SHARE',
  STREAM_ID_OBTAINED  = 'STREAM_ID_OBTAINED',  // popup hands off streamId after picker
  GET_STATE           = 'GET_STATE',
  NEW_SESSION         = 'NEW_SESSION',
  REFRESH_DOCUMENTS   = 'REFRESH_DOCUMENTS',
  REANALYZE           = 'REANALYZE',

  // Background → Offscreen
  INIT_STREAM         = 'INIT_STREAM',
  STOP_CAPTURE        = 'STOP_CAPTURE',

  // Offscreen → Background
  OFFSCREEN_READY     = 'OFFSCREEN_READY',
  STREAM_STARTED      = 'STREAM_STARTED',
  SCREEN_SHARE_ERROR  = 'SCREEN_SHARE_ERROR',
  FRAME_CHANGED       = 'FRAME_CHANGED',
  CAPTURE_STATS       = 'CAPTURE_STATS',

  // Background → Popup / Content Script (broadcast)
  STATE_UPDATED       = 'STATE_UPDATED',
}

export interface BGMessage {
  type: BGMessageType;
  payload?: any;
}

export interface BGResponse {
  success: boolean;
  data?: any;
  error?: string;
}
