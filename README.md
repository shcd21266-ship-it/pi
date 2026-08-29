# AI Quiz Screen Assistant

A production-ready Chrome Extension that watches your screen for quiz questions, retrieves answers from your uploaded study documents using RAG (Retrieval-Augmented Generation), and displays a single clear letter — **A**, **B**, **C**, or **D** — in a sleek floating overlay.

---

## Architecture

```
Chrome Extension (MV3)
       ↓ HTTPS
Secure Backend Server (Node.js + Express)
       ↓
Gemini AI (Vision OCR + Answer Generation)
       ↓
Answer: A / B / C / D
```

The extension **never** exposes your API key — it talks to a local backend server which holds the key securely in `.env`.

---

## Requirements

- **Node.js** v18+ and npm
- **Google Gemini API Key** — get one free at https://aistudio.google.com/app/apikey
- **Google Chrome** (v116+)

---

## Setup

### Step 1 — Clone / Open the Project

```
c:\quiz helper\
├── server\      ← Backend API server
└── extension\   ← Chrome Extension (built output in extension\dist\)
```

### Step 2 — Configure the Backend Server

```powershell
cd "c:\quiz helper\server"
```

Copy the environment template and add your Gemini API key:

```powershell
Copy-Item .env.example .env
```

Open `server\.env` and set your key:

```env
PORT=3001
GEMINI_API_KEY=your_gemini_api_key_here
```

Install dependencies:

```powershell
npm install
```

Build the server:

```powershell
npm run build
```

### Step 3 — Start the Backend Server

```powershell
npm start
```

The server starts on `http://localhost:3001`. You should see:

```
Server is running on port 3001
```

> Keep this terminal window open while using the extension.

For development with auto-reload:

```powershell
npm run dev
```

### Step 4 — Load the Extension in Chrome

The extension is pre-built in `extension\dist\`. To load it:

1. Open Chrome and go to: `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the folder: `c:\quiz helper\extension\dist`

The extension icon will appear in your Chrome toolbar.

> **If you make code changes**, rebuild with:
> ```powershell
> cd "c:\quiz helper\extension"
> npm run build
> ```
> Then click the refresh icon on the extension card in `chrome://extensions`.

---

## Usage

### 1. Open the Extension

Click the 🎯 icon in your Chrome toolbar.

### 2. Upload Study Documents

- Go to the **Docs** tab
- Click the upload zone (or drag & drop files)
- Supported formats: **PDF, DOCX, TXT, PNG, JPG**
- Documents are processed, chunked, and indexed for fast retrieval

### 3. Start Screen Share

- Go to **Dashboard** tab
- Click **Start Screen Share**
- Choose: Entire screen, a Window, or a Browser Tab
- A floating overlay widget will appear on the page

### 4. Detect Questions Automatically

When a quiz question with A/B/C/D options appears on screen:

1. The extension captures the frame
2. Detects visual change (only when content changes)
3. Extracts the question and options using Gemini Vision
4. Searches your uploaded documents for relevant context
5. Generates the answer with priority:
   - **Priority 1**: Facts from your documents
   - **Priority 2**: Reasoning from your documents
   - **Priority 3**: General AI knowledge (fallback)
6. Displays a single letter: **A**, **B**, **C**, or **D**

### 5. New Session

Click **New Session** on the Dashboard to clear the knowledge base and start fresh with different documents.

---

## Example Flow

```
Upload: math.pdf
↓
Start Screen Share
↓
Screen shows: "What is 15 × 6?  A. 60  B. 90  C. 100  D. 120"
↓
Extension detects question → searches math.pdf → answers: B
↓
Floating overlay shows: B (High Confidence | 📄 Documents)
```

---

## Features

| Feature | Description |
|---------|-------------|
| 📄 Document Upload | PDF, DOCX, TXT, Images (OCR via Tesseract.js) |
| 🔍 RAG Retrieval | TF-IDF cosine similarity search across all uploaded docs |
| 🖥️ Screen Capture | Chrome desktopCapture API — no browser tabs excluded |
| 👁️ Vision AI | Gemini Vision extracts question + options from screenshots |
| 🔁 Auto Detection | Detects new questions automatically when screen changes |
| 🚫 No Duplicates | SHA-256 question fingerprint prevents re-processing same question |
| 🎯 Floating Overlay | Draggable, collapsible answer widget injected into active tab |
| 🔒 Secure API | API key stored in server `.env`, never in the extension |
| 🔄 Session Isolation | Each session uses its own independent knowledge base |
| ⚡ Performance | Frame diff hashing — only sends changed frames to AI |

---

## Project Structure

```
quiz helper/
│
├── server/                    ← Backend API server
│   ├── src/
│   │   ├── index.ts           ← Express entry point
│   │   ├── types/index.ts     ← Shared TypeScript types
│   │   ├── services/
│   │   │   ├── aiService.ts   ← Gemini Vision + Answer generation
│   │   │   ├── ragService.ts  ← In-memory TF-IDF RAG store
│   │   │   └── documentParser.ts ← PDF/DOCX/TXT/Image parsing
│   │   └── routes/
│   │       ├── documents.ts   ← Document upload/delete routes
│   │       └── quiz.ts        ← Frame analysis route
│   ├── .env.example
│   └── package.json
│
└── extension/                 ← Chrome Extension (MV3)
    ├── src/
    │   ├── background/        ← Service worker (state coordinator)
    │   ├── content/           ← Floating overlay widget
    │   ├── offscreen/         ← Canvas frame capture + diff hashing
    │   ├── popup/             ← React dashboard (Dashboard, Docs, Assistant, Settings)
    │   ├── services/api.ts    ← Backend API client
    │   └── types/index.ts     ← Shared TypeScript interfaces
    ├── manifest.json          ← MV3 manifest
    ├── dist/                  ← Built extension (load this in Chrome)
    └── package.json
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/documents/upload` | Upload + process documents |
| GET | `/api/documents/list?sessionId=...` | List session documents |
| DELETE | `/api/documents/:id?sessionId=...` | Delete a document |
| DELETE | `/api/documents/` | Clear all session documents |
| POST | `/api/quiz/analyze-frame` | Analyze screenshot, return A/B/C/D |
| GET | `/api/health` | Health check |

---

## Performance Notes

- Frames are compared using a 32×32 pixel hash grid
- Only sends a new frame to AI when visual diff > threshold (default: 15/255)
- After sending a frame, waits minimum 3 seconds before next send (debounce)
- Question fingerprint (SHA-256) prevents re-analyzing the same question
- Documents are chunked at 400 characters with 50-char overlap for fast retrieval

---

## Acceptance Tests

### Test 1 — Document-Grounded Answer
1. Upload `math.pdf` containing multiplication tables
2. Start screen share → show: `"What is 15 × 6? A. 60 B. 90 C. 100 D. 120"`
3. Expected result: **B** (from document)

### Test 2 — Session Isolation
1. Clear session, upload `history.pdf`
2. Verify math content no longer influences answers

### Test 3 — Auto Question Change Detection
1. Show Question 1 → get answer
2. Change to Question 2 → extension auto-detects and shows new answer

### Test 4 — No Duplicate Processing
1. Keep same question on screen for 30 seconds
2. Verify server logs show only ONE request per unique question

### Test 5 — Multi-Document Retrieval
1. Upload 3+ documents
2. Ask a question whose answer spans documents
3. Verify answer uses combined context

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| "Server Offline" indicator | Run `npm start` in `server/` folder |
| Extension not visible in toolbar | Go to `chrome://extensions` and pin it |
| Screen share not working | Make sure Chrome has screen recording permission (macOS) |
| "No question detected" | Ensure the quiz has clear A/B/C/D labels on screen |
| Documents not processing | Check server terminal for errors; verify GEMINI_API_KEY is set |
| Build errors | Delete `node_modules` and re-run `npm install` |
