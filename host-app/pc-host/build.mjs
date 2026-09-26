// Bundles the host app into dist/pc-host.mjs: our code, the shared game code from
// server/resources/js and its npm packages (msgpackr, three). node-datachannel stays
// outside, because its native .node file must sit next to it in node_modules.
import { build } from 'esbuild'
import { ASSETS_IMPORT, GAME_DIR, HEADLESS_ASSETS } from './aliases.mjs'

const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/pc-host.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: ['node-datachannel', 'node-datachannel/*'],
  define: { __PC_HOST_VERSION__: JSON.stringify(pkg.version) },
  // three and msgpackr are CommonJS-free, but a `require` shim keeps any stray CJS happy
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: 'game-aliases',
    setup(b) {
      b.onResolve({ filter: /^@game\// }, args => b.resolve('./' + args.path.slice('@game/'.length), { resolveDir: GAME_DIR, kind: args.kind }))
      b.onResolve({ filter: ASSETS_IMPORT }, () => ({ path: HEADLESS_ASSETS }))
    },
  }],
  logLevel: 'info',
})
