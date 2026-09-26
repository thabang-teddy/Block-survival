/**
 * Every message a client sends is checked here before the host sim sees it. The PC runs
 * the world everyone shares, unattended, so a malformed or hostile message is dropped
 * rather than trusted.
 */
import type { ClientMessage } from '@game/net/protocol'
import type { AnimName } from '@game/game/Game'
import { HOTBAR_SIZE, INVENTORY_SIZE } from '@game/items/inventory'
import { RECIPES } from '@game/items/recipes'

/** the world's reach in any axis; nothing legitimate is further out than this */
const MAX_COORD = 1_000_000
const MAX_NAME = 16
const MAX_CHAT = 200
const ANIMS: readonly AnimName[] = ['Idle', 'Walk', 'Run', 'Aim', 'Swing']
const RECIPE_IDS = new Set(RECIPES.map(r => r.id))

type Raw = Record<string, unknown>

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD
const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const unit = (v: unknown): v is number => num(v) && Math.abs(v) <= 1.0001
const cell = (m: Raw): boolean => int(m.x, -MAX_COORD, MAX_COORD) && int(m.y, -MAX_COORD, MAX_COORD) && int(m.z, -MAX_COORD, MAX_COORD)
const ray = (m: Raw): boolean => num(m.ox) && num(m.oy) && num(m.oz) && unit(m.dx) && unit(m.dy) && unit(m.dz)

/** the message as the sim may use it, or null when it is not one a client can send */
export function validateClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null
  const m = raw
  switch (m.t) {
    case 'hello':
      if (!int(m.v, 0, 1_000_000) || typeof m.name !== 'string') return null
      return { t: 'hello', v: m.v, name: m.name.slice(0, MAX_NAME) }
    case 'input':
      if (!num(m.x) || !num(m.y) || !num(m.z) || !num(m.yaw) || !num(m.pitch)) return null
      if (!ANIMS.includes(m.anim as AnimName) || !int(m.slot, 0, HOTBAR_SIZE - 1) || typeof m.aiming !== 'boolean') return null
      return { t: 'input', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, anim: m.anim as AnimName, slot: m.slot, aiming: m.aiming }
    case 'break':
      return cell(m) ? { t: 'break', x: m.x as number, y: m.y as number, z: m.z as number } : null
    case 'place':
      if (!cell(m) || !int(m.nx, -1, 1) || !int(m.ny, -1, 1) || !int(m.nz, -1, 1) || !int(m.slot, 0, HOTBAR_SIZE - 1) || !num(m.yaw)) return null
      return { t: 'place', x: m.x as number, y: m.y as number, z: m.z as number, nx: m.nx, ny: m.ny, nz: m.nz, slot: m.slot, yaw: m.yaw }
    case 'craft':
      return typeof m.recipe === 'string' && RECIPE_IDS.has(m.recipe) ? { t: 'craft', recipe: m.recipe } : null
    case 'moveSlot':
      return int(m.from, 0, INVENTORY_SIZE - 1) && int(m.to, 0, INVENTORY_SIZE - 1) ? { t: 'moveSlot', from: m.from, to: m.to } : null
    case 'dropHeld':
      return int(m.slot, 0, INVENTORY_SIZE - 1) && unit(m.dx) && unit(m.dz) ? { t: 'dropHeld', slot: m.slot, dx: m.dx, dz: m.dz } : null
    case 'interact':
      if (!cell(m) || !int(m.block, 0, 65535)) return null
      if (m.crate !== null && !int(m.crate, 0, Number.MAX_SAFE_INTEGER)) return null
      return { t: 'interact', x: m.x as number, y: m.y as number, z: m.z as number, block: m.block, crate: m.crate as number | null }
    case 'swing':
    case 'fire':
      if (!ray(m)) return null
      return { t: m.t, ox: m.ox as number, oy: m.oy as number, oz: m.oz as number, dx: m.dx as number, dy: m.dy as number, dz: m.dz as number }
    case 'reload':
      return { t: 'reload' }
    case 'chat':
      return typeof m.text === 'string' ? { t: 'chat', text: m.text.slice(0, MAX_CHAT) } : null
    default:
      return null
  }
}
