/**
 * GLB cache for plain-TS code (the sim, view-model, drops). React components use
 * drei's useGLTF, which shares three's loader cache with this module.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Group>>()

/**
 * Load (once) and return a fresh clone of a static (non-skinned) model.
 * A model that fails to load yields an empty group (and one warning) rather than
 * rejecting — a missing prop must never take the game down.
 */
export function loadModel(url: string): Promise<THREE.Group> {
  let p = cache.get(url)
  if (!p) {
    p = loader.loadAsync(url).then(gltf => {
      gltf.scene.traverse(o => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      return gltf.scene
    }).catch((err: unknown) => {
      console.warn(`could not load ${url}`, err)
      return new THREE.Group()
    })
    cache.set(url, p)
  }
  return p.then(scene => scene.clone(true))
}
