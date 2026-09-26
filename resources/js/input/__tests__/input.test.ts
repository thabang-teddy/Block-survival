import { describe, expect, it } from 'vitest'
import { Input, MAX_EVENT_DELTA, type InputCanvas, type InputDocument } from '../Input'

type Listener = (e: any) => void

/** the few DOM bits Input touches, with a way to fire events from the test */
class FakeTarget {
  readonly listeners = new Map<string, Listener[]>()
  addEventListener(type: string, l: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l])
  }
  removeEventListener(type: string, l: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(x => x !== l))
  }
  fire(type: string, e: unknown = {}): void {
    for (const l of this.listeners.get(type) ?? []) l(e)
  }
}

class FakeCanvas extends FakeTarget implements InputCanvas {
  calls: (object | undefined)[] = []
  mode: 'promise-ok' | 'promise-reject' | 'throw' | 'undefined' = 'promise-ok'
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void {
    this.calls.push(options)
    // only the call with options can fail: the plain fallback always succeeds
    if (this.mode === 'throw') {
      if (options) throw new TypeError('unsupported')
      return undefined
    }
    if (this.mode === 'undefined') return undefined
    return this.mode === 'promise-ok' || !options ? Promise.resolve() : Promise.reject(new Error('no'))
  }
}

class FakeDoc extends FakeTarget implements InputDocument {
  pointerLockElement: Element | null = null
  visibilityState = 'visible'
  exitPointerLock(): void {
    this.pointerLockElement = null
    this.fire('pointerlockchange')
  }
}

function setup(): { input: Input; canvas: FakeCanvas; doc: FakeDoc; lock: () => void } {
  const canvas = new FakeCanvas()
  const doc = new FakeDoc()
  const input = new Input(canvas, doc)
  const lock = (): void => {
    doc.pointerLockElement = canvas as unknown as Element
    doc.fire('pointerlockchange')
  }
  return { input, canvas, doc, lock }
}

describe('Input mouse look', () => {
  it('accumulates ordinary movement and resets on takeLook', () => {
    const { input, doc, lock } = setup()
    lock()
    doc.fire('mousemove', { movementX: 12, movementY: -3 })
    doc.fire('mousemove', { movementX: 5, movementY: 1 })
    expect(input.takeLook()).toEqual({ dx: 17, dy: -2 })
    expect(input.takeLook()).toEqual({ dx: 0, dy: 0 })
  })

  it('discards a pointer-lock spike instead of clamping it', () => {
    const { input, doc, lock } = setup()
    lock()
    doc.fire('mousemove', { movementX: 5000, movementY: 0 })
    doc.fire('mousemove', { movementX: 0, movementY: -(MAX_EVENT_DELTA + 1) })
    doc.fire('mousemove', { movementX: 4, movementY: 4 })
    expect(input.takeLook()).toEqual({ dx: 4, dy: 4 })
    expect(input.droppedSpikes).toBe(2)
  })

  it('ignores movement while unlocked', () => {
    const { input, doc } = setup()
    doc.fire('mousemove', { movementX: 40, movementY: 40 })
    expect(input.takeLook()).toEqual({ dx: 0, dy: 0 })
  })

  it('clears accumulated look when the lock changes hands', () => {
    const { input, doc, lock } = setup()
    lock()
    doc.fire('mousemove', { movementX: 90, movementY: 90 })
    doc.exitPointerLock()
    expect(input.locked).toBe(false)
    lock()
    expect(input.takeLook()).toEqual({ dx: 0, dy: 0 })
  })

  it('clears accumulated look when the tab is hidden', () => {
    const { input, doc, lock } = setup()
    lock()
    doc.fire('mousemove', { movementX: 90, movementY: 90 })
    doc.visibilityState = 'hidden'
    doc.fire('visibilitychange')
    expect(input.takeLook()).toEqual({ dx: 0, dy: 0 })
  })

  it('drops held keys and buttons on unlock', () => {
    const { input, doc, lock } = setup()
    lock()
    doc.fire('keydown', { code: 'KeyW', repeat: false, preventDefault: () => {} })
    doc.fire('mousedown', { button: 0 })
    expect(input.isDown('KeyW')).toBe(true)
    expect(input.isButtonDown(0)).toBe(true)
    doc.exitPointerLock()
    expect(input.isDown('KeyW')).toBe(false)
    expect(input.isButtonDown(0)).toBe(false)
  })
})

describe('Input pointer lock request', () => {
  it('asks for unadjusted movement', () => {
    const { input, canvas } = setup()
    input.requestLock()
    expect(canvas.calls).toEqual([{ unadjustedMovement: true }])
  })

  it('falls back to a plain lock when the option throws', () => {
    const { input, canvas } = setup()
    canvas.mode = 'throw'
    input.requestLock()
    expect(canvas.calls).toEqual([{ unadjustedMovement: true }, undefined])
  })

  it('falls back to a plain lock when the promise rejects', async () => {
    const { input, canvas } = setup()
    canvas.mode = 'promise-reject'
    input.requestLock()
    await new Promise(r => setTimeout(r, 0))
    expect(canvas.calls).toEqual([{ unadjustedMovement: true }, undefined])
  })

  it('works when requestPointerLock returns nothing (Firefox)', () => {
    const { input, canvas } = setup()
    canvas.mode = 'undefined'
    input.requestLock()
    expect(canvas.calls).toEqual([{ unadjustedMovement: true }])
  })

  it('does not lock from a canvas click while a panel is open', () => {
    const { input, canvas } = setup()
    input.panelOpen = true
    canvas.fire('click')
    expect(canvas.calls).toEqual([])
  })
})
