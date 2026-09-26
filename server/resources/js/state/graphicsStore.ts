/**
 * The graphics quality the renderer and the menus share (render/graphics.ts).
 */
import { create } from 'zustand'
import { browserStorage, loadQuality, saveQuality, type GraphicsQuality } from '../render/graphics'

interface GraphicsState {
  quality: GraphicsQuality
  setQuality(quality: GraphicsQuality): void
}

export const useGraphicsStore = create<GraphicsState>(set => ({
  quality: loadQuality(browserStorage()),
  setQuality(quality) {
    saveQuality(browserStorage(), quality)
    set({ quality })
  },
}))
