// Shared by the build and the tests: the game code lives once, in the web client
// (server/resources/js), and the PC imports it through `@game/*`.
import { fileURLToPath } from 'node:url'

export const GAME_DIR = fileURLToPath(new URL('../server/resources/js/', import.meta.url))
export const HEADLESS_ASSETS = fileURLToPath(new URL('./src/headless/assets.ts', import.meta.url))
/** the model loader, as the shared entity code imports it */
export const ASSETS_IMPORT = /^\.\.\/render\/assets$/
