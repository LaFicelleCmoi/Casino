import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'web-dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
