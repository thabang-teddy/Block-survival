/**
 * UI-only store. The sim publishes a small snapshot each frame; `sync` only
 * triggers a React render when something visible actually changed.
 */
import { create } from 'zustand'
import type { ItemStack } from '../items/inventory'
import type { CameraMode, Game, Panel } from '../game/Game'
import type { Phase } from '../game/DayNight'

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
  panel: Panel
  nearWorkbench: boolean
  /** transient toast, empty when none */
  message: string
  /** e.g. "F  craft" when looking at a workbench */
  interactHint: string
  /** MM:SS to the next sunset / dawn */
  timer: string
  phase: Phase
  night: number
  zombies: number
  kills: number
  /** sim time of the last hit taken; the HUD flashes when it changes */
  hurtAt: number
  poisoned: boolean
  aiming: boolean
  reloading: boolean
}

interface UiState extends UiSnapshot {
  /** the live simulation, for panels that need to call actions */
  game: Game | null
  setGame(game: Game | null): void
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
  panel: 'none',
  nearWorkbench: false,
  message: '',
  interactHint: '',
  timer: '5:00',
  phase: 'day',
  night: 0,
  zombies: 0,
  kills: 0,
  hurtAt: -10,
  poisoned: false,
  aiming: false,
  reloading: false,
  game: null,
  setGame: game => set({ game }),
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
      cur.panel === next.panel && cur.nearWorkbench === next.nearWorkbench &&
      cur.message === next.message && cur.interactHint === next.interactHint &&
      cur.timer === next.timer && cur.phase === next.phase && cur.night === next.night &&
      cur.zombies === next.zombies && cur.kills === next.kills && cur.hurtAt === next.hurtAt &&
      cur.poisoned === next.poisoned && cur.aiming === next.aiming && cur.reloading === next.reloading &&
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
      panel: next.panel,
      nearWorkbench: next.nearWorkbench,
      message: next.message,
      interactHint: next.interactHint,
      timer: next.timer,
      phase: next.phase,
      night: next.night,
      zombies: next.zombies,
      kills: next.kills,
      hurtAt: next.hurtAt,
      poisoned: next.poisoned,
      aiming: next.aiming,
      reloading: next.reloading,
    })
  },
}))
