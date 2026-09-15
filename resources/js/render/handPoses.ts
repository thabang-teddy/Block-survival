/**
 * Grip pose per model inside the Hand_R bone. Bone frame: +Y runs down the arm
 * (toward the fist), +Z points behind the character. Tools (model +Y = tip) are
 * tilted so the tip points out of the fist and forward: rotation.x = -1.28 maps
 * +Y to (0, 0.29, -0.96). The rifle (model +Z = muzzle) lies along the arm.
 */
export interface HandPose {
  pos: [number, number, number]
  rot: [number, number, number]
  scale: number
}

const TOOL_TILT = -1.28

export const HAND_POSES: Readonly<Record<string, HandPose>> = {
  Rifle: { pos: [0, 0.02, 0.05], rot: [-Math.PI / 2, 0, 0], scale: 0.8 },
  Sword: { pos: [0, 0.1, 0], rot: [TOOL_TILT, 0, 0], scale: 0.85 },
  Pickaxe: { pos: [0, 0.1, 0], rot: [TOOL_TILT, Math.PI / 2, 0], scale: 0.85 },
  Torch: { pos: [0, 0.1, 0], rot: [TOOL_TILT, 0, 0], scale: 0.85 },
}
