/**
 * One skinned clone + AnimationMixer per live zombie, synced from the ZombieManager
 * each frame. Dying zombies fall over; burning ones sink into the ground at dawn.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ZOMBIE, type Zombie, type ZombieKind, type ZombieManager } from '../entities/zombies'

const URLS: Readonly<Record<ZombieKind, string>> = {
  Basic: '/assets/Characters/Zombie_Basic.glb',
  Worker: '/assets/Characters/Zombie_Worker.glb',
  Soldier: '/assets/Characters/Zombie_Soldier.glb',
  Toxic: '/assets/Characters/Zombie_Toxic.glb',
}

interface Instance {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Record<string, THREE.AnimationAction | undefined>
  current: string
}

const loader = new GLTFLoader()
const gltfCache = new Map<ZombieKind, Promise<GLTF>>()

function loadKind(kind: ZombieKind): Promise<GLTF> {
  let p = gltfCache.get(kind)
  if (!p) {
    p = loader.loadAsync(URLS[kind]).then(g => {
      g.scene.traverse(o => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      return g
    })
    gltfCache.set(kind, p)
  }
  return p
}

/** kick off loading so the first night does not stutter */
export function preloadZombies(): void {
  for (const k of Object.keys(URLS) as ZombieKind[]) void loadKind(k)
}

export class ZombieRenderer {
  readonly group = new THREE.Group()
  private readonly instances = new Map<number, Instance>()
  private readonly pending = new Set<number>()

  constructor() {
    this.group.name = 'zombies'
  }

  update(dt: number, manager: ZombieManager): void {
    const seen = new Set<number>()
    for (const z of manager.zombies) {
      seen.add(z.id)
      const inst = this.instances.get(z.id)
      if (!inst) {
        this.create(z)
        continue
      }
      this.sync(inst, z, dt)
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

  private create(z: Zombie): void {
    if (this.pending.has(z.id)) return
    this.pending.add(z.id)
    loadKind(z.kind).then(gltf => {
      this.pending.delete(z.id)
      const root = SkeletonUtils.clone(gltf.scene)
      const mixer = new THREE.AnimationMixer(root)
      const actions: Instance['actions'] = {}
      for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip)
      const attack = actions.Attack
      if (attack) {
        attack.setLoop(THREE.LoopOnce, 1)
        attack.clampWhenFinished = false
      }
      actions.Idle?.play()
      const inst: Instance = { root, mixer, actions, current: 'Idle' }
      this.instances.set(z.id, inst)
      this.group.add(root)
      this.sync(inst, z, 0)
    })
  }

  private sync(inst: Instance, z: Zombie, dt: number): void {
    inst.root.position.set(z.x, z.y, z.z)
    inst.root.rotation.set(0, z.yaw, 0)
    if (z.state === 'dead') {
      // topple and shrink away
      const t = 1 - z.burnTimer / ZOMBIE.deathSeconds
      inst.root.rotation.x = Math.min(1, t * 2) * (Math.PI / 2)
      inst.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, t - 0.5) * 2))
      inst.mixer.update(dt)
      return
    }
    if (z.state === 'burn') {
      const t = 1 - z.burnTimer / ZOMBIE.burnSeconds
      inst.root.position.y = z.y - t * 2.2
      this.play(inst, 'Idle')
      inst.mixer.update(dt)
      return
    }
    inst.root.scale.setScalar(1)
    if (z.attacked && inst.actions.Attack) {
      inst.actions.Attack.reset().fadeIn(0.05).play()
      inst.actions[inst.current]?.fadeOut(0.05)
      inst.current = 'Attack'
    } else if (inst.current === 'Attack' && inst.actions.Attack && !inst.actions.Attack.isRunning()) {
      inst.current = ''
    }
    if (inst.current !== 'Attack') {
      const moving = Math.hypot(z.vx, z.vz) > 0.4
      this.play(inst, moving ? 'Walk' : 'Idle')
    }
    inst.mixer.update(dt)
  }

  private play(inst: Instance, name: string): void {
    if (inst.current === name) return
    const next = inst.actions[name]
    if (!next) return
    next.reset().fadeIn(0.15).play()
    inst.actions[inst.current]?.fadeOut(0.15)
    inst.current = name
  }
}
