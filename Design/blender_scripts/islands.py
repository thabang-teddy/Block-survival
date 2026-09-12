"""Procedural floating voxel islands for Block Survival -> Design/Islands/*.glb

Each island is a single mesh (only exposed faces are emitted) with one material
slot per block face type.  1 voxel = 1 m.  Origin = island centre at the base
ground level (z=0 is the lowest grass layer); the island hangs below z=0.
Trees are baked into the island mesh; the flat "build pad" in the centre is a
good spawn / base location.
"""
import bpy
import os
import sys
import math
import random
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import voxel_lib, blocks
importlib.reload(voxel_lib)
importlib.reload(blocks)
from voxel_lib import VoxelBuilder, get_collection, clear_collection, export_glb, ISLAND_DIR
from blocks import add_voxels


def n2(x, y, seed, freq):
    """2-D fractal noise in roughly -1..1."""
    v = Vector((x * freq, y * freq, seed * 7.31))
    return noise.noise(v) + 0.5 * noise.noise(v * 2.1 + Vector((3.3, 1.7, 0.0)))


def add_tree(vox, x, y, z, rng):
    height = rng.randint(4, 6)
    for dz in range(height):
        vox[(x, y, z + dz)] = "log"
    top = z + height
    for dz in range(-2, 2):
        r = 2 if dz < 0 else 1
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                if abs(dx) == r and abs(dy) == r and dz != -1:
                    continue
                key = (x + dx, y + dy, top + dz)
                if key not in vox:
                    vox[key] = "leaves"
    vox[(x, y, top + 2)] = "leaves"


def generate_island(size, seed, max_height=6, depth=10, pad_radius=0, lake=True, tree_density=0.022):
    rng = random.Random(seed)
    R = size / 2.0
    vox = {}
    heights = {}
    # ---- heightmap + island mask
    for x in range(-int(R) - 1, int(R) + 2):
        for y in range(-int(R) - 1, int(R) + 2):
            d = math.hypot(x, y) / R
            mask = 1.0 - d + 0.30 * n2(x, y, seed, 0.09)
            if mask <= 0.12:
                continue
            h = mask * max_height + 2.0 * n2(x, y, seed + 1, 0.16)
            h = int(round(h / 2.0)) * 2 if mask > 0.5 else int(round(h))    # terraces inland
            h = max(0, min(max_height + 2, h))
            if pad_radius and math.hypot(x, y) <= pad_radius:
                h = 2
            dep = int(mask * depth + 2.0 * n2(x, y, seed + 2, 0.13) * mask)
            dep = max(1, dep)
            heights[(x, y)] = (h, dep)

    # ---- lake: pick a spot away from the pad
    lake_cells = set()
    if lake:
        for _ in range(30):
            lx, ly = rng.randint(-int(R * 0.5), int(R * 0.5)), rng.randint(-int(R * 0.5), int(R * 0.5))
            if (lx, ly) in heights and math.hypot(lx, ly) > pad_radius + 4:
                break
        lr = max(2, size // 9)
        for (x, y) in heights:
            if math.hypot(x - lx, y - ly) <= lr + 0.6 * n2(x, y, seed + 3, 0.3):
                lake_cells.add((x, y))
        lake_level = min(heights[c][0] for c in lake_cells) if lake_cells else 0

    # ---- fill columns
    for (x, y), (h, dep) in heights.items():
        if (x, y) in lake_cells:
            floor = lake_level - 2
            for z in range(-dep, floor):
                vox[(x, y, z)] = "stone"
            vox[(x, y, floor)] = "sand"
            for z in range(floor + 1, lake_level + 1):
                vox[(x, y, z)] = "water"
            continue
        near_lake = any((x + dx, y + dy) in lake_cells for dx in (-1, 0, 1) for dy in (-1, 0, 1))
        for z in range(-dep, h + 1):
            if z == h:
                kind = "sand" if near_lake and h <= lake_level + 1 else "grass"
            elif z >= h - 2:
                kind = "dirt"
            else:
                kind = "stone"
                r = rng.random()
                if r < 0.03:
                    kind = "ore_coal"
                elif r < 0.045:
                    kind = "ore_iron"
            vox[(x, y, z)] = kind
        # snow on the highest peaks of big islands
        if h >= max_height + 1 and size >= 40:
            vox[(x, y, h)] = "snow"

    # ---- trees on grass, not on the pad
    grass_cells = [(x, y, z) for (x, y, z), k in vox.items() if k == "grass"
                   and math.hypot(x, y) > pad_radius + 1 and math.hypot(x, y) < R * 0.85]
    rng.shuffle(grass_cells)
    placed = []
    for (x, y, z) in grass_cells:
        if len(placed) >= int(len(grass_cells) * tree_density):
            break
        if all(abs(x - px) > 3 or abs(y - py) > 3 for px, py, _ in placed):
            add_tree(vox, x, y, z + 1, rng)
            placed.append((x, y, z))
    return vox


ISLANDS = [
    # name, size, seed, max_height, depth, pad_radius, lake
    ("Island_Small",  16, 3,  4,  7,  0, False),
    ("Island_Medium", 32, 7,  6,  11, 5, True),
    ("Island_Large",  56, 11, 9,  16, 8, True),
]


def build_island(col, name, size, seed, max_height, depth, pad_radius, lake):
    vox = generate_island(size, seed, max_height, depth, pad_radius, lake)
    vb = VoxelBuilder(name)
    add_voxels(vb, vox)
    obj = vb.build(col)
    obj["voxel_count"] = len(vox)
    return obj


def build_all(export=True):
    clear_collection("Islands")
    col = get_collection("Islands")
    objs = []
    offset = 0
    for spec in ISLANDS:
        o = build_island(col, *spec)
        o.location = (offset, 0, 0)
        offset += spec[1] + 12
        objs.append(o)
        print(f"{spec[0]}: {o['voxel_count']} voxels, {len(o.data.polygons)} faces")
    if export:
        for o in objs:
            saved = o.location.copy()
            o.location = (0, 0, 0)
            export_glb([o], os.path.join(ISLAND_DIR, f"{o.name}.glb"))
            o.location = saved
    return objs


if __name__ == "__main__":
    build_all()
