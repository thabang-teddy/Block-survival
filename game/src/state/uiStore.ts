/**
 * UI-only store. The sim publishes a small snapshot each frame; `sync` only
 * triggers a React render when something visible actually changed.
 */
import { create } from 'zustand'

export interface UiSnapshot {
  locked: boolean
  hotbarSlot: number
  targetBlock: number
  position: [number, number, number]
}

interface UiState extends UiSnapshot {
  sync(next: UiSnapshot): void
}

const roundPos = (p: [number, number, number]): [number, number, number] =>
  [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10]

export const useUiStore = create<UiState>((set, get) => ({
  locked: false,
  hotbarSlot: 0,
  targetBlock: 0,
  position: [0, 0, 0],
  sync(next) {
    const cur = get()
    const pos = roundPos(next.position)
    if (
      cur.locked === next.locked &&
      cur.hotbarSlot === next.hotbarSlot &&
      cur.targetBlock === next.targetBlock &&
      cur.position[0] === pos[0] && cur.position[1] === pos[1] && cur.position[2] === pos[2]
    ) return
    set({ locked: next.locked, hotbarSlot: next.hotbarSlot, targetBlock: next.targetBlock, position: pos })
  },
}))
