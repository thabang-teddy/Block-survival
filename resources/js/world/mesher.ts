/**
 * Culled chunk mesher. Emits only exposed faces (same rule as `add_voxels` in blocks.py),
 * with per-vertex colours from the palette and baked 4-level ambient occlusion.
 * Produces two geometries per chunk: opaque and translucent (water, glass).
 */
import { CHUNK, type World } from './chunkStore'
import { AIR, BLOCK, BLOCK_DEFS, isProp, isSeeThrough, isTranslucent, type BlockId, type Rgb } from './palette'

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array // RGBA
  indices: Uint32Array
}

export interface ChunkMesh {
  opaque: MeshData | null
  translucent: MeshData | null
}

type Face = {
  n: readonly [number, number, number]
  corners: readonly (readonly [number, number, number])[] // CCW seen from outside
  slot: 0 | 1 | 2 // top / side / bottom colour
  /** the two in-plane axes used for AO neighbour sampling, per corner: [u, v] signs */
  ao: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[]
}

// Winding verified: (b-a)×(c-a) points along n for each face.
const FACES: readonly Face[] = [
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], slot: 0,
    ao: [[[-1, 0, 0], [0, 0, -1]], [[-1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, -1]]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], slot: 2,
    ao: [[[-1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1]]] },
  { n: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], slot: 1,
    ao: [[[0, -1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, 1]]] },
  { n: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], slot: 1,
    ao: [[[0, -1, 0], [0, 0, 1]], [[0, 1, 0], [0, 0, 1]], [[0, 1, 0], [0, 0, -1]], [[0, -1, 0], [0, 0, -1]]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], slot: 1,
    ao: [[[-1, 0, 0], [0, -1, 0]], [[1, 0, 0], [0, -1, 0]], [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]]] },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], slot: 1,
    ao: [[[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 1, 0]]] },
]

const AO_LEVELS = [0.5, 0.68, 0.84, 1.0] as const
const WATER_TOP_DROP = 0.15

class Builder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  indices: number[] = []
  private vertexCount = 0

  quad(
    pts: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    rgb: Rgb,
    alpha: number,
    ao: readonly [number, number, number, number],
  ): void {
    for (let i = 0; i < 4; i++) {
      const p = pts[i]
      const shade = AO_LEVELS[ao[i]]
      this.positions.push(p[0], p[1], p[2])
      this.normals.push(n[0], n[1], n[2])
      this.colors.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, alpha)
    }
    const b = this.vertexCount
    // flip the diagonal so AO interpolates without the classic seam artefact
    if (ao[0] + ao[2] > ao[1] + ao[3]) this.indices.push(b, b + 1, b + 2, b, b + 2, b + 3)
    else this.indices.push(b + 1, b + 2, b + 3, b + 1, b + 3, b)
    this.vertexCount += 4
  }

  build(): MeshData | null {
    if (this.indices.length === 0) return null
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    }
  }
}

/** Does a block occlude ambient light? (opaque-ish solids) */
const occludes = (id: number): boolean => id !== AIR && id !== BLOCK.water && id !== BLOCK.glass && !isProp(id)

function vertexAo(world: World, x: number, y: number, z: number,
  n: readonly [number, number, number],
  s1: readonly [number, number, number],
  s2: readonly [number, number, number]): number {
  const bx = x + n[0]
  const by = y + n[1]
  const bz = z + n[2]
  const side1 = occludes(world.getBlock(bx + s1[0], by + s1[1], bz + s1[2])) ? 1 : 0
  const side2 = occludes(world.getBlock(bx + s2[0], by + s2[1], bz + s2[2])) ? 1 : 0
  const corner = occludes(world.getBlock(bx + s1[0] + s2[0], by + s1[1] + s2[1], bz + s1[2] + s2[2])) ? 1 : 0
  if (side1 && side2) return 0
  return 3 - (side1 + side2 + corner)
}

/** Should this face of `kind` be drawn against neighbour `nb`? (add_voxels rule) */
export function faceVisible(kind: number, nb: number, isTop: boolean): boolean {
  if (nb !== AIR && !(isSeeThrough(nb) && nb !== kind)) return false
  if (kind === BLOCK.water && !isTop && nb !== AIR) return false
  return true
}

export function meshChunk(world: World, cx: number, cy: number, cz: number): ChunkMesh {
  const chunk = world.getChunk(cx, cy, cz)
  if (!chunk) return { opaque: null, translucent: null }
  const opaque = new Builder()
  const translucent = new Builder()
  const ox = cx * CHUNK
  const oy = cy * CHUNK
  const oz = cz * CHUNK
  const ao: [number, number, number, number] = [3, 3, 3, 3]

  for (let lx = 0; lx < CHUNK; lx++) {
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const kind = chunk[(lx << 8) | (ly << 4) | lz]
        if (kind === AIR || isProp(kind)) continue
        const x = ox + lx
        const y = oy + ly
        const z = oz + lz
        const def = BLOCK_DEFS[kind as BlockId]
        const target = isTranslucent(kind) ? translucent : opaque
        for (const face of FACES) {
          const nb = world.getBlock(x + face.n[0], y + face.n[1], z + face.n[2])
          const isTop = face.slot === 0
          if (!faceVisible(kind, nb, isTop)) continue
          const drop = kind === BLOCK.water && isTop ? WATER_TOP_DROP : 0
          const pts = face.corners.map(c => [x + c[0], y + c[1] - drop, z + c[2]] as const)
          for (let i = 0; i < 4; i++) ao[i] = vertexAo(world, x, y, z, face.n, face.ao[i][0], face.ao[i][1])
          target.quad(pts, face.n, def.colours[face.slot], def.alpha, ao)
        }
      }
    }
  }
  return { opaque: opaque.build(), translucent: translucent.build() }
}
