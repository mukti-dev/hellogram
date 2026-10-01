import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Custom service worker: offline shell + Web Push handlers (src/sw.ts).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Hellogram — Private Calls & Chats',
        short_name: 'Hellogram',
        description: 'Give out a number. Keep yours private.',
        theme_color: '#0B0B14',
        background_color: '#0B0B14',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
      '/media': 'http://localhost:4000',
      '/socket.io': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
