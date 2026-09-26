/**
 * Graphics quality: 'high' is the full look, 'low' is for slow PCs — no shadows, no
 * bloom, no antialiasing, fewer pixels and a shorter view. It only changes what is
 * drawn: the chunks streamed around the player (and so the simulation) stay the same.
 * The choice is remembered per browser.
 */
import { CHUNK } from '../world/chunkStore'
import { LOAD_RADIUS } from '../world/chunkStreamer'

export type GraphicsQuality = 'high' | 'low'

export interface GraphicsSettings {
  shadows: boolean
  bloom: boolean
  /** a WebGL context flag: only read when the canvas is created */
  antialias: boolean
  /** [min, max] device pixel ratio for the canvas */
  dpr: [number, number]
  /** chunks drawn around the camera before the fog closes */
  viewChunks: number
  /** the camera's far plane; chunk meshes past it are culled */
  cameraFar: number
}

export const GRAPHICS_KEY = 'block-survival:graphics'

/** what the low setting keeps; 0.75 of a pixel per CSS pixel is soft but ~45% cheaper */
const LOW_DPR = 0.75
const LOW_VIEW_CHUNKS = 4
/** the far plane the scene has always used on high */
const HIGH_CAMERA_FAR = 400

/** the fog closes just inside the drawn radius so the world's edge is never seen */
export const fogFarFor = (viewChunks: number): number => (viewChunks + 0.5) * CHUNK

const SETTINGS: Record<GraphicsQuality, GraphicsSettings> = {
  high: { shadows: true, bloom: true, antialias: true, dpr: [1, 2], viewChunks: LOAD_RADIUS, cameraFar: HIGH_CAMERA_FAR },
  low: {
    shadows: false, bloom: false, antialias: false, dpr: [LOW_DPR, LOW_DPR], viewChunks: LOW_VIEW_CHUNKS,
    // a chunk past the fog, so nothing visible is clipped
    cameraFar: fogFarFor(LOW_VIEW_CHUNKS) + CHUNK,
  },
}

export const graphicsFor = (quality: GraphicsQuality): GraphicsSettings => SETTINGS[quality]

/** the part of Storage used here, so tests can pass a fake */
export type QualityStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadQuality(storage: QualityStorage | undefined): GraphicsQuality {
  try {
    return storage?.getItem(GRAPHICS_KEY) === 'low' ? 'low' : 'high'
  } catch {
    return 'high'
  }
}

export function saveQuality(storage: QualityStorage | undefined, quality: GraphicsQuality): void {
  try {
    storage?.setItem(GRAPHICS_KEY, quality)
  } catch {
    // private mode / blocked storage: the choice lasts until the page is closed
  }
}

/** the browser's localStorage, or undefined where reading it throws (sandboxed frames) */
export function browserStorage(): QualityStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
