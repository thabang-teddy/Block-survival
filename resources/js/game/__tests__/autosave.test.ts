import { describe, expect, test } from 'vitest'
import { Autosave, AUTOSAVE_SECONDS, RETRY_SECONDS } from '../autosave'

/** an upload the test resolves or rejects by hand */
function controlled() {
  const ctl = {
    calls: 0,
    resolve: () => {},
    reject: () => {},
    upload: (): Promise<void> => {
      ctl.calls++
      return new Promise<void>((res, rej) => {
        ctl.resolve = res
        ctl.reject = () => rej(new Error('offline'))
      })
    },
  }
  return ctl
}

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0))

describe('Autosave', () => {
  test('fires at the interval only when dirty', () => {
    const ctl = controlled()
    const a = new Autosave(ctl.upload)
    expect(a.tick(AUTOSAVE_SECONDS + 1)).toBe(false)
    expect(ctl.calls).toBe(0)
    a.markDirty()
    expect(a.tick(1)).toBe(true)
    expect(ctl.calls).toBe(1)
  })

  test('marking dirty late in the cycle still fires at the cycle end', () => {
    const ctl = controlled()
    const a = new Autosave(ctl.upload, 10)
    a.tick(8)
    a.markDirty()
    expect(a.tick(1)).toBe(false)
    expect(a.tick(1)).toBe(true)
  })

  test('never overlaps two uploads and restarts the clock when one begins', async () => {
    const ctl = controlled()
    const a = new Autosave(ctl.upload, 10)
    a.markDirty()
    a.tick(10)
    expect(a.inFlight).toBe(true)
    a.markDirty()
    expect(a.tick(20)).toBe(false)
    expect(ctl.calls).toBe(1)
    ctl.resolve()
    await flush()
    expect(a.inFlight).toBe(false)
    expect(a.saved).toBe(1)
    expect(a.isDirty).toBe(true)
    expect(a.tick(0)).toBe(true) // 30 s have passed since the upload began
    expect(ctl.calls).toBe(2)
  })

  test('a failed upload stays dirty and retries after RETRY_SECONDS', async () => {
    const ctl = controlled()
    const a = new Autosave(ctl.upload, 60)
    a.markDirty()
    a.tick(60)
    ctl.reject()
    await flush()
    expect(a.failed).toBe(1)
    expect(a.isDirty).toBe(true)
    expect(a.tick(RETRY_SECONDS - 1)).toBe(false)
    expect(a.tick(1)).toBe(true)
    expect(ctl.calls).toBe(2)
  })

  test('saveNow runs immediately, clears dirty and restarts the clock', async () => {
    const ctl = controlled()
    const a = new Autosave(ctl.upload, 10)
    a.tick(9)
    a.markDirty()
    const p = a.saveNow()
    expect(ctl.calls).toBe(1)
    expect(a.isDirty).toBe(false)
    ctl.resolve()
    await p
    await flush()
    a.markDirty()
    expect(a.tick(9)).toBe(false)
    expect(a.tick(1)).toBe(true)
  })

  test('saveNow during an upload queues exactly one more upload', async () => {
    const ctl = controlled()
    const a = new Autosave(ctl.upload, 10)
    a.markDirty()
    a.tick(10)
    const first = ctl.resolve
    const p = a.saveNow()
    const p2 = a.saveNow()
    expect(ctl.calls).toBe(1)
    first()
    await flush()
    expect(ctl.calls).toBe(2)
    ctl.resolve()
    await Promise.all([p, p2])
    expect(a.saved).toBe(2)
    expect(a.inFlight).toBe(false)
  })

  test('a rejected saveNow surfaces to the caller, queued or not', async () => {
    const ctl = controlled()
    const a = new Autosave(ctl.upload)
    const p = a.saveNow()
    ctl.reject()
    await expect(p).rejects.toThrow('offline')
    const q1 = a.saveNow()
    const q2 = a.saveNow()
    ctl.resolve()
    await q1
    await flush()
    ctl.reject()
    await expect(q2).rejects.toThrow('offline')
  })
})
