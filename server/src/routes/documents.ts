import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseDocument, chunkText } from '../services/documentParser';
import { ragService } from '../services/ragService';
import { Document, DocumentChunk } from '../types';

const router = Router();
const uploadDir = path.join(os.tmpdir(), 'quiz-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 },  // 50 MB
});

router.post('/upload', upload.array('files', 10), async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = req.body.sessionId;
    if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }

    const results = [];

    for (const file of files) {
      const documentId = uuidv4();
      console.log(`[Upload] Processing: ${file.originalname} (${file.mimetype}, ${(file.size/1024).toFixed(1)} KB)`);

      let parseResult;
      try {
        parseResult = await parseDocument(file.path, file.mimetype, file.originalname);
      } catch (parseErr: any) {
        console.error(`[Upload] Parse failed for ${file.originalname}:`, parseErr.message);
        try { fs.unlinkSync(file.path); } catch {}
        results.push({ documentId, fileName: file.originalname, status: 'error', error: parseErr.message });
        continue;
      }

      const { text, pageCount, charCount, method } = parseResult;

      if (!text || charCount < 10) {
        console.warn(`[Upload] Very little text extracted from ${file.originalname} (${charCount} chars)`);
      }

      const chunks = chunkText(text);
      console.log(`[Upload] ${file.originalname}: ${charCount} chars, ${pageCount} pages, ${chunks.length} chunks, method: ${method}`);

      const docChunks: DocumentChunk[] = chunks.map(content => ({
        id: uuidv4(),
        documentId,
        content,
        metadata: { fileName: file.originalname },
      }));

      const doc: Document = {
        id: documentId,
        sessionId,
        fileName: file.originalname,
        fileType: file.mimetype,
        status: 'ready',
        chunkCount: chunks.length,
        size: file.size,
        uploadedAt: new Date(),
        extractedChars: charCount,
        pageCount,
        extractionMethod: method,
      };

      ragService.addDocument(sessionId, doc, docChunks);
      try { fs.unlinkSync(file.path); } catch {}

      results.push({
        documentId,
        fileName: file.originalname,
        status: 'ready',
        chunkCount: chunks.length,
        size: file.size,
        extractedChars: charCount,
        pageCount,
        extractionMethod: method,
      });
    }

    res.json({ documents: results });
  } catch (err: any) {
    console.error('[Upload] Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', (req: Request, res: Response): void => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
  res.json({ documents: ragService.getDocuments(sessionId) });
});

router.delete('/:documentId', (req: Request, res: Response): void => {
  const sessionId = req.query.sessionId as string;
  const { documentId } = req.params;
  if (!sessionId || !documentId) { res.status(400).json({ error: 'sessionId and documentId required' }); return; }
  ragService.removeDocument(sessionId, documentId);
  res.json({ success: true });
});

router.delete('/', (req: Request, res: Response): void => {
  const sessionId = req.body.sessionId;
  if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }
  ragService.clearSession(sessionId);
  res.json({ success: true });
});

export default router;
