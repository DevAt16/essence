import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const tauriDevHost = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  root: webRoot,
  envDir: repoRoot,
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    rolldownOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/')

          if (!moduleId.includes('/node_modules/')) {
            return undefined
          }

          if (moduleId.includes('/node_modules/@tiptap/')) {
            return 'vendor-editor'
          }

          if (moduleId.includes('/node_modules/@supabase/')) {
            return 'vendor-supabase'
          }

          if (
            moduleId.includes('/node_modules/react/') ||
            moduleId.includes('/node_modules/react-dom/') ||
            moduleId.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }

          return undefined
        },
      },
    },
  },
  server: {
    host: tauriDevHost || false,
    port: 5173,
    strictPort: Boolean(process.env.TAURI_ENV_PLATFORM),
    hmr: tauriDevHost
      ? {
          protocol: 'ws',
          host: tauriDevHost,
          port: 1421,
        }
      : undefined,
    proxy: {
      '/api': 'http://localhost:4000',
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
