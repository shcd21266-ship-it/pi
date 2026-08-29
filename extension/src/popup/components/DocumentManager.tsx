import React, { useState, useRef } from 'react';
import { AppState, BGMessageType } from '../../types';
import { uploadDocuments, deleteDocument, clearDocuments } from '../../services/api';
import {
  UploadCloud, FileText, Trash2, Loader2,
  AlertCircle, CheckCircle2, FileImage, File,
} from 'lucide-react';

interface Props {
  appState: AppState;
}

function fileIcon(fileType: string) {
  if (fileType?.startsWith('image/')) return <FileImage size={15} className="text-purple-400 flex-shrink-0" />;
  if (fileType === 'application/pdf') return <FileText size={15} className="text-red-400 flex-shrink-0" />;
  return <File size={15} className="text-blue-400 flex-shrink-0" />;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtChars(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

const DocumentManager: React.FC<Props> = ({ appState }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await uploadFiles(Array.from(e.target.files));
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) await uploadFiles(files);
  };

  const uploadFiles = async (files: File[]) => {
    setIsUploading(true);
    setError(null);
    setUploadProgress(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    try {
      await uploadDocuments(appState.sessionId, files);
      chrome.runtime.sendMessage({ type: BGMessageType.REFRESH_DOCUMENTS });
      setUploadProgress('');
    } catch (err: any) {
      setError(err.message || 'Failed to upload documents');
      setUploadProgress('');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeDoc = async (id: string) => {
    try {
      await deleteDocument(appState.sessionId, id);
      chrome.runtime.sendMessage({ type: BGMessageType.REFRESH_DOCUMENTS });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const clearAll = async () => {
    if (!confirm('Remove all documents from this session?')) return;
    try {
      await clearDocuments(appState.sessionId);
      chrome.runtime.sendMessage({ type: BGMessageType.REFRESH_DOCUMENTS });
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-lg font-bold mb-3">Knowledge Base</h2>

      {/* Upload zone */}
      <div
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-600 hover:border-blue-500 bg-white/5 rounded-xl p-5 text-center cursor-pointer transition-colors mb-3"
        style={{ cursor: isUploading ? 'not-allowed' : 'pointer' }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          accept=".pdf,.txt,.docx,.doc,.png,.jpg,.jpeg,.webp"
          className="hidden"
          disabled={isUploading}
        />
        {isUploading ? (
          <div className="flex flex-col items-center text-blue-400">
            <Loader2 className="animate-spin mb-2" size={28} />
            <span className="text-sm font-medium">{uploadProgress}</span>
            <span className="text-xs opacity-70 mt-1">Extracting text &amp; indexing chunks…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center text-gray-400 hover:text-gray-200 transition-colors">
            <UploadCloud size={28} className="mb-2" />
            <span className="text-sm font-medium">Drop files or click to upload</span>
            <span className="text-xs opacity-70 mt-1">PDF, TXT, DOCX, PNG, JPG, WEBP</span>
            <span className="text-xs opacity-50 mt-0.5">Bengali + English supported</span>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/40 text-red-300 p-3 rounded-lg flex items-start gap-2 mb-3 text-xs">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Document list */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-3">
        {appState.documents.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8 italic">
            No documents uploaded yet.<br />
            <span className="text-xs opacity-70">Upload study materials to ground AI answers in your content.</span>
          </div>
        ) : (
          appState.documents.map(doc => {
            const chars = (doc as any).extractedChars as number | undefined;
            const pages = (doc as any).pageCount as number | undefined;
            const chunks = doc.chunkCount;
            const method = (doc as any).extractionMethod as string | undefined;

            return (
              <div key={doc.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 overflow-hidden flex-1">
                    {fileIcon(doc.fileType)}
                    <div className="overflow-hidden flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{doc.fileName}</div>

                      {/* Status line */}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <CheckCircle2 size={11} className="text-green-400 flex-shrink-0" />
                        <span className="text-xs text-green-400 font-medium">READY</span>
                        <span className="text-xs text-gray-500">·</span>
                        <span className="text-xs text-gray-400">{fmtBytes(doc.size)}</span>
                      </div>

                      {/* Extraction stats */}
                      <div className="mt-1.5 grid grid-cols-3 gap-1">
                        {pages !== undefined && (
                          <div className="bg-black/20 rounded px-1.5 py-0.5 text-center">
                            <div className="text-xs font-semibold text-gray-200">{pages}</div>
                            <div className="text-[10px] text-gray-500">pages</div>
                          </div>
                        )}
                        {chars !== undefined && (
                          <div className="bg-black/20 rounded px-1.5 py-0.5 text-center">
                            <div className="text-xs font-semibold text-gray-200">{fmtChars(chars)}</div>
                            <div className="text-[10px] text-gray-500">chars</div>
                          </div>
                        )}
                        {chunks > 0 && (
                          <div className="bg-black/20 rounded px-1.5 py-0.5 text-center">
                            <div className="text-xs font-semibold text-gray-200">{chunks}</div>
                            <div className="text-[10px] text-gray-500">chunks</div>
                          </div>
                        )}
                      </div>

                      {/* Extraction method badge */}
                      {method && (
                        <div className="mt-1">
                          <span className="text-[10px] text-gray-600 bg-white/5 rounded px-1.5 py-0.5">
                            {method === 'pdf-parse' ? '📄 text PDF' :
                             method === 'gemini-pdf-ocr' ? '🔍 scanned PDF (Gemini OCR)' :
                             method === 'tesseract-ben+eng' ? '🔤 image OCR (Bengali+English)' :
                             method === 'mammoth' ? '📝 DOCX' :
                             method === 'plaintext' ? '📃 plain text' : method}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => removeDoc(doc.id)}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {appState.documents.length > 0 && (
        <button
          onClick={clearAll}
          className="w-full py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs transition-colors border border-red-500/20"
        >
          Clear All Documents
        </button>
      )}
    </div>
  );
};

export default DocumentManager;
