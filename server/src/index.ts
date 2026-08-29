import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';

import documentsRouter from './routes/documents';
import quizRouter from './routes/quiz';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const tmpDir = path.join(os.tmpdir(), 'quiz-uploads');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

app.use('/api/documents', documentsRouter);
app.use('/api/quiz', quizRouter);

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Global error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
