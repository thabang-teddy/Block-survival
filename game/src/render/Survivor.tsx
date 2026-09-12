/**
 * Phase 0 check: load Survivor.glb, play the Idle clip. Stands on the build pad as a
 * spawn marker until Phase 2 turns it into the third-person player body.
 */
import { useEffect, useMemo } from 'react'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'

const URL = '/assets/Characters/Survivor.glb'

interface Props {
  position: [number, number, number]
  clip?: 'Idle' | 'Walk' | 'Run' | 'Aim' | 'Swing'
}

export function Survivor({ position, clip = 'Idle' }: Props) {
  const gltf = useGLTF(URL)
  // clone so multiple instances (Phase 6) do not share one skeleton
  const scene = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene])
  const { actions } = useAnimations(gltf.animations, scene)

  useEffect(() => {
    scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }, [scene])

  useEffect(() => {
    const action = actions[clip]
    action?.reset().fadeIn(0.15).play()
    return () => { action?.fadeOut(0.15) }
  }, [actions, clip])

  return <primitive object={scene} position={position} />
}

useGLTF.preload(URL)
