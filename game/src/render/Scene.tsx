/**
 * R3F scene: sky, sun, chunk group, block highlight, and the sim tick.
 */
import { Suspense, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stats } from '@react-three/drei'
import * as THREE from 'three'
import { Game } from '../game/Game'
import { PlayerBody } from './PlayerBody'
import { Lighting } from './Lighting'
import { Effects } from './Effects'
import { useUiStore } from '../state/uiStore'

const SKY_COLOUR = '#87b4d8'

function GameLoop() {
  const { gl, camera } = useThree()
  const [game, setGame] = useState<Game | null>(null)

  // created in an effect (not useMemo) so StrictMode's double-mount disposes the first copy
  useEffect(() => {
    const g = new Game(gl.domElement, camera as THREE.PerspectiveCamera)
    setGame(g)
    useUiStore.getState().setGame(g)
    if (import.meta.env.DEV) Object.assign(window, { __game: g, __gl: gl })
    return () => {
      g.dispose()
      setGame(null)
      useUiStore.getState().setGame(null)
    }
  }, [gl, camera])

  useFrame((_, dt) => game?.update(dt))

  if (!game) return null
  return (
    <>
      {/* the camera must be in the scene graph for the first-person view-model (its child) to render */}
      <primitive object={camera} />
      <Lighting game={game} />
      <primitive object={game.chunks.group} />
      <primitive object={game.props.group} />
      <primitive object={game.drops.group} />
      <primitive object={game.zombieRenderer.group} />
      <primitive object={game.fx.group} />
      <primitive object={game.highlight} />
      <primitive object={game.heldLight} />
      <Suspense fallback={null}>
        <PlayerBody game={game} />
      </Suspense>
      <Effects />
    </>
  )
}

export function Scene() {
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ fov: 75, near: 0.05, far: 400, position: [0, 4, 0] }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ scene }) => { scene.background = new THREE.Color(SKY_COLOUR) }}
      style={{ position: 'fixed', inset: 0 }}
    >
      <GameLoop />
      <Stats className="stats" />
    </Canvas>
  )
}
