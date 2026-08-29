import { GoogleGenerativeAI } from '@google/generative-ai';
import { QuizQuestion } from '../types';
import { normalizeText } from './documentParser';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

// Model fallback cascade — if one hits quota/rate-limit (429), it automatically fails over to the next
const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
];

export interface FastAnalysisResult {
  detected: boolean;
  question?: QuizQuestion;
  answer?: 'A' | 'B' | 'C' | 'D' | '?';
  confidence?: 'High' | 'Medium' | 'Low';
  source?: 'documents' | 'reasoning' | 'general';
  reasoning?: string;
}

export const aiService = {

  /**
   * Single-pass Gemini multimodal analyzer with automatic multi-model failover.
   */
  async analyzeFrameFast(
    base64Image: string,
    mimeType: string,
    documentContext: string,
    hasDocuments: boolean,
  ): Promise<FastAnalysisResult> {
    const docBlock = hasDocuments && documentContext.trim().length > 0
      ? `\nUPLOADED KNOWLEDGE BASE EXCERPTS (PRIMARY GROUND TRUTH):\n${documentContext}\n`
      : '';

    const prompt = `You are a superfast, accurate quiz assistant supporting Bengali (বাংলা) and English.
Analyze this screen capture to identify the current multiple-choice quiz question and select the correct option (A, B, C, or D).

KNOWLEDGE PRIORITY:
1. Facts EXPLICITLY stated in the Uploaded Knowledge Base excerpts below (Treat as absolute ground truth).
2. Calculation / reasoning based on information in those excerpts.
3. General knowledge ONLY if excerpts do not contain the answer.

EQUIVALENCES TO RECOGNIZE:
- Bengali digits ০১২৩৪৫৬৭৮৯ = 0123456789
- "শতাংশ" = "শতকরা" = "percent" = "%"
- "হলে" = "equals" = "="
- Map options labeled (ক, খ, গ, ঘ) or (১, ২, ৩, ৪) or (1, 2, 3, 4) or (A, B, C, D) strictly to "A", "B", "C", "D":
  * ক / 1 / ১ / A --> "A"
  * খ / 2 / ২ / B --> "B"
  * গ / 3 / ৩ / C --> "C"
  * ঘ / 4 / ৪ / D --> "D"

${docBlock}

INSTRUCTIONS:
1. If a quiz question with multiple-choice options is visible on the screen, extract the question and 4 options, find the correct answer, and return STRICTLY this JSON:
{
  "detected": true,
  "question": "extracted question text",
  "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "answer": "A" | "B" | "C" | "D",
  "confidence": "High" | "Medium" | "Low",
  "source": "documents" | "reasoning" | "general",
  "reasoning": "brief explanation"
}

2. If NO quiz question or options are visible on screen, return:
{ "detected": false }`;

    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const image = { inlineData: { data: base64Data, mimeType } };

    // Try models in cascade order
    for (const modelName of CANDIDATE_MODELS) {
      try {
        const startTime = Date.now();
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            maxOutputTokens: 250,
            temperature: 0.1,
          },
        });

        const result = await model.generateContent([prompt, image]);
        const duration = Date.now() - startTime;
        let text = result.response.text().trim();
        console.log(`[AI] [${modelName}] completed in ${duration}ms`);

        text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        if (text === 'null' || text === '' || text === '{}') return { detected: false };

        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }

        if (parsed && parsed.detected && parsed.question && parsed.options && parsed.answer) {
          if (!['A', 'B', 'C', 'D', '?'].includes(parsed.answer)) parsed.answer = '?';
          return {
            detected: true,
            question: {
              question: parsed.question,
              options: parsed.options,
            },
            answer: parsed.answer,
            confidence: parsed.confidence || 'High',
            source: parsed.source || (hasDocuments ? 'documents' : 'general'),
            reasoning: parsed.reasoning || '',
          };
        }

        return { detected: false };
      } catch (err: any) {
        console.warn(`[AI] [${modelName}] failed (${err.status || err.message?.substring(0, 80)}), trying next model...`);
        // Continue to next model in cascade
      }
    }

    return { detected: false };
  },

  hashQuestion(question: QuizQuestion): string {
    const s = normalizeText(
      `${question.question}|${question.options.A}|${question.options.B}|${question.options.C}|${question.options.D}`
    );
    return crypto.createHash('sha256').update(s).digest('hex');
  },
};
