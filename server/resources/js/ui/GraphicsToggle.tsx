/**
 * "Graphics: High / Low" — shown on the main menu and the pause screen. Low is for slow
 * PCs (render/graphics.ts); it applies at once, apart from antialiasing (next page load).
 */
import { useGraphicsStore } from '../state/graphicsStore'

export function GraphicsToggle() {
  const quality = useGraphicsStore(s => s.quality)
  const setQuality = useGraphicsStore(s => s.setQuality)
  const low = quality === 'low'
  return (
    <p className="fine graphics-toggle" onClick={e => e.stopPropagation()}>
      Graphics:{' '}
      <button
        className="link"
        aria-pressed={low}
        title={low ? 'Shadows, glow and full resolution back on' : 'For slow PCs: no shadows or glow, lower resolution, shorter view'}
        onClick={() => setQuality(low ? 'high' : 'low')}
      >
        {low ? 'Low' : 'High'}
      </button>
      {' '}· {low ? 'switch back to High for the full look' : 'choppy? switch to Low'}
    </p>
  )
}
