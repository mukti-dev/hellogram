import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * hellogram.in — the public landing page. Plain HTML (fast, readable by search engines);
 * links into the web app use %VITE_APP_URL%, set per environment in .env / .env.production.
 */
export default defineConfig({
  plugins: [tailwindcss()],
  // Never inline assets as data: URLs — the production CSP only allows files from our own origin.
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
