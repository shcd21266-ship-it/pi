import { Router, Request, Response } from 'express';
import { aiService } from '../services/aiService';
import { ragService } from '../services/ragService';

const router = Router();

router.post('/analyze-frame', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, imageData, mimeType, previousHash } = req.body;
    if (!sessionId || !imageData) {
      res.status(400).json({ error: 'sessionId and imageData required' });
      return;
    }

    const { contextText, sourceDocs } = ragService.getSessionContext(sessionId);
    const hasDocuments = sourceDocs.length > 0;

    // Single unified ultra-fast multimodal call (~800ms)
    const result = await aiService.analyzeFrameFast(
      imageData,
      mimeType || 'image/jpeg',
      contextText,
      hasDocuments
    );

    if (!result.detected || !result.question || !result.answer) {
      res.json({ detected: false, message: 'No question detected' });
      return;
    }

    const hash = aiService.hashQuestion(result.question);
    if (hash === previousHash) {
      res.json({ detected: true, unchanged: true, hash });
      return;
    }

    res.json({
      detected: true,
      unchanged: false,
      hash,
      question: result.question,
      answer: result.answer,
      confidence: result.confidence || 'High',
      source: result.source || (hasDocuments ? 'documents' : 'general'),
      reasoning: result.reasoning || '',
      sourceDocuments: sourceDocs,
    });
  } catch (err: any) {
    console.error('[Quiz Route] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
