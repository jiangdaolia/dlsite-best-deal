import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';
import manifest from './src/manifest';
import path from 'node:path';

export default defineConfig({
  plugins: [webExtension({ manifest: () => manifest })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
