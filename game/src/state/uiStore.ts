/**
 * UI-only store. The sim publishes a small snapshot each frame; `sync` only
 * triggers a React render when something visible actually changed.
 */
import { create } from 'zustand'
import type { ItemStack } from '../items/inventory'
import type { CameraMode } from '../game/Game'

export interface UiSnapshot {
  locked: boolean
  hotbarSlot: number
  inventoryVersion: number
  hotbar: readonly (ItemStack | null)[]
  targetBlock: number
  position: [number, number, number]
  health: number
  stamina: number
  ammo: { mag: number; reserve: number } | null
  cameraMode: CameraMode
  /** 0..1 while digging */
  breakProgress: number
  /** false when the targeted block needs a pickaxe you are not holding */
  canBreak: boolean
}

interface UiState extends UiSnapshot {
  sync(next: UiSnapshot): void
}

const roundPos = (p: [number, number, number]): [number, number, number] =>
  [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10]
const q = (v: number, step: number): number => Math.round(v / step) * step

export const useUiStore = create<UiState>((set, get) => ({
  locked: false,
  hotbarSlot: 0,
  inventoryVersion: -1,
  hotbar: [],
  targetBlock: 0,
  position: [0, 0, 0],
  health: 100,
  stamina: 100,
  ammo: null,
  cameraMode: 'first',
  breakProgress: 0,
  canBreak: true,
  sync(next) {
    const cur = get()
    const pos = roundPos(next.position)
    const health = q(next.health, 1)
    const stamina = q(next.stamina, 1)
    const breakProgress = q(next.breakProgress, 0.02)
    const ammoSame = (cur.ammo === null) === (next.ammo === null) &&
      (!next.ammo || (cur.ammo!.mag === next.ammo.mag && cur.ammo!.reserve === next.ammo.reserve))
    if (
      cur.locked === next.locked &&
      cur.hotbarSlot === next.hotbarSlot &&
      cur.inventoryVersion === next.inventoryVersion &&
      cur.targetBlock === next.targetBlock &&
      cur.health === health && cur.stamina === stamina && ammoSame &&
      cur.cameraMode === next.cameraMode &&
      cur.breakProgress === breakProgress && cur.canBreak === next.canBreak &&
      cur.position[0] === pos[0] && cur.position[1] === pos[1] && cur.position[2] === pos[2]
    ) return
    set({
      locked: next.locked,
      hotbarSlot: next.hotbarSlot,
      inventoryVersion: next.inventoryVersion,
      hotbar: cur.inventoryVersion === next.inventoryVersion ? cur.hotbar : next.hotbar,
      targetBlock: next.targetBlock,
      position: pos,
      health, stamina,
      ammo: ammoSame ? cur.ammo : next.ammo,
      cameraMode: next.cameraMode,
      breakProgress,
      canBreak: next.canBreak,
    })
  },
}))
