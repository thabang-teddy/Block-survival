import { defineConfig } from 'vitest/config'
import { ASSETS_IMPORT, GAME_DIR, HEADLESS_ASSETS } from './aliases.mjs'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@game\/(.*)$/, replacement: `${GAME_DIR}$1` },
      { find: ASSETS_IMPORT, replacement: HEADLESS_ASSETS },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
