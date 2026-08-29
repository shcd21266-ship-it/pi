import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      // Explicitly register HTML pages that are NOT listed in manifest.json entries.
      // crxjs handles popup/background automatically; we add offscreen and capture here
      // so Vite processes their <script> tags and rewrites them to compiled asset paths.
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        capture:   resolve(__dirname, 'src/capture/capture.html'),
      },
    },
  },
});
