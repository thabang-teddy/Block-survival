import { defineConfig, stores } from '@adonisjs/limiter'

/**
 * One Node process serves the whole game (the rooms live in its memory too), so the
 * rate-limit counters can live there as well.
 */
const limiterConfig = defineConfig({
  default: 'memory',
  stores: {
    memory: stores.memory({}),
  },
})

export default limiterConfig

declare module '@adonisjs/limiter/types' {
  export interface LimitersList extends InferLimiters<typeof limiterConfig> {}
}
