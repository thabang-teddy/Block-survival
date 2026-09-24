import { defineConfig } from '@adonisjs/inertia'

const inertiaConfig = defineConfig({
  /** the root template of every page (resources/views/inertia_layout.edge) */
  rootView: 'inertia_layout',
  ssr: {
    enabled: false,
    entrypoint: 'inertia/app.tsx',
  },
})

export default inertiaConfig
