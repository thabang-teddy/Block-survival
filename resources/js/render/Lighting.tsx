/**
 * Sun, hemisphere light, sky colour and fog driven by the DayNight clock every frame.
 * Palettes are taken from the concept art (daylight, orange sunset, deep blue night).
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Game } from '../game/Game'
import { CHUNK } from '../world/chunkStore'
import { LOAD_RADIUS } from '../world/chunkStreamer'

interface Palette {
  sky: THREE.Color
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemi: number
  sun: THREE.Color
  sunIntensity: number
}

const DAY: Palette = {
  sky: new THREE.Color('#87b4d8'), hemiSky: new THREE.Color('#dfefff'), hemiGround: new THREE.Color('#6a5a3a'),
  hemi: 1.0, sun: new THREE.Color('#fff2d0'), sunIntensity: 2.4,
}
const SUNSET: Palette = {
  sky: new THREE.Color('#d9773f'), hemiSky: new THREE.Color('#f0b080'), hemiGround: new THREE.Color('#3a2a3a'),
  hemi: 0.55, sun: new THREE.Color('#ffa060'), sunIntensity: 1.3,
}
const NIGHT: Palette = {
  sky: new THREE.Color('#16223f'), hemiSky: new THREE.Color('#4a60b0'), hemiGround: new THREE.Color('#1a1a28'),
  hemi: 0.32, sun: new THREE.Color('#a0b0e0'), sunIntensity: 0.24,
}

const SUN_DISTANCE = 120
/** the fog closes just inside the streamed radius so the world's edge is never seen */
const FOG_FAR = (LOAD_RADIUS + 0.5) * CHUNK
const FOG_NEAR = FOG_FAR * 0.55

export function Lighting({ game }: { game: Game }) {
  const { scene } = useThree()
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const fog = useMemo(() => new THREE.Fog(DAY.sky.clone(), FOG_NEAR, FOG_FAR), [])
  const tmp = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color() }), [])

  const mix = (pick: (p: Palette) => THREE.Color, w: { day: number; sunset: number; night: number }): THREE.Color => {
    tmp.a.copy(pick(DAY)).multiplyScalar(w.day)
    tmp.b.copy(pick(SUNSET)).multiplyScalar(w.sunset)
    tmp.a.add(tmp.b)
    tmp.b.copy(pick(NIGHT)).multiplyScalar(w.night)
    return tmp.a.add(tmp.b)
  }
  const mixN = (pick: (p: Palette) => number, w: { day: number; sunset: number; night: number }): number =>
    pick(DAY) * w.day + pick(SUNSET) * w.sunset + pick(NIGHT) * w.night

  useFrame(() => {
    const sky = game.dayNight.sky()
    const bg = mix(p => p.sky, sky)
    if (scene.background instanceof THREE.Color) scene.background.copy(bg)
    else scene.background = bg.clone()
    fog.color.copy(bg)
    if (scene.fog !== fog) scene.fog = fog
    if (hemi.current) {
      hemi.current.color.copy(mix(p => p.hemiSky, sky))
      hemi.current.groundColor.copy(mix(p => p.hemiGround, sky))
      hemi.current.intensity = mixN(p => p.hemi, sky)
    }
    if (sun.current) {
      // at night the "sun" becomes a dim moon opposite the sun's position; the light and
      // its shadow frustum travel with the player, the world has no centre to sit at
      const up = sky.sunY >= 0
      const s = up ? 1 : -1
      const pos = game.player.state
      sun.current.position.set(
        pos.x + sky.sunX * s * SUN_DISTANCE,
        pos.y + Math.max(0.15, sky.sunY * s) * SUN_DISTANCE,
        pos.z + sky.sunZ * SUN_DISTANCE,
      )
      sun.current.target.position.set(pos.x, pos.y, pos.z)
      sun.current.target.updateMatrixWorld()
      sun.current.color.copy(mix(p => p.sun, sky))
      sun.current.intensity = mixN(p => p.sunIntensity, sky)
    }
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={[DAY.hemiSky, DAY.hemiGround, DAY.hemi]} />
      <directionalLight
        ref={sun}
        position={[60, 80, 30]}
        intensity={DAY.sunIntensity}
        color={DAY.sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-near={10}
        shadow-camera-far={250}
      />
    </>
  )
}
