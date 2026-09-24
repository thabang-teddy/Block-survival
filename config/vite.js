import { defineConfig } from '@adonisjs/vite';
const viteBackendConfig = defineConfig({
    buildDirectory: 'public/build',
    manifestFile: 'public/build/.vite/manifest.json',
    assetsUrl: '/build',
    scriptAttributes: {
        defer: true,
    },
});
export default viteBackendConfig;
//# sourceMappingURL=vite.js.map