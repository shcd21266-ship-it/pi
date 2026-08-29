import { DocumentInfo, AnalysisResult } from '../types';

// Base URL for the backend API server. Can be overridden in Settings.
function getBaseUrl(): string {
  try {
    const stored = localStorage.getItem('quiz_api_base_url');
    return stored || 'http://localhost:3001/api';
  } catch {
    return 'http://localhost:3001/api';
  }
}

export async function uploadDocuments(sessionId: string, files: File[]): Promise<DocumentInfo[]> {
  const formData = new FormData();
  formData.append('sessionId', sessionId);
  // Backend multer field name is 'files'
  files.forEach(f => formData.append('files', f));

  const res = await fetch(`${getBaseUrl()}/documents/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || 'Upload failed');
  }
  const data = await res.json();
  // Backend returns { documents: [...] } — map to DocumentInfo shape
  return (data.documents || []).map((d: any) => ({
    id: d.documentId,
    fileName: d.fileName,
    fileType: '',
    status: d.status,
    chunkCount: d.chunkCount,
    size: d.size,
    uploadedAt: new Date().toISOString(),
  }));
}

export async function listDocuments(sessionId: string): Promise<DocumentInfo[]> {
  const res = await fetch(`${getBaseUrl()}/documents/list?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error('Failed to list documents');
  const data = await res.json();
  return data.documents || [];
}

export async function deleteDocument(sessionId: string, documentId: string): Promise<void> {
  const res = await fetch(
    `${getBaseUrl()}/documents/${encodeURIComponent(documentId)}?sessionId=${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error('Failed to delete document');
}

export async function clearDocuments(sessionId: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/documents/`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error('Failed to clear documents');
}

export async function analyzeFrame(
  sessionId: string,
  imageData: string,
  mimeType: string,
  previousHash?: string
): Promise<AnalysisResult> {
  const res = await fetch(`${getBaseUrl()}/quiz/analyze-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, imageData, mimeType, previousHash }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Analysis failed' }));
    throw new Error(err.error || 'Analysis failed');
  }
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
