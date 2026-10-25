import { defineConfig } from 'vite';

export default defineConfig({
  // Modern target so top-level await works in the production build.
  build: { target: 'es2022' },
});
