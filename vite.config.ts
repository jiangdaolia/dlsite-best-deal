import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';
import manifest from './src/manifest';
import path from 'node:path';

export default defineConfig({
  plugins: [
    webExtension({
      manifest: () => manifest,
      additionalInputs: [
        'src/assets/icons/icon16.png',
        'src/assets/icons/icon32.png',
        'src/assets/icons/icon48.png',
        'src/assets/icons/icon128.png',
      ],
    }),
  ],
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
