import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const getCommitSha = () => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return `b${Date.now().toString(36).slice(-6)}`;
  }
};

const commitSha = getCommitSha();
const builtAt = new Date().toISOString();

const versionPlugin = () => ({
  name: 'generate-version-json',
  buildStart() {
    try {
      if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });
      fs.writeFileSync('public/version.json', JSON.stringify({ commit: commitSha, built_at: builtAt }, null, 2));
    } catch (e) {
      console.warn('Could not write public/version.json', e);
    }
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ commit: commitSha, built_at: builtAt }, null, 2)
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(commitSha),
    __BUILT_AT__: JSON.stringify(builtAt),
  },
  plugins: [
    react(),
    versionPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png', 'version.json'],
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
        cacheId: `conceptlens-${commitSha}-${Date.now().toString(36)}`,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Exclude all API routes, exports, viewer, version checks, and storage calls from service worker navigation fallback
        navigateFallbackDenylist: [/^\/api/, /^https?:\/\/.*\/api/, /export/, /\/file/, /\/version/, /version\.json/, /\/graph/, /\/flow/, /\/mastery-map/, /\/ask/],
        // Precache and serve ONLY static build assets (JS, CSS, HTML, fonts, icons)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Exclude API calls entirely from runtime caching so the browser dispatches them directly via network
        runtimeCaching: [
          {
            // Explicitly route all API/backend/export/storage/version calls strictly via NetworkOnly (never cache in SW)
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api') ||
              url.pathname.startsWith('/graph') ||
              url.pathname.startsWith('/flow') ||
              url.pathname.startsWith('/mastery-map') ||
              url.pathname.startsWith('/ask') ||
              url.pathname.startsWith('/documents') ||
              url.pathname.startsWith('/dashboard') ||
              url.pathname.startsWith('/health') ||
              url.pathname.startsWith('/version') ||
              url.pathname.includes('version.json') ||
              url.pathname.startsWith('/auth') ||
              url.pathname.startsWith('/guest') ||
              url.pathname.startsWith('/notes') ||
              url.pathname.startsWith('/reminders') ||
              url.pathname.includes('/export') ||
              url.pathname.includes('/file') ||
              url.hostname.includes('onrender.com') ||
              url.hostname.includes('r2.cloudflarestorage.com') ||
              url.hostname.includes('backblazeb2.com'),
            handler: 'NetworkOnly',
          },
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
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/framer-motion')) {
            return 'framer-motion';
          }
          if (id.includes('node_modules/@xyflow') || id.includes('node_modules/@dagrejs')) {
            return 'flow-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide-icons';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    pool: 'forks',
  },
});
