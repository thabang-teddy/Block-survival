/**
 * A rolling log file (docs/pc-host-research.md §5.2): one JSON line per event, rotated
 * at MAX_BYTES with KEEP old files, mirrored to stdout for WinSW's own log.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RoomLog } from './room/GameRoom'

const MAX_BYTES = 5 * 1024 * 1024
const KEEP = 3

export class FileLog implements RoomLog {
  private readonly file: string

  constructor(dir: string, private readonly echo = true) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'pc-host.log')
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.write('info', msg, data)
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.write('error', msg, data)
  }

  private write(level: string, msg: string, data?: Record<string, unknown>): void {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...data }) + '\n'
    if (this.echo) process.stdout.write(line)
    try {
      this.rotate()
      appendFileSync(this.file, line)
    } catch {
      // a full disk must not stop the world; stdout still has it
    }
  }

  private rotate(): void {
    if (!existsSync(this.file) || statSync(this.file).size < MAX_BYTES) return
    rmSync(`${this.file}.${KEEP}`, { force: true })
    for (let i = KEEP - 1; i >= 1; i--) {
      if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`)
    }
    renameSync(this.file, `${this.file}.1`)
  }
}
