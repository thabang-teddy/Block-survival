import { describe, expect, it } from 'vitest'
import { fogFarFor, GRAPHICS_KEY, graphicsFor, loadQuality, saveQuality, type QualityStorage } from '../graphics'
import { LOAD_RADIUS } from '../../world/chunkStreamer'

const memory = (initial: Record<string, string> = {}): QualityStorage & { data: Record<string, string> } => {
  const data = { ...initial }
  return {
    data,
    getItem: k => data[k] ?? null,
    setItem: (k, v) => { data[k] = v },
  }
}

const broken: QualityStorage = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
}

describe('graphicsFor', () => {
  it('keeps every effect on high', () => {
    const g = graphicsFor('high')
    expect(g.shadows).toBe(true)
    expect(g.bloom).toBe(true)
    expect(g.antialias).toBe(true)
    expect(g.viewChunks).toBe(LOAD_RADIUS)
  })

  it('turns the expensive effects off and draws fewer pixels on low', () => {
    const g = graphicsFor('low')
    expect(g.shadows).toBe(false)
    expect(g.bloom).toBe(false)
    expect(g.antialias).toBe(false)
    expect(g.dpr[1]).toBeLessThanOrEqual(1)
    expect(g.viewChunks).toBeLessThan(LOAD_RADIUS)
    expect(g.cameraFar).toBeLessThan(graphicsFor('high').cameraFar)
  })

  it('never clips what the fog still shows', () => {
    for (const q of ['high', 'low'] as const) {
      const g = graphicsFor(q)
      expect(g.cameraFar).toBeGreaterThan(fogFarFor(g.viewChunks))
    }
  })
})

describe('loadQuality', () => {
  it('defaults to high when nothing is saved', () => {
    expect(loadQuality(memory())).toBe('high')
  })

  it('reads a saved choice', () => {
    expect(loadQuality(memory({ [GRAPHICS_KEY]: 'low' }))).toBe('low')
  })

  it('ignores a value it does not know', () => {
    expect(loadQuality(memory({ [GRAPHICS_KEY]: 'ultra' }))).toBe('high')
  })

  it('falls back to high when storage is missing or blocked', () => {
    expect(loadQuality(undefined)).toBe('high')
    expect(loadQuality(broken)).toBe('high')
  })
})

describe('saveQuality', () => {
  it('stores the choice so the next load finds it', () => {
    const store = memory()
    saveQuality(store, 'low')
    expect(loadQuality(store)).toBe('low')
  })

  it('does not throw when storage is missing or blocked', () => {
    expect(() => saveQuality(undefined, 'low')).not.toThrow()
    expect(() => saveQuality(broken, 'low')).not.toThrow()
  })
})
