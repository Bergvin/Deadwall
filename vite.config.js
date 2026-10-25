import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages serves it at /Deadwall/).
  // Model URLs in config/assets.js are relative for the same reason.
  base: './',
  // Modern target so top-level await works in the production build.
  build: { target: 'es2022' },
});
