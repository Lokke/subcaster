import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three']
        }
      }
    },
    // 🚀 Enable modern features for better performance
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false
  },
  // 🚀 Optimize dependencies for WebGPU and modern APIs
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  server: {
    // 🚀 Enable Cross-Origin Isolation for WebGPU
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    },
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