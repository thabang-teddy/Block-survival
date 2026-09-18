import { describe, expect, test } from 'vitest'
import { BLOCK } from '../../world/palette'
import { propTransform } from '../PropRenderer'

describe('propTransform', () => {
  test('torch and workbench sit at the cell centre', () => {
    expect(propTransform({ id: BLOCK.torch, x: 2, y: 5, z: -3, yaw: 0, primary: true }))
      .toMatchObject({ x: 2.5, y: 5, z: -2.5 })
    expect(propTransform({ id: BLOCK.workbench, x: 0, y: 0, z: 0, yaw: Math.PI / 2, primary: true }))
      .toMatchObject({ x: 0.5, y: 0, z: 0.5, yaw: Math.PI / 2, scale: 1 })
  })

  test('bed model is centred between its head cell and the foot cell along its facing', () => {
    const head = { id: BLOCK.bed, x: 0, y: 0, z: 0, yaw: 0, primary: true, partner: { x: 0, y: 0, z: 1 } }
    expect(propTransform(head)).toMatchObject({ x: 0.5, z: 1, yaw: 0 })
    const west = { ...head, yaw: -Math.PI / 2, partner: { x: -1, y: 0, z: 0 } }
    expect(propTransform(west).x).toBeCloseTo(0)
    expect(propTransform(west).z).toBeCloseTo(0.5)
  })
})
