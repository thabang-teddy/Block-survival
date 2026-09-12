# Block Survival — 3D assets

All models are `.glb` (glTF binary), Y-up, metres, flat-shaded with plain
`MeshStandardMaterial` colours — drop them straight into three.js with `GLTFLoader`.

```
Design/
├── Characters/   rigged + animated characters (skinned mesh + armature)
├── Assets/       weapons, tools, props, trees, 1 m building blocks
├── Islands/      floating voxel terrain chunks
├── viewer/       three.js test page (run: python -m http.server 8765 --directory Design → /viewer/)
└── blender_scripts/  generators — edit + re-run to change anything
```

## Scale & orientation

| Thing | Size | Origin | Faces |
|---|---|---|---|
| Characters | 2 m tall (16 px = 1 m, Minecraft proportions) | between the feet | **+Z** in three.js |
| Blocks | 1 m cube | min corner `(0,0,0)`→`(1,1,1)` | — |
| Props (crate, bed, workbench, trees) | 1 m grid | bottom centre | — |
| Weapons / tools | hand-sized | the grip | rifle points **+Z**, sword/torch/pickaxe point **+Y** (up) |
| Islands | 16 / 32 / 56 m across | island centre, `y = 0` = lowest grass layer | — |

## Characters

| File | Clips | Notes |
|---|---|---|
| `Survivor.glb` | `Idle` `Walk` `Run` `Aim` `Swing` | player: camo jacket, backpack, boots |
| `Zombie_Basic.glb` | `Idle` `Walk` `Attack` | torn grey shirt |
| `Zombie_Worker.glb` | `Idle` `Walk` `Attack` | hard hat + flannel |
| `Zombie_Soldier.glb` | `Idle` `Walk` `Attack` | helmet, camo, tactical vest |
| `Zombie_Toxic.glb` | `Idle` `Walk` `Attack` | bright green, yellow eyes |

Bones: `Root` → `Body` → `Head`, `Arm_L`/`Arm_R` → `Hand_L`/`Hand_R`, and `Root` → `Leg_L`/`Leg_R`.
`Hand_R` / `Hand_L` are empty attachment bones at the wrist — parent a weapon to them.
Zombie eyes are emissive (add `UnrealBloomPass` for the glow).

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';

const gltf = await new GLTFLoader().loadAsync('Design/Characters/Survivor.glb');
const player = gltf.scene;
scene.add(player);

// animations
const mixer = new THREE.AnimationMixer(player);
const clips = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
clips.Idle.play();
// in your loop: mixer.update(delta)

// attach a weapon to the right hand
const rifle = (await new GLTFLoader().loadAsync('Design/Assets/Rifle.glb')).scene;
player.getObjectByName('Hand_R').add(rifle);
rifle.rotation.set(-Math.PI / 2, 0, 0);   // tweak to taste
```

For a one-shot clip like `Swing` / `Attack`: `action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true;`.

## Assets

Weapons/tools: `Rifle`, `Sword`, `Pickaxe`, `Torch` (emissive flame).
Props: `Crate`, `Workbench`, `Bed`, `Tree_Oak`, `Tree_Tall`.
Blocks (1 m): `grass` `dirt` `stone` `cobble` `sand` `gravel` `log` `planks`
`leaves` `water` `glass` `snow` `ore_iron` `ore_coal` — as `Block_<name>.glb`.

For a real voxel world you'll get far better performance by building chunk
meshes in JS (or `InstancedMesh`) with the same colours — see
`blender_scripts/blocks.py` `BLOCK_COLOURS` for the palette.

## Islands

Single mesh each, only exposed faces (≈1k / 4k / 11k quads). Terraced grass,
dirt/stone cliffs, tapered stone underside, a lake with sand shore, ore specks,
baked-in trees, and a flat 2-block-high **build pad** in the centre of Medium/Large
(radius 5 / 8 m) for the player base.

## Regenerating

Open Blender 4.2+ and run `blender_scripts/run_all.py`, or headless:

```bash
blender --background --python "Design/blender_scripts/run_all.py"
```

Change colours in `characters.py` / `blocks.py`, island seeds/sizes in `islands.py`
(`ISLANDS` table), animation poses in `characters.py` (`survivor_clips` / `zombie_clips`).
`block_survival.blend` is the last generated scene.
