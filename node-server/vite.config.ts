import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import adonisjs from '@adonisjs/vite/client'

export default defineConfig({
  plugins: [
    react(),
    // public/assets holds the game's models, so the bundle goes to public/build (as in the Laravel app)
    adonisjs({ entryPoints: ['inertia/app.tsx'], buildDirectory: 'public/build', reload: ['resources/views/**/*.edge'] }),
  ],
  resolve: {
    alias: {
      '@/': `${import.meta.dirname}/inertia/`,
    },
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
    watch: {
      ignored: ['**/storage/**', '**/tmp/**'],
    },
  },
})
