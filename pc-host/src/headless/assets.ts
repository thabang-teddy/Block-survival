/**
 * Stands in for the web client's render/assets.ts in the PC's build: the sim's drop and
 * crate managers ask for 3D models, which a headless host never draws. The promise never
 * settles, so nothing is fetched and nothing is attached.
 */
export function loadModel(_url: string): Promise<never> {
  return new Promise<never>(() => {})
}
