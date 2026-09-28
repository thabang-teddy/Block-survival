/**
 * Third-person player body: Survivor.glb following the sim's player state,
 * cross-fading Idle/Walk/Run/Aim/Swing and holding the selected item in Hand_R.
 * Hidden in first person. Reused for remote players in Phase 6.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import type { Game, AnimName } from '../game/Game'
import { getItem } from '../items/registry'
import { loadModel } from './assets'
import { HAND_POSES } from './handPoses'

const URL = '/assets/Characters/Survivor.glb'
const FADE = 0.12

interface Props {
  game: Game
}

export function PlayerBody({ game }: Props) {
  const gltf = useGLTF(URL)
  const scene = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene])
  const { actions } = useAnimations(gltf.animations, scene)
  const current = useRef<AnimName | null>(null)
  const heldRef = useRef<{ id: string | null; obj: THREE.Object3D | null }>({ id: null, obj: null })

  useEffect(() => {
    scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }, [scene])

  useFrame(() => {
    const s = game.player.state
    scene.visible = game.cameraMode === 'third'
    scene.position.set(s.x, s.y, s.z)
    scene.rotation.y = s.yaw + Math.PI // model faces +Z, yaw 0 looks down -Z
    // dead: topple onto the back over the first half-second of the respawn wait
    const fallen = game.dead ? Math.min(1, Math.max(0, game.deadFor * 2)) : 0
    scene.rotation.x = -fallen * (Math.PI / 2)

    const next = game.anim
    if (next !== current.current) {
      const prev = current.current ? actions[current.current] : null
      const action = actions[next]
      if (action) {
        action.reset()
        if (next === 'Swing') {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
        }
        action.fadeIn(FADE).play()
      }
      prev?.fadeOut(FADE)
      current.current = next
    }

    const held = game.heldItem
    if (held !== heldRef.current.id) {
      heldRef.current.id = held
      const hand = scene.getObjectByName('Hand_R')
      if (heldRef.current.obj) {
        heldRef.current.obj.removeFromParent()
        heldRef.current.obj = null
      }
      const model = held ? getItem(held).model : undefined
      if (hand && model) {
        const name = model.split('/').pop()!.replace('.glb', '')
        loadModel(model).then(m => {
          if (heldRef.current.id !== held) return
          const pose = HAND_POSES[name]
          if (pose) {
            m.position.set(...pose.pos)
            m.rotation.set(...pose.rot)
            m.scale.setScalar(pose.scale)
          }
          hand.add(m)
          heldRef.current.obj = m
        })
      }
    }
  })

  return <primitive object={scene} />
}

useGLTF.preload(URL)
