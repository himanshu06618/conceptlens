import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const buildVersion = `v${Date.now()}`;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png'],
      manifest: {
        name: 'ConceptLens — Study Concept Extractor',
        short_name: 'ConceptLens',
        description: 'Offline course notes concept extractor, definition detector, and study assistant.',
        theme_color: '#FBFAF6',
        background_color: '#FBFAF6',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cacheId: `conceptlens-${buildVersion}`,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Exclude all API routes and backend calls from service worker navigation fallback
        navigateFallbackDenylist: [/^\/api/, /^https?:\/\/.*\/api/],
        // Precache and serve ONLY static build assets (JS, CSS, HTML, fonts, icons)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Exclude API calls entirely from runtime caching so the browser dispatches them directly via network
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0', // Accessible over local network for mobile phone testing
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
});
