/**
 * Post-processing: a light UnrealBloomPass so emissive zombie eyes and torch flames glow.
 * Takes over rendering from R3F (useFrame priority 1).
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const BLOOM = { strength: 0.45, radius: 0.35, threshold: 0.9 } as const

export function Effects() {
  const { gl, scene, camera, size } = useThree()
  const composer = useMemo(() => {
    const c = new EffectComposer(gl)
    c.addPass(new RenderPass(scene, camera))
    c.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), BLOOM.strength, BLOOM.radius, BLOOM.threshold))
    c.addPass(new OutputPass())
    return c
    // size is applied in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera])

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio())
    composer.setSize(size.width, size.height)
  }, [composer, gl, size])

  useEffect(() => () => composer.dispose(), [composer])
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __composer: composer })
  }, [composer])

  useFrame(() => composer.render(), 1)
  return null
}
