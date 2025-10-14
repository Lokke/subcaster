import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'wavesurfer': ['wavesurfer.js']
        }
      }
    }
  },
  server: {
    proxy: {
      // Proxy all /api/* requests to unified-server
      '/api/': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        secure: false
      }
    }
  }
})