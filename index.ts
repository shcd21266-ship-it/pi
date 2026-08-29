export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  metadata: {
    fileName: string;
    [key: string]: any;
  };
}

export interface Document {
  id: string;
  sessionId: string;
  fileName: string;
  fileType: string;
  status: 'processing' | 'ready' | 'error';
  chunkCount: number;
  size: number;
  uploadedAt: Date;
  extractedChars?: number;
  pageCount?: number;
  extractionMethod?: string;
}

export interface SessionStore {
  documents: Map<string, Document>;
  chunks: DocumentChunk[];
}

export interface QuizQuestion {
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
}
