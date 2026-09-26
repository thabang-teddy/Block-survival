/**
 * Other players: one Survivor clone per remote avatar, driven by the poses the Game
 * exposes (host: from client inputs; client: from interpolated snapshots), with the
 * held item in Hand_R and a floating name label.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { PlayerSnap } from '../net/protocol'
import { getItem } from '../items/registry'
import { HAND_POSES } from './handPoses'
import { loadModel } from './assets'

const SURVIVOR_URL = '/assets/Characters/Survivor.glb'
const FADE = 0.12

interface Instance {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Record<string, THREE.AnimationAction | undefined>
  current: string
  held: string | null
  heldObj: THREE.Object3D | null
  label: THREE.Sprite
}

let gltfPromise: Promise<GLTF> | null = null
const loadSurvivor = (): Promise<GLTF> => {
  if (!gltfPromise) {
    gltfPromise = new GLTFLoader().loadAsync(SURVIVOR_URL).then(g => {
      g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
      return g
    })
  }
  return gltfPromise
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = '700 34px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, 256, 64)
  ctx.fillStyle = '#f2f0e8'
  ctx.fillText(text, 128, 34)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sprite.scale.set(1.6, 0.4, 1)
  sprite.position.y = 2.35
  return sprite
}

export class RemotePlayerRenderer {
  readonly group = new THREE.Group()
  private readonly instances = new Map<string, Instance>()
  private readonly pending = new Set<string>()

  constructor() {
    this.group.name = 'players'
  }

  update(dt: number, poses: Iterable<PlayerSnap>): void {
    const seen = new Set<string>()
    for (const p of poses) {
      seen.add(p.id)
      const inst = this.instances.get(p.id)
      if (!inst) { this.create(p); continue }
      this.sync(inst, p, dt)
    }
    for (const [id, inst] of this.instances) {
      if (seen.has(id)) continue
      this.group.remove(inst.root)
      this.instances.delete(id)
    }
  }

  dispose(): void {
    for (const inst of this.instances.values()) this.group.remove(inst.root)
    this.instances.clear()
  }

  private create(p: PlayerSnap): void {
    if (this.pending.has(p.id)) return
    this.pending.add(p.id)
    loadSurvivor().then(gltf => {
      this.pending.delete(p.id)
      const root = SkeletonUtils.clone(gltf.scene)
      const mixer = new THREE.AnimationMixer(root)
      const actions: Instance['actions'] = {}
      for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip)
      actions.Idle?.play()
      const label = makeLabel(p.name)
      root.add(label)
      const inst: Instance = { root, mixer, actions, current: 'Idle', held: null, heldObj: null, label }
      this.instances.set(p.id, inst)
      this.group.add(root)
      this.sync(inst, p, 0)
    })
  }

  private sync(inst: Instance, p: PlayerSnap, dt: number): void {
    inst.root.position.set(p.x, p.y, p.z)
    inst.root.rotation.set(p.dead ? -Math.PI / 2 : 0, p.yaw + Math.PI, 0)
    inst.root.visible = true
    const anim = p.dead ? 'Idle' : p.anim
    if (anim !== inst.current) {
      const next = inst.actions[anim]
      if (next) {
        next.reset()
        if (anim === 'Swing') { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true }
        next.fadeIn(FADE).play()
        inst.actions[inst.current]?.fadeOut(FADE)
        inst.current = anim
      }
    }
    if (p.held !== inst.held) {
      inst.held = p.held
      inst.heldObj?.removeFromParent()
      inst.heldObj = null
      const model = p.held ? getItem(p.held).model : undefined
      const hand = inst.root.getObjectByName('Hand_R')
      if (model && hand) {
        const name = model.split('/').pop()!.replace('.glb', '')
        loadModel(model).then(m => {
          if (inst.held !== p.held) return
          const pose = HAND_POSES[name]
          if (pose) { m.position.set(...pose.pos); m.rotation.set(...pose.rot); m.scale.setScalar(pose.scale) }
          hand.add(m)
          inst.heldObj = m
        })
      }
    }
    inst.mixer.update(dt)
  }
}
