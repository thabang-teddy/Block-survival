/**
 * Keeps Windows from sleeping while anyone plays (docs/pc-host-research.md §5.2). Node
 * cannot call SetThreadExecutionState itself, so a tiny PowerShell helper does: it asks
 * for ES_CONTINUOUS | ES_SYSTEM_REQUIRED and holds it for as long as it runs. Killing the
 * helper lets Windows sleep again. Elsewhere than Windows this does nothing.
 */
import { spawn, type ChildProcess } from 'node:child_process'

const SCRIPT = [
  "Add-Type -Namespace BlockSurvival -Name Power -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
  // ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x1)
  '[void][BlockSurvival.Power]::SetThreadExecutionState([uint32]"0x80000001")',
  'while ($true) { Start-Sleep -Seconds 60 }',
].join('; ')

export class KeepAwake {
  private helper: ChildProcess | null = null

  constructor(private readonly onError: (msg: string) => void = () => {}) {}

  set(on: boolean): void {
    if (process.platform !== 'win32') return
    if (on && !this.helper) this.start()
    else if (!on && this.helper) this.release()
  }

  private start(): void {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', err => { this.onError(`could not keep the PC awake: ${err.message}`); this.helper = null })
    child.on('exit', () => { if (this.helper === child) this.helper = null })
    this.helper = child
  }

  release(): void {
    this.helper?.kill()
    this.helper = null
  }
}
