import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * The Apps Script Web App path. Traffic is proxied in development so the app
 * never depends on Apps Script's CORS headers while running on localhost.
 */
const APPS_SCRIPT_PATH =
  '/macros/s/AKfycbxM8GUKKRaprp8MVAP7V5fL1JnBA6l-X8DdKUJsW_y7XGIjsfeo4GBAESTrwB73nB3Fnw/exec'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Charting and animation are the heavy, rarely-changing dependencies.
        // Splitting them keeps app-code deploys from invalidating them.
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory'))
            return 'charts'
          if (id.includes('framer-motion') || id.includes('motion-')) return 'motion'
          return 'vendor'
        },
      },
    },
  },
  server: {
    proxy: {
      '/luora-api': {
        target: 'https://script.google.com',
        changeOrigin: true,
        secure: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/luora-api/, APPS_SCRIPT_PATH),
      },
    },
  },
})
