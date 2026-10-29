import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages serves it at /Deadwall/).
  // Model URLs in config/assets.js are relative for the same reason.
  base: './',
  // Modern target so top-level await works in the production build.
  build: {
    target: 'es2022',
    // Two pages: the current game (index.html) and the frozen DW Classic (classic.html).
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), classic: resolve(import.meta.dirname, 'classic.html') } },
  },
});
