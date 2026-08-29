import { SessionStore, Document, DocumentChunk } from '../types';
import { normalizeText } from './documentParser';

// ─── Unicode-aware tokenizer ──────────────────────────────────────────────────
// The standard \w regex matches only ASCII [a-zA-Z0-9_].
// Bengali (and all other Unicode script) characters are outside \w.
// Using \p{L}\p{N} with the 'u' flag captures every Unicode letter and number,
// including ক-ৱ (Bengali), Arabic, Devanagari, CJK, etc.

function tokenize(text: string): string[] {
  // Normalise Bengali digits → ASCII, math words → symbols, then tokenize
  const norm = normalizeText(text).toLowerCase();
  return norm.match(/[\p{L}\p{N}]+/gu) ?? [];
}

// ─── RAG Service ──────────────────────────────────────────────────────────────

class RAGService {
  private sessionStores: Map<string, SessionStore> = new Map();

  private getOrCreateStore(sessionId: string): SessionStore {
    if (!this.sessionStores.has(sessionId)) {
      this.sessionStores.set(sessionId, { documents: new Map(), chunks: [] });
    }
    return this.sessionStores.get(sessionId)!;
  }

  addDocument(sessionId: string, doc: Document, chunks: DocumentChunk[]): void {
    const store = this.getOrCreateStore(sessionId);
    store.documents.set(doc.id, doc);
    store.chunks.push(...chunks);
  }

  removeDocument(sessionId: string, documentId: string): void {
    const store = this.sessionStores.get(sessionId);
    if (!store) return;
    store.documents.delete(documentId);
    store.chunks = store.chunks.filter(c => c.documentId !== documentId);
  }

  clearSession(sessionId: string): void {
    this.sessionStores.delete(sessionId);
  }

  getDocuments(sessionId: string): Document[] {
    const store = this.sessionStores.get(sessionId);
    return store ? Array.from(store.documents.values()) : [];
  }

  search(sessionId: string, query: string, topK: number = 6): DocumentChunk[] {
    const store = this.sessionStores.get(sessionId);
    if (!store || store.chunks.length === 0) return [];

    const queryWords = tokenize(query);
    if (queryWords.length === 0) return [];

    // Build query term-frequency map
    const queryTf = new Map<string, number>();
    for (const w of queryWords) queryTf.set(w, (queryTf.get(w) || 0) + 1);

    // Pre-tokenize all chunks and compute document frequency (df)
    const chunkTokens = store.chunks.map(chunk => tokenize(chunk.content));
    const df = new Map<string, number>();
    for (const tokens of chunkTokens) {
      for (const w of new Set(tokens)) df.set(w, (df.get(w) || 0) + 1);
    }

    const N = store.chunks.length;

    // Smoothed IDF: log((N+1)/(df+1)) + 1  (avoids division by zero and zero IDF)
    const idf = (w: string) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1;

    // Build query TF-IDF vector (log-normalised TF)
    const qVec: Record<string, number> = {};
    let qNorm = 0;
    for (const [w, cnt] of queryTf) {
      const v = (1 + Math.log(cnt)) * idf(w);
      qVec[w] = v;
      qNorm += v * v;
    }
    qNorm = Math.sqrt(qNorm);

    // Score chunks via cosine similarity
    const scored = store.chunks.map((chunk, i) => {
      const tokens = chunkTokens[i];
      const tf = new Map<string, number>();
      for (const w of tokens) tf.set(w, (tf.get(w) || 0) + 1);

      let dot = 0;
      let cNorm = 0;
      for (const [w, cnt] of tf) {
        const v = (1 + Math.log(cnt)) * idf(w);
        if (qVec[w] !== undefined) dot += v * qVec[w];
        cNorm += v * v;
      }
      cNorm = Math.sqrt(cNorm);

      const sim = qNorm === 0 || cNorm === 0 ? 0 : dot / (qNorm * cNorm);
      return { chunk, sim };
    });

    scored.sort((a, b) => b.sim - a.sim);
    return scored
      .filter(s => s.sim > 0.005)   // discard near-zero matches
      .slice(0, topK)
      .map(s => s.chunk);
  }

  getSessionStats(sessionId: string): { totalChunks: number; docCount: number } {
    const store = this.sessionStores.get(sessionId);
    if (!store) return { totalChunks: 0, docCount: 0 };
    return { totalChunks: store.chunks.length, docCount: store.documents.size };
  }

  getSessionContext(sessionId: string, maxChars: number = 35000): { contextText: string; sourceDocs: string[] } {
    const store = this.sessionStores.get(sessionId);
    if (!store || store.chunks.length === 0) return { contextText: '', sourceDocs: [] };

    const sourceDocs = Array.from(new Set(store.chunks.map(c => c.metadata.fileName)));
    let total = '';
    for (let i = 0; i < store.chunks.length; i++) {
      const c = store.chunks[i];
      const entry = `[Doc: ${c.metadata.fileName}]\n${c.content}\n\n`;
      if (total.length + entry.length > maxChars) break;
      total += entry;
    }
    return { contextText: total.trim(), sourceDocs };
  }
}

export const ragService = new RAGService();

