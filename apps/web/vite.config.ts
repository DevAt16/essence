import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: webRoot,
  envDir: repoRoot,
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
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
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
