import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // El usuario decide cuándo actualizar: un guardia en medio de un cobro no debe perder la pantalla.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icons/apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'Parkia',
          short_name: 'Parkia',
          description: 'Operación de estacionamientos: entradas, cobros y salidas, también sin conexión.',
          lang: 'es-CL',
          start_url: '/operar',
          scope: '/',
          display: 'standalone',
          background_color: '#f8fafc',
          theme_color: '#4f46e5',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [{ name: 'Operar', short_name: 'Operar', url: '/operar', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }],
        },
        workbox: {
          // Solo se guarda el "shell" de la app. Los datos de negocio NO se cachean aquí: viven en la
          // base local del dispositivo (IndexedDB) con su propia política de sincronización.
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/__e2e__\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            { urlPattern: ({ url }: { url: URL }) => url.origin === 'https://fonts.googleapis.com', handler: 'StaleWhileRevalidate' as const, options: { cacheName: 'google-fonts-css' } },
            { urlPattern: ({ url }: { url: URL }) => url.origin === 'https://fonts.gstatic.com', handler: 'CacheFirst' as const, options: { cacheName: 'google-fonts-files', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } } },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true' ? { port: 24680, clientPort: 24680 } : false, port: 3005,
    },
  };
});
