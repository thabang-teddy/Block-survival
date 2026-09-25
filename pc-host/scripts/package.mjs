// Assembles release/pc-host/: a folder to copy to the host PC (docs/pc-host-research.md §5.2).
// It holds a portable node.exe (the one running this script), the bundled app, the
// production node_modules (node-datachannel's native .node file must sit there),
// config.example.json and the WinSW service definition. WinSW itself is not bundled:
// download WinSW-x64.exe from its GitHub releases and put it next to the XML (README).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'release', 'pc-host')
if (!existsSync(join(root, 'dist', 'pc-host.mjs'))) throw new Error('Run `npm run build` first')
if (process.platform !== 'win32') console.warn('Not on Windows: node.exe and the native module will be for this platform, not the host PC')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'dist'), join(out, 'dist'), { recursive: true })
for (const f of ['package.json', 'package-lock.json', 'config.example.json', 'README.md']) cpSync(join(root, f), join(out, f))
cpSync(join(root, 'windows', 'pc-host-service.xml'), join(out, 'pc-host-service.xml'))
cpSync(join(root, 'windows', 'pc-host.cmd'), join(out, 'pc-host.cmd'))
cpSync(process.execPath, join(out, process.platform === 'win32' ? 'node.exe' : basename(process.execPath)))

// only what runs: node-datachannel (and its prebuilt binary for this platform)
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: out, stdio: 'inherit' })

console.log(`\nPackaged ${out} (Node ${process.version}). Next: copy it to the host PC, fill in config.json, add WinSW.`)
