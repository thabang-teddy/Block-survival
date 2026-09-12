"""Props, weapons and building blocks for Block Survival -> Design/Assets/*.glb

Origins:
* Weapons / tools: origin at the grip so they can be parented to the Hand_R bone.
  Rifle points down -Y (forward), sword/torch/pickaxe point up +Z.
* Blocks: 1 m cube with origin at the min corner (0,0,0)-(1,1,1).
* Props (crate, bed, workbench, tree): origin at the bottom centre.
"""
import bpy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import voxel_lib, blocks
importlib.reload(voxel_lib)
importlib.reload(blocks)
from voxel_lib import VoxelBuilder, get_material, get_collection, clear_collection, export_glb, ASSET_DIR
from blocks import add_voxels, BLOCK_COLOURS

M = lambda name, rgb, **kw: get_material(name, rgb, **kw)  # noqa: E731


# --------------------------------------------------------------------------- weapons / tools
def build_rifle(col):
    vb = VoxelBuilder("Rifle")
    tan = M("RifleTan", (0.62, 0.52, 0.34))
    dark = M("RifleDark", (0.22, 0.20, 0.17))
    steel = M("RifleSteel", (0.40, 0.40, 0.42))
    lens = M("RifleLens", (0.35, 0.65, 0.90), roughness=0.2)
    # receiver runs along -Y (forward). grip at origin.
    vb.box((0, -3, 3.2), (2, 12, 2.4), tan)               # receiver
    vb.box((0, -11, 3.6), (1.2, 8, 1.2), steel)           # barrel
    vb.box((0, -15.5, 3.6), (1.6, 1.4, 1.6), dark)        # muzzle
    vb.box((0, -7.5, 2.4), (2.2, 5, 1.6), dark)           # hand guard
    vb.box((0, 4.5, 3.0), (1.8, 5, 2.0), tan)             # stock
    vb.box((0, 7.0, 2.2), (2.0, 1.2, 3.6), dark)          # butt plate
    vb.box((0, 0.2, 0.8), (1.6, 2.0, 3.2), dark)          # pistol grip (origin)
    vb.box((0, -3.5, 0.8), (1.4, 2.2, 3.4), steel)        # magazine
    vb.box((0, -2, 5.2), (1.2, 3.5, 1.2), dark)           # rail
    vb.box((0, -2, 6.4), (1.8, 5.0, 1.6), dark)           # scope body
    vb.box((0, -4.6, 6.4), (2.0, 0.4, 1.8), lens)         # scope lens
    vb.box((0, 1.4, 4.9), (1.0, 1.0, 1.2), dark)          # charging handle
    return vb.build(col)


def build_sword(col):
    vb = VoxelBuilder("Sword")
    blade = M("SwordBlade", (0.80, 0.82, 0.86), roughness=0.35)
    edge = M("SwordEdge", (0.92, 0.94, 0.97), roughness=0.3)
    gold = M("SwordGold", (0.85, 0.65, 0.20), roughness=0.4)
    grip = M("SwordGrip", (0.40, 0.26, 0.14))
    vb.box((0, 0, 1.5), (1.4, 1.4, 3), grip)              # handle (origin at bottom of grip)
    vb.box((0, 0, -0.5), (2.0, 2.0, 1.0), gold)           # pommel
    vb.box((0, 0, 3.5), (5.0, 1.6, 1.0), gold)            # guard
    vb.box((0, 0, 9.5), (2.2, 0.8, 11), blade)            # blade
    vb.box((0, 0, 9.5), (0.8, 0.9, 11), edge)             # fuller / highlight
    vb.box((0, 0, 15.6), (1.4, 0.8, 1.4), blade)          # tip step
    vb.box((0, 0, 16.7), (0.7, 0.8, 1.0), edge)           # tip
    return vb.build(col)


def build_pickaxe(col):
    vb = VoxelBuilder("Pickaxe")
    wood = M("ToolWood", (0.55, 0.40, 0.22))
    iron = M("ToolIron", (0.62, 0.64, 0.66), roughness=0.4)
    vb.box((0, 0, 6), (1.4, 1.4, 12), wood)               # handle
    vb.box((0, 0, 12.2), (9, 1.6, 1.8), iron)             # head bar
    for s in (-1, 1):
        vb.box((s * 5.0, 0, 11.6), (2, 1.4, 1.4), iron)
        vb.box((s * 6.4, 0, 10.8), (1.2, 1.2, 1.2), iron)
    return vb.build(col)


def build_torch(col):
    vb = VoxelBuilder("Torch")
    stick = M("TorchStick", (0.50, 0.36, 0.20))
    coal = M("TorchCoal", (0.20, 0.15, 0.10))
    flame = M("TorchFlame", (1.0, 0.55, 0.10), emission=(1.0, 0.45, 0.05))
    flame2 = M("TorchFlameHot", (1.0, 0.85, 0.30), emission=(1.0, 0.80, 0.20))
    vb.box((0, 0, 4), (1.6, 1.6, 8), stick)
    vb.box((0, 0, 8.6), (2.0, 2.0, 1.4), coal)
    vb.box((0, 0, 10.2), (2.2, 2.2, 2.0), flame)
    vb.box((0.4, -0.3, 11.8), (1.4, 1.4, 1.4), flame2)
    vb.box((-0.5, 0.4, 12.6), (0.8, 0.8, 0.8), flame)
    return vb.build(col)


# --------------------------------------------------------------------------- props (1 m units)
def build_crate(col):
    vb = VoxelBuilder("Crate")
    plank = M("CratePlank", (0.66, 0.50, 0.30))
    frame = M("CrateFrame", (0.42, 0.30, 0.17))
    vb.box((0, 0, 0.5), (0.96, 0.96, 0.96), plank, scale=1.0)
    e = 0.06
    for sx in (-1, 1):
        for sy in (-1, 1):
            vb.box((sx * 0.47, sy * 0.47, 0.5), (e * 1.2, e * 1.2, 1.0), frame, scale=1.0)
    for sz in (0.03, 0.97):
        for sx in (-1, 1):
            vb.box((sx * 0.47, 0, sz), (e * 1.2, 1.0, e * 1.2), frame, scale=1.0)
        for sy in (-1, 1):
            vb.box((0, sy * 0.47, sz), (1.0, e * 1.2, e * 1.2), frame, scale=1.0)
    # X braces on 4 sides
    for sy in (-1, 1):
        vb.box((0, sy * 0.49, 0.5), (0.85, 0.03, 0.12), frame, scale=1.0)
    for sx in (-1, 1):
        vb.box((sx * 0.49, 0, 0.5), (0.03, 0.85, 0.12), frame, scale=1.0)
    return vb.build(col)


def build_workbench(col):
    vb = VoxelBuilder("Workbench")
    top = M("BenchTop", (0.58, 0.44, 0.26))
    side = M("BenchSide", (0.50, 0.36, 0.20))
    tool = M("ToolIron", (0.62, 0.64, 0.66), roughness=0.4)
    vb.box((0, 0, 0.5), (1.0, 1.0, 1.0), side, scale=1.0)
    vb.box((0, 0, 1.01), (1.0, 1.0, 0.02), top, scale=1.0)
    vb.box((0.2, -0.15, 1.05), (0.25, 0.1, 0.06), tool, scale=1.0)   # tools on top
    vb.box((-0.25, 0.2, 1.05), (0.12, 0.3, 0.06), tool, scale=1.0)
    grid = M("BenchGrid", (0.30, 0.22, 0.12))
    for x in (-0.17, 0.17):
        vb.box((x, 0, 1.03), (0.03, 0.7, 0.02), grid, scale=1.0)
        vb.box((0, x, 1.03), (0.7, 0.03, 0.02), grid, scale=1.0)
    return vb.build(col)


def build_bed(col):
    vb = VoxelBuilder("Bed")
    frame = M("BedFrame", (0.50, 0.36, 0.20))
    sheet = M("BedSheet", (0.70, 0.72, 0.55))
    blanket = M("BedBlanket", (0.35, 0.45, 0.30))
    pillow = M("BedPillow", (0.92, 0.92, 0.88))
    vb.box((0, 0, 0.18), (1.0, 2.0, 0.36), frame, scale=1.0)
    vb.box((0, 0, 0.44), (0.92, 1.92, 0.16), sheet, scale=1.0)
    vb.box((0, -0.35, 0.54), (0.92, 1.2, 0.08), blanket, scale=1.0)
    vb.box((0, 0.7, 0.58), (0.7, 0.4, 0.14), pillow, scale=1.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            vb.box((sx * 0.45, sy * 0.95, 0.1), (0.1, 0.1, 0.2), frame, scale=1.0)
    return vb.build(col)


def build_tree(col, name="Tree", height=5, radius=2):
    vb = VoxelBuilder(name)
    vox = {}
    for z in range(height):
        vox[(0, 0, z)] = "log"
    top = height
    for dz in range(-2, 2):
        r = radius if dz < 0 else radius - 1
        for x in range(-r, r + 1):
            for y in range(-r, r + 1):
                if abs(x) == r and abs(y) == r and dz != -1:
                    continue
                if (x, y, top + dz) not in vox:
                    vox[(x, y, top + dz)] = "leaves"
    vox[(0, 0, top + 2)] = "leaves"
    add_voxels(vb, vox)
    obj = vb.build(col)
    obj.location = (0, 0, 0)
    # shift so the trunk is centred on origin (voxels span 0..1)
    for v in obj.data.vertices:
        v.co.x -= 0.5
        v.co.y -= 0.5
    return obj


def build_block(col, kind):
    vb = VoxelBuilder(f"Block_{kind}")
    add_voxels(vb, {(0, 0, 0): kind})
    return vb.build(col)


# --------------------------------------------------------------------------- main
def build_all(export=True):
    clear_collection("Assets")
    col = get_collection("Assets")
    objs = [
        build_rifle(col), build_sword(col), build_pickaxe(col), build_torch(col),
        build_crate(col), build_workbench(col), build_bed(col),
        build_tree(col, "Tree_Oak", 5, 2), build_tree(col, "Tree_Tall", 7, 2),
    ]
    for kind in BLOCK_COLOURS:
        objs.append(build_block(col, kind))

    # arrange for viewing
    for i, o in enumerate(objs):
        o.location = ((i % 8) * 2.0, -(i // 8) * 2.5, 0)

    if export:
        for o in objs:
            saved = o.location.copy()
            o.location = (0, 0, 0)
            export_glb([o], os.path.join(ASSET_DIR, f"{o.name}.glb"))
            o.location = saved
    return objs


if __name__ == "__main__":
    build_all()
