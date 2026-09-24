/**
 * UI-only store. The sim publishes a small snapshot each frame; `sync` only
 * triggers a React render when something visible actually changed.
 */
import { create } from 'zustand'
import type { ItemStack } from '../items/inventory'
import type { CameraMode, Game, Panel, Role } from '../game/Game'
import type { Phase } from '../game/DayNight'
import type { ClientSession } from '../net/ClientSession'
import type { WorldKind } from '../world/seed'
import type { Where } from '../game/locator'

export interface ScoreRow {
  id: string
  name: string
  score: number
  kills: number
  deaths: number
  you: boolean
  /** distance and direction to this player (issue #15); null for you, and while the board is hidden */
  where: Where | null
}

/** a HUD marker on (or pointing at) another player; coordinates are NDC, −1..1 */
export interface PlayerMarker {
  id: string
  name: string
  /** whole metres */
  distance: number
  x: number
  y: number
  onScreen: boolean
  /** degrees clockwise from up, for the off-screen arrow */
  angle: number
}

/** a marker on a pocket of ore the prospector has found (issue #25) */
export interface OreMarker {
  /** chunk the ore sits in, so a marker keeps its identity between scans */
  id: string
  /** whole metres */
  distance: number
  /** how many blocks of ore are in that pocket */
  count: number
  x: number
  y: number
  onScreen: boolean
  angle: number
}

/** what the prospector in hand is doing; null when none is held */
export interface ProspectorState {
  /** the block id it is tuned to */
  ore: number
  /** how far it senses, in metres */
  range: number
  /** pockets within range */
  found: number
}

/**
 * How the current run was started; null = main menu. Every game runs on the server;
 * `owner` is true in the player's own world, where they can invite friends and save.
 */
export interface Launch {
  name: string
  session: ClientSession
  worldKind: WorldKind
  owner: boolean
}

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
  dead: boolean
  respawnIn: number
  score: number
  bestScore: number
  nightsSurvived: number
  deaths: number
  timeAlive: number
  /** Tab held */
  scoreboard: boolean
  /** the prospector in hand, or null (issue #25) */
  prospector: ProspectorState | null
  /** top block of the player's column, so the HUD can say how far down they are */
  surfaceY: number
  players: ScoreRow[]
  /** shown in the HUD while hosting online or joined */
  roomCode: string
  role: Role
}

interface UiState extends UiSnapshot {
  /** the live simulation, for panels that need to call actions */
  game: Game | null
  /** bumps to tear the Game down and start a fresh one */
  run: number
  launch: Launch | null
  /** 'host-left' / 'error' overlays for clients */
  netStatus: string
  netError: string
  /** where the other players are, refreshed every frame apart from the snapshot (issue #15) */
  markers: PlayerMarker[]
  /** where the prospector says the ore is, on the same footing as the player markers (issue #25) */
  oreMarkers: OreMarker[]
  setGame(game: Game | null): void
  /** start a run (solo/host/client); the Scene builds the Game from it */
  start(launch: Launch): void
  setNetStatus(status: string, error?: string): void
  /** back to the main menu (tears the Game down) */
  restart(): void
  sync(next: UiSnapshot): void
  syncMarkers(next: PlayerMarker[]): void
  syncOreMarkers(next: OreMarker[]): void
}

const roundPos = (p: [number, number, number]): [number, number, number] =>
  [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10]
const q = (v: number, step: number): number => Math.round(v / step) * step
const sameWhere = (a: Where | null, b: Where | null): boolean =>
  a === b || (!!a && !!b && a.distance === b.distance && a.bearing === b.bearing && a.dy === b.dy)
const sameRows = (a: ScoreRow[], b: ScoreRow[]): boolean =>
  a.length === b.length && a.every((r, i) => {
    const o = b[i]
    return r.id === o.id && r.name === o.name && r.score === o.score && r.kills === o.kills && r.deaths === o.deaths &&
      sameWhere(r.where, o.where)
  })
/** markers are quantised before they get here, so exact comparison is enough */
const sameMarkers = (a: PlayerMarker[], b: PlayerMarker[]): boolean =>
  a.length === b.length && a.every((m, i) => {
    const o = b[i]
    return m.id === o.id && m.name === o.name && m.distance === o.distance && m.x === o.x && m.y === o.y &&
      m.onScreen === o.onScreen && m.angle === o.angle
  })
const sameOreMarkers = (a: OreMarker[], b: OreMarker[]): boolean =>
  a.length === b.length && a.every((m, i) => {
    const o = b[i]
    return m.id === o.id && m.distance === o.distance && m.count === o.count && m.x === o.x && m.y === o.y &&
      m.onScreen === o.onScreen && m.angle === o.angle
  })
const sameProspector = (a: ProspectorState | null, b: ProspectorState | null): boolean =>
  a === b || (!!a && !!b && a.ore === b.ore && a.range === b.range && a.found === b.found)

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
  dead: false,
  respawnIn: 0,
  score: 0,
  bestScore: 0,
  nightsSurvived: 0,
  deaths: 0,
  timeAlive: 0,
  scoreboard: false,
  prospector: null,
  surfaceY: 0,
  players: [],
  roomCode: '',
  role: 'host',
  game: null,
  run: 0,
  launch: null,
  netStatus: '',
  netError: '',
  markers: [],
  oreMarkers: [],
  setGame: game => set({ game }),
  start: launch => set(state => ({ launch, run: state.run + 1, netStatus: '', netError: '' })),
  setNetStatus: (netStatus, netError = '') => set({ netStatus, netError }),
  restart: () => set(state => ({ launch: null, run: state.run + 1, netStatus: '', netError: '', markers: [], oreMarkers: [] })),
  syncMarkers(next) {
    if (!sameMarkers(get().markers, next)) set({ markers: next })
  },
  syncOreMarkers(next) {
    if (!sameOreMarkers(get().oreMarkers, next)) set({ oreMarkers: next })
  },
  sync(next) {
    const cur = get()
    const pos = roundPos(next.position)
    const health = q(next.health, 1)
    const stamina = q(next.stamina, 1)
    const breakProgress = q(next.breakProgress, 0.02)
    const respawnIn = Math.ceil(next.respawnIn)
    const timeAlive = Math.floor(next.timeAlive)
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
      cur.dead === next.dead && cur.respawnIn === respawnIn && cur.score === next.score &&
      cur.bestScore === next.bestScore && cur.nightsSurvived === next.nightsSurvived &&
      cur.deaths === next.deaths && cur.scoreboard === next.scoreboard &&
      sameProspector(cur.prospector, next.prospector) && cur.surfaceY === next.surfaceY &&
      cur.roomCode === next.roomCode && cur.role === next.role && sameRows(cur.players, next.players) &&
      (cur.timeAlive === timeAlive || !(next.scoreboard || !next.locked)) &&
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
      dead: next.dead,
      respawnIn,
      score: next.score,
      bestScore: next.bestScore,
      nightsSurvived: next.nightsSurvived,
      deaths: next.deaths,
      timeAlive,
      scoreboard: next.scoreboard,
      prospector: sameProspector(cur.prospector, next.prospector) ? cur.prospector : next.prospector,
      surfaceY: next.surfaceY,
      players: next.players,
      roomCode: next.roomCode,
      role: next.role,
    })
  },
}))
