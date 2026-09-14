/**
 * Keyboard + pointer-lock mouse input. Edge-triggered events (mouse buttons, hotbar keys)
 * are queued and drained once per tick so the simulation never misses a click.
 */
export interface MouseLook {
  dx: number
  dy: number
}

export type InputEvent =
  | { type: 'primary' }
  | { type: 'secondary' }
  | { type: 'hotbar'; slot: number }
  | { type: 'jump' }
  | { type: 'toggleCamera' }
  | { type: 'drop' }
  | { type: 'reload' }
  | { type: 'inventory' }
  | { type: 'interact' }

const KEY_EVENTS: Readonly<Record<string, InputEvent>> = {
  KeyV: { type: 'toggleCamera' },
  KeyQ: { type: 'drop' },
  KeyR: { type: 'reload' },
  KeyE: { type: 'inventory' },
  KeyF: { type: 'interact' },
}

/**
 * Chromium on Windows sometimes emits a single pointer-lock `mousemove` with an absurd
 * `movementX/Y` (hundreds to thousands of px) during a fast flick. A real move between two
 * events, even at 1000 Hz polling, is far below this — anything larger is discarded.
 */
export const MAX_EVENT_DELTA = 300

/** the subset of `document` / the canvas the input layer touches (fakeable in tests) */
export interface InputTarget {
  addEventListener(type: string, listener: (e: any) => void): void
  removeEventListener(type: string, listener: (e: any) => void): void
}
export interface InputDocument extends InputTarget {
  pointerLockElement: Element | null
  exitPointerLock(): void
  visibilityState?: string
}
export interface InputCanvas extends InputTarget {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void
}

export class Input {
  private readonly keys = new Set<string>()
  private readonly buttons = new Set<number>()
  private readonly look: MouseLook = { dx: 0, dy: 0 }
  private queue: InputEvent[] = []
  private readonly canvas: InputCanvas
  private readonly doc: InputDocument
  locked = false
  /** pointer-lock events discarded as spikes (shown on the dev stats line) */
  droppedSpikes = 0

  constructor(canvas: InputCanvas, doc: InputDocument = document) {
    this.canvas = canvas
    this.doc = doc
    canvas.addEventListener('click', this.onCanvasClick)
    doc.addEventListener('pointerlockchange', this.onLockChange)
    doc.addEventListener('visibilitychange', this.onVisibility)
    doc.addEventListener('mousemove', this.onMouseMove)
    doc.addEventListener('mousedown', this.onMouseDown)
    doc.addEventListener('mouseup', this.onMouseUp)
    doc.addEventListener('keydown', this.onKeyDown)
    doc.addEventListener('keyup', this.onKeyUp)
    doc.addEventListener('contextmenu', this.onContextMenu)
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.onCanvasClick)
    this.doc.removeEventListener('pointerlockchange', this.onLockChange)
    this.doc.removeEventListener('visibilitychange', this.onVisibility)
    this.doc.removeEventListener('mousemove', this.onMouseMove)
    this.doc.removeEventListener('mousedown', this.onMouseDown)
    this.doc.removeEventListener('mouseup', this.onMouseUp)
    this.doc.removeEventListener('keydown', this.onKeyDown)
    this.doc.removeEventListener('keyup', this.onKeyUp)
    this.doc.removeEventListener('contextmenu', this.onContextMenu)
  }

  isDown(code: string): boolean {
    return this.keys.has(code)
  }

  /** 0 = left, 2 = right */
  isButtonDown(button: number): boolean {
    return this.buttons.has(button)
  }

  /** Accumulated mouse delta since the last call; resets to zero. */
  takeLook(): MouseLook {
    const out = { ...this.look }
    this.clearLook()
    return out
  }

  takeEvents(): InputEvent[] {
    const out = this.queue
    this.queue = []
    return out
  }

  /** suppress the click-to-lock while a UI panel is open */
  panelOpen = false

  requestLock(): void {
    if (!this.locked) this.lock()
  }

  releaseLock(): void {
    if (this.locked) this.doc.exitPointerLock()
  }

  /**
   * Lock without OS pointer acceleration so a fast flick maps linearly to look. Chromium
   * returns a promise that rejects when the option is unsupported; Firefox returns undefined.
   */
  private lock(): void {
    let result: Promise<void> | void
    try {
      result = this.canvas.requestPointerLock({ unadjustedMovement: true })
    } catch {
      this.canvas.requestPointerLock()
      return
    }
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        try { this.canvas.requestPointerLock() } catch { /* the user will click again */ }
      })
    }
  }

  private clearLook(): void {
    this.look.dx = 0
    this.look.dy = 0
  }

  private onCanvasClick = (): void => {
    if (!this.locked && !this.panelOpen) this.lock()
  }

  private onLockChange = (): void => {
    this.locked = this.doc.pointerLockElement === (this.canvas as unknown as Element)
    // whatever accumulated while the lock was changing hands is not the player's intent
    this.clearLook()
    if (!this.locked) {
      this.keys.clear()
      this.buttons.clear()
    }
  }

  private onVisibility = (): void => {
    if (this.doc.visibilityState === 'hidden') this.clearLook()
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
    if (Math.abs(e.movementX) > MAX_EVENT_DELTA || Math.abs(e.movementY) > MAX_EVENT_DELTA) {
      this.droppedSpikes++
      return
    }
    this.look.dx += e.movementX
    this.look.dy += e.movementY
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return
    this.buttons.add(e.button)
    if (e.button === 0) this.queue.push({ type: 'primary' })
    if (e.button === 2) this.queue.push({ type: 'secondary' })
  }

  private onMouseUp = (e: MouseEvent): void => {
    this.buttons.delete(e.button)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.locked) return
    if (e.repeat) return
    this.keys.add(e.code)
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5))
      if (n >= 1 && n <= 9) this.queue.push({ type: 'hotbar', slot: n - 1 })
    }
    if (e.code === 'Space') {
      this.queue.push({ type: 'jump' })
      e.preventDefault()
    }
    if (e.code === 'Tab') e.preventDefault() // held = scoreboard; never move focus
    const mapped = KEY_EVENTS[e.code]
    if (mapped) this.queue.push(mapped)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private onContextMenu = (e: Event): void => {
    if (this.locked) e.preventDefault()
  }
}
