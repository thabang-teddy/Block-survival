/**
 * The game's own tests (world, mesher, physics, items, zombies, netcode, the host sim):
 * plain Vitest over inertia/, without the AdonisJS Vite plugin. The server's tests run
 * with Japa (`npm test`).
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@/': `${import.meta.dirname}/inertia/` },
  },
  test: {
    include: ['inertia/**/__tests__/**/*.test.ts'],
    // terrain tests generate dozens of chunk columns; on a slow machine, with the
    // other files running alongside, that runs past the 5 s default
    testTimeout: 30_000,
  },
})
