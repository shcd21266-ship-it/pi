import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ─── Bengali / English normalisation ─────────────────────────────────────────
// Converts Bengali digits and common math words to ASCII so that
// "২০%" and "20%" score identically during TF-IDF retrieval.

const BENGALI_DIGIT_MAP: Record<string, string> = {
  '০':'0','১':'1','২':'2','৩':'3','৪':'4',
  '৫':'5','৬':'6','৭':'7','৮':'8','৯':'9',
};

const BENGALI_MATH_MAP: Record<string, string> = {
  'শতাংশ': '%', 'শতকরা': '%',
  'ভাগ': '/', 'গুণ': '*',
  'যোগ': '+', 'বিয়োগ': '-',
  'সমান': '=', 'হলে': '=',
  'percent': '%', 'percentage': '%',
};

export function normalizeText(text: string): string {
  let out = text;
  for (const [ben, ascii] of Object.entries(BENGALI_DIGIT_MAP)) {
    out = out.split(ben).join(ascii);
  }
  for (const [word, sym] of Object.entries(BENGALI_MATH_MAP)) {
    // Replace whole-word occurrences (Unicode-aware)
    out = out.replace(new RegExp(word, 'g'), ' ' + sym + ' ');
  }
  return out;
}

// ─── ParseResult ──────────────────────────────────────────────────────────────

export interface ParseResult {
  text: string;
  pageCount: number;
  charCount: number;
  method: string;
}

// ─── Scanned-PDF fallback via Gemini ─────────────────────────────────────────

async function geminiOCRpdf(filePath: string): Promise<string> {
  const pdfBase64 = fs.readFileSync(filePath).toString('base64');
  for (const m of ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash']) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const result = await model.generateContent([
        'Extract ALL text from this document exactly as written, preserving Bengali and English characters. Output ONLY the extracted text, no commentary.',
        { inlineData: { data: pdfBase64, mimeType: 'application/pdf' } },
      ]);
      return result.response.text().trim();
    } catch {
      continue;
    }
  }
  return '';
}

async function extractPdfText(filePath: string): Promise<{ text: string; pageCount: number; method: string }> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  const pageCount = data.numpages || 1;
  const rawText = (data.text ?? '').trim();

  const charsPerPage = rawText.length / Math.max(pageCount, 1);
  if (charsPerPage < 20) {
    console.log(`[Parser] Scanned PDF (${charsPerPage.toFixed(1)} chars/page) → Gemini OCR`);
    try {
      const geminiText = await geminiOCRpdf(filePath);
      if (geminiText.length > rawText.length) {
        return { text: geminiText, pageCount, method: 'gemini-pdf-ocr' };
      }
    } catch (e) {
      console.warn('[Parser] Gemini PDF OCR failed, using pdf-parse result:', (e as any).message);
    }
  }

  return { text: rawText, pageCount, method: 'pdf-parse' };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function parseDocument(
  filePath: string,
  mimeType: string,
  originalName: string,
): Promise<ParseResult> {
  let text = '';
  let pageCount = 1;
  let method = 'unknown';

  if (mimeType === 'application/pdf') {
    const result = await extractPdfText(filePath);
    text = result.text;
    pageCount = result.pageCount;
    method = result.method;
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    originalName.endsWith('.docx') ||
    originalName.endsWith('.doc')
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
    method = 'mammoth';
  } else if (mimeType.startsWith('image/')) {
    // Bengali + English OCR
    console.log('[Parser] Running Tesseract (ben+eng)…');
    const result = await Tesseract.recognize(filePath, 'ben+eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text') process.stdout.write(`\r[OCR] ${Math.round(m.progress * 100)}%`);
      },
    });
    process.stdout.write('\n');
    text = result.data.text;
    method = 'tesseract-ben+eng';
  } else {
    // Plain text / TXT
    text = fs.readFileSync(filePath, 'utf-8');
    method = 'plaintext';
  }

  // Normalise whitespace (preserve single newlines for structure)
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  console.log(`[Parser] Done — ${text.length} chars, ${pageCount} pages, method: ${method}`);
  return { text, pageCount, charCount: text.length, method };
}

// ─── Chunking ─────────────────────────────────────────────────────────────────
// Paragraph-aware: tries to keep paragraphs together, splits long ones at
// sentence boundaries. Adds overlap so context crosses chunk edges.

export function chunkText(text: string, chunkSize: number = 500, overlap: number = 80): string[] {
  if (!text?.trim()) return [];

  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  const rawChunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (!current) {
      if (para.length <= chunkSize) { current = para; continue; }
    } else if (current.length + para.length + 2 <= chunkSize) {
      current += '\n\n' + para;
      continue;
    } else {
      rawChunks.push(current.trim());
      current = '';
      if (para.length <= chunkSize) { current = para; continue; }
    }

    // Para is too long — split at sentence boundaries
    // \u0964 is the Bengali danda (sentence-end marker)
    const sentences = para.split(/(?<=[.!?\u0964])\s+/u);
    let sentBuf = '';
    for (const sent of sentences) {
      if (sentBuf.length + sent.length + 1 <= chunkSize) {
        sentBuf = sentBuf ? sentBuf + ' ' + sent : sent;
      } else {
        if (sentBuf) rawChunks.push(sentBuf.trim());
        sentBuf = sent.length <= chunkSize ? sent : sent.slice(0, chunkSize);
      }
    }
    if (sentBuf) current = sentBuf;
  }
  if (current.trim()) rawChunks.push(current.trim());

  // Add overlap: prepend tail of previous chunk to each chunk
  const result: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    if (i === 0) { result.push(rawChunks[i]); continue; }
    const tail = rawChunks[i - 1].slice(-overlap);
    result.push((tail + ' ' + rawChunks[i]).trim());
  }

  return result.filter(c => c.length > 0);
}
