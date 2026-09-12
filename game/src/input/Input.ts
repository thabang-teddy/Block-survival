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

export class Input {
  private readonly keys = new Set<string>()
  private readonly buttons = new Set<number>()
  private readonly look: MouseLook = { dx: 0, dy: 0 }
  private queue: InputEvent[] = []
  private readonly canvas: HTMLElement
  locked = false

  constructor(canvas: HTMLElement) {
    this.canvas = canvas
    canvas.addEventListener('click', this.onCanvasClick)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('contextmenu', this.onContextMenu)
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.onCanvasClick)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('contextmenu', this.onContextMenu)
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
    this.look.dx = 0
    this.look.dy = 0
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
    if (!this.locked) this.canvas.requestPointerLock()
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock()
  }

  private onCanvasClick = (): void => {
    if (!this.locked && !this.panelOpen) this.canvas.requestPointerLock()
  }

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked) {
      this.keys.clear()
      this.buttons.clear()
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
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
