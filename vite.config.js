import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { assertSupabaseBrowserKey } from './src/config/supabasePublicKey.js'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  plugins: [
    {
      name: 'supabase-public-key-preflight',
      configResolved(config) {
        // Check both public variables before a secret can be bundled, even if
        // the other variable would win at runtime. Never print their values.
        assertSupabaseBrowserKey(config.env.VITE_SUPABASE_PUBLISHABLE_KEY)
        assertSupabaseBrowserKey(config.env.VITE_SUPABASE_ANON_KEY)
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Archivos estáticos que deben estar disponibles offline
      includeAssets: ['logos/farma-pos.png', 'logos/farma-pos-pwa.png'],
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: 'Farma POS',
        short_name: 'Farma POS',
        description: 'Sistema de gestión para farmacia multi-sede — POS, inventario, lotes y vencimientos',
        theme_color: '#0B8D63',      // verde farmacéutico — color del logo
        background_color: '#F8FAFB', // gris hielo
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'logos/farma-pos-pwa.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'logos/farma-pos-pwa.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'logos/farma-pos-pwa.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        shortcuts: [
          {
            name: "Vender Rápido",
            short_name: "Vender",
            description: "Abrir directamente el Punto de Venta",
            url: "/?view=ventas",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Revisar Inventario",
            short_name: "Inventario",
            description: "Abrir catálogo de productos",
            url: "/?view=catalogo",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons: ['lucide-react'],
          pdf: ['jspdf', 'html2canvas'],
          cloud: ['@supabase/supabase-js']
        }
      }
    }
  },
})