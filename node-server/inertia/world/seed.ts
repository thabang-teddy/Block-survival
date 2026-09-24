/**
 * World seeds (issue #5). A player's own world gets a random seed when it is created;
 * the shared global world is always the classic seed, so everyone recognises the map
 * even though each player keeps their own builds in it.
 */
import { ISLAND_LARGE } from './islandGen.ts'

export type WorldKind = 'own' | 'global'

export const GLOBAL_SEED: number = ISLAND_LARGE.seed

/** a fresh 31-bit seed for a new own world; never the global one */
export function newWorldSeed(random: () => number = cryptoRandom): number {
  for (;;) {
    const seed = Math.floor(random() * 0x7fffffff)
    if (seed !== GLOBAL_SEED && seed > 0) return seed
  }
}

function cryptoRandom(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] / 0x100000000
}

/** short tag a player can recognise a world by ("#1a2b3c") */
export const seedTag = (seed: number): string => `#${(seed >>> 0).toString(16).padStart(6, '0').slice(-6)}`
