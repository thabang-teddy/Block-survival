/**
 * Reads a host token the Block Survival Host app stored with Windows DPAPI (machine
 * scope, so the service account can read what the admin's app wrote). Node has no
 * DPAPI, so Windows PowerShell does it; the ciphertext goes in on stdin and the token
 * comes back on stdout — neither ever touches the command line or the disk.
 */
import { spawn } from 'node:child_process'

const SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$in = [Console]::In.ReadToEnd().Trim()',
  "$bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $null, 'LocalMachine')",
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))',
].join('; ')

const TIMEOUT_MS = 20_000

export function unprotect(b64: string): Promise<string> {
  if (process.platform !== 'win32') return Promise.reject(new Error('DPAPI-protected tokens can only be read on Windows'))
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('reading the protected token timed out')) }, TIMEOUT_MS)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code === 0 && out.length > 0) resolve(out)
      else reject(new Error(`could not read the protected token (it was saved on another PC?): ${err.trim().split('\n')[0] ?? ''}`))
    })
    child.stdin.end(b64)
  })
}
