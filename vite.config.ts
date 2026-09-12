/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import laravel from 'laravel-vite-plugin'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    laravel({
      input: ['resources/js/app.tsx'],
      refresh: true,
    }),
    react(),
  ],
  resolve: {
    alias: { '@': '/resources/js' },
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
  server: {
    watch: { ignored: ['**/storage/**', '**/vendor/**'] },
  },
  test: {
    include: ['resources/js/**/__tests__/**/*.test.ts'],
  },
})
