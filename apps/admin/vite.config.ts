import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Never inline assets as data: URLs — the production CSP only allows fonts/images from our own origin.
  build: { assetsInlineLimit: 0 },
  plugins: [react(), tailwindcss()],
  server: { port: 5174, proxy: { '/admin/v1': 'http://localhost:4100' } },
});
