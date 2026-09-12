import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // the Laravel API (server/): `php artisan serve` on :8000
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  optimizeDeps: {
    // pre-bundle the three.js example modules with three itself so the dep optimizer
    // never discovers them mid-session and serves a second copy of three
    include: [
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/utils/SkeletonUtils.js',
      'three/examples/jsm/postprocessing/EffectComposer.js',
      'three/examples/jsm/postprocessing/RenderPass.js',
      'three/examples/jsm/postprocessing/UnrealBloomPass.js',
      'three/examples/jsm/postprocessing/OutputPass.js',
    ],
  },
})
