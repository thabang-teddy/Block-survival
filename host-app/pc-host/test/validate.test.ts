import { describe, expect, test } from 'vitest'
import { validateClientMessage } from '../src/sim/validate'

const input = { t: 'input', x: 1, y: 2, z: 3, yaw: 0.5, pitch: -0.2, anim: 'Walk', slot: 2, aiming: false }
const ray = { ox: 0, oy: 1.6, oz: 0, dx: 0, dy: 0, dz: 1 }

describe('validateClientMessage', () => {
  test('passes every message a client sends', () => {
    expect(validateClientMessage({ t: 'hello', v: 2, name: 'Sam' })).toEqual({ t: 'hello', v: 2, name: 'Sam' })
    expect(validateClientMessage(input)).toEqual(input)
    expect(validateClientMessage({ t: 'break', x: 1, y: 2, z: -3 })).toEqual({ t: 'break', x: 1, y: 2, z: -3 })
    expect(validateClientMessage({ t: 'place', x: 1, y: 2, z: 3, nx: 0, ny: 1, nz: 0, slot: 0, yaw: 1.57 })).not.toBeNull()
    expect(validateClientMessage({ t: 'craft', recipe: 'planks' })).toEqual({ t: 'craft', recipe: 'planks' })
    expect(validateClientMessage({ t: 'moveSlot', from: 0, to: 35 })).not.toBeNull()
    expect(validateClientMessage({ t: 'dropHeld', slot: 3, dx: 0.6, dz: -0.8 })).not.toBeNull()
    expect(validateClientMessage({ t: 'interact', x: 0, y: 0, z: 0, block: 0, crate: 4 })).not.toBeNull()
    expect(validateClientMessage({ t: 'interact', x: 1, y: 2, z: 3, block: 12, crate: null })).not.toBeNull()
    expect(validateClientMessage({ t: 'swing', ...ray })).toEqual({ t: 'swing', ...ray })
    expect(validateClientMessage({ t: 'fire', ...ray })).toEqual({ t: 'fire', ...ray })
    expect(validateClientMessage({ t: 'reload' })).toEqual({ t: 'reload' })
    // protocol v1 has no save message
    expect(validateClientMessage({ t: 'save' })).toBeNull()
  })

  test('drops anything malformed or hostile', () => {
    for (const bad of [
      null, 'input', [input], { t: 'nope' },
      { ...input, x: Number.NaN }, { ...input, y: Infinity }, { ...input, z: 1e12 },
      { ...input, anim: 'Dance' }, { ...input, slot: 9 }, { ...input, slot: 1.5 }, { ...input, aiming: 'yes' },
      { t: 'break', x: 1.5, y: 2, z: 3 },
      { t: 'place', x: 1, y: 2, z: 3, nx: 2, ny: 0, nz: 0, slot: 0, yaw: 0 },
      { t: 'craft', recipe: 'diamond_everything' },
      { t: 'moveSlot', from: -1, to: 3 },
      { t: 'swing', ...ray, dx: 5 },
      { t: 'interact', x: 0, y: 0, z: 0, block: 0, crate: 'x' },
      { t: 'hello', v: 2, name: 42 },
    ]) {
      expect(validateClientMessage(bad)).toBeNull()
    }
  })

  test('trims names and chat to their limits and never trusts a client-sent account id', () => {
    const hello = validateClientMessage({ t: 'hello', v: 2, name: 'A'.repeat(40), userId: 1 })
    expect(hello).toEqual({ t: 'hello', v: 2, name: 'A'.repeat(16) })
    const chat = validateClientMessage({ t: 'chat', text: 'x'.repeat(500) })
    expect(chat).toEqual({ t: 'chat', text: 'x'.repeat(200) })
  })
})
