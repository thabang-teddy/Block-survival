import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import adonisjs from '@adonisjs/vite/client';
export default defineConfig({
    plugins: [
        react(),
        adonisjs({ entryPoints: ['inertia/app.tsx'], buildDirectory: 'public/build', reload: ['resources/views/**/*.edge'] }),
    ],
    resolve: {
        alias: {
            '@/': `${import.meta.dirname}/inertia/`,
        },
    },
    optimizeDeps: {
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
});
//# sourceMappingURL=vite.config.js.map