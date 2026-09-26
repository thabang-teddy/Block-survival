import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { fixOf, projectMarker, verticalHint, whereOf } from '../locator'

const deg = (rad: number) => (rad * 180) / Math.PI

/** a camera at the origin looking down −z (yaw 0), as the game's first-person view */
function viewProjection(yaw = 0, pitch = 0): number[] {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400)
  cam.rotation.order = 'YXZ'
  cam.rotation.set(pitch, yaw, 0)
  cam.updateMatrixWorld()
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert()
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements.slice()
}

describe('fixOf', () => {
  test('straight ahead is bearing 0, with the straight-line distance', () => {
    const fix = fixOf({ x: 0, y: 40, z: 0, yaw: 0 }, { x: 0, y: 40, z: -30 })
    expect(fix.distance).toBeCloseTo(30)
    expect(fix.bearing).toBeCloseTo(0)
    expect(fix.dy).toBe(0)
  })

  test('to the right is +90°, to the left −90°, behind ±180°', () => {
    const me = { x: 10, y: 40, z: 10, yaw: 0 }
    expect(deg(fixOf(me, { x: 20, y: 40, z: 10 }).bearing)).toBeCloseTo(90)
    expect(deg(fixOf(me, { x: 0, y: 40, z: 10 }).bearing)).toBeCloseTo(-90)
    expect(Math.abs(deg(fixOf(me, { x: 10, y: 40, z: 20 }).bearing))).toBeCloseTo(180)
  })

  test('the bearing follows the view: turned left by 90°, a player at −x is ahead', () => {
    const fix = fixOf({ x: 0, y: 0, z: 0, yaw: Math.PI / 2 }, { x: -5, y: 0, z: 0 })
    expect(deg(fix.bearing)).toBeCloseTo(0)
  })

  test('height difference is kept apart from the flat bearing and included in the distance', () => {
    const fix = fixOf({ x: 0, y: 40, z: 0, yaw: 0 }, { x: 3, y: 44, z: 0 })
    expect(fix.dy).toBe(4)
    expect(fix.distance).toBe(5)
    expect(deg(fix.bearing)).toBeCloseTo(90)
  })
})

describe('projectMarker', () => {
  test('a player in front sits on screen where the camera sees them', () => {
    const m = projectMarker(viewProjection(), 0, 0, -20)
    expect(m.onScreen).toBe(true)
    expect(m.x).toBeCloseTo(0)
    expect(m.y).toBeCloseTo(0)
  })

  test('slightly right of centre lands right of centre and stays on screen', () => {
    const m = projectMarker(viewProjection(), 5, 0, -20)
    expect(m.onScreen).toBe(true)
    expect(m.x).toBeGreaterThan(0)
    expect(m.x).toBeLessThan(1)
  })

  test('far to the right leaves the screen: pinned to the right edge, arrow pointing right', () => {
    const m = projectMarker(viewProjection(), 50, 0, -5)
    expect(m.onScreen).toBe(false)
    expect(m.x).toBeCloseTo(1 - 0.08)
    expect(Math.abs(m.y)).toBeLessThan(0.08)
    expect(m.angle).toBeCloseTo(90)
  })

  test('behind on the left pins to the left edge below centre, not mirrored to the right', () => {
    const m = projectMarker(viewProjection(), -20, 0, 5)
    expect(m.onScreen).toBe(false)
    expect(m.x).toBeCloseTo(-(1 - 0.08))
    expect(m.y).toBeLessThan(0)
    expect(m.angle).toBeGreaterThan(-135)
    expect(m.angle).toBeLessThan(-90)
  })

  test('straight behind points down', () => {
    const m = projectMarker(viewProjection(), 0, 0, 20)
    expect(m.onScreen).toBe(false)
    expect(m.x).toBeCloseTo(0)
    expect(m.y).toBeCloseTo(-(1 - 0.08))
    expect(Math.abs(m.angle)).toBeCloseTo(180)
  })

  test('behind and high up still goes to the bottom edge: turning round is the cue, not looking up', () => {
    const m = projectMarker(viewProjection(), 0, 20, 30)
    expect(m.onScreen).toBe(false)
    expect(m.y).toBeCloseTo(-(1 - 0.08))
    expect(Math.abs(m.angle)).toBeCloseTo(180)
  })

  test('above the view pins to the top edge with the arrow up', () => {
    const m = projectMarker(viewProjection(), 0, 40, -5)
    expect(m.onScreen).toBe(false)
    expect(m.y).toBeCloseTo(1 - 0.08)
    expect(m.angle).toBeCloseTo(0)
  })

  test('the margin keeps an in-frustum player near the edge pinned inside it', () => {
    // just inside the frustum's right edge on a 16:9 75° camera
    const m = projectMarker(viewProjection(), 13, 0, -10, 0.2)
    expect(m.onScreen).toBe(false)
    expect(m.x).toBeCloseTo(0.8)
  })
})

describe('whereOf / verticalHint', () => {
  test('rounds for the scoreboard and quantises the arrow so rows do not churn', () => {
    const w = whereOf({ x: 0, y: 40, z: 0, yaw: 0 }, { x: 30.4, y: 47, z: -30 })
    expect(w.distance).toBe(43)
    expect(w.bearing).toBe(45)
    expect(w.dy).toBe(7)
  })

  test('the up/down hint only speaks up for a real height difference', () => {
    expect(verticalHint(3)).toBe('')
    expect(verticalHint(-5)).toBe('')
    expect(verticalHint(6)).toBe('6 m up')
    expect(verticalHint(-24)).toBe('24 m down')
  })
})
