import { defineConfig } from '@adonisjs/inertia';
const inertiaConfig = defineConfig({
    rootView: 'inertia_layout',
    ssr: {
        enabled: false,
        entrypoint: 'inertia/app.tsx',
    },
});
export default inertiaConfig;
//# sourceMappingURL=inertia.js.map