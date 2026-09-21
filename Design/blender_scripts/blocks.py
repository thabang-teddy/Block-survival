"""Block palette + culled voxel mesher shared by assets.py and islands.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import voxel_lib
importlib.reload(voxel_lib)
from voxel_lib import get_material

# block type -> (top, side, bottom) colours
BLOCK_COLOURS = {
    "grass":  ((0.40, 0.66, 0.24), (0.52, 0.36, 0.20), (0.52, 0.36, 0.20)),
    "dirt":   ((0.52, 0.36, 0.20),) * 3,
    "stone":  ((0.52, 0.52, 0.52),) * 3,
    "cobble": ((0.44, 0.44, 0.46),) * 3,
    "sand":   ((0.86, 0.80, 0.58),) * 3,
    "gravel": ((0.58, 0.55, 0.52),) * 3,
    "log":    ((0.70, 0.58, 0.36), (0.40, 0.28, 0.15), (0.70, 0.58, 0.36)),
    "planks": ((0.72, 0.56, 0.34),) * 3,
    "leaves": ((0.24, 0.52, 0.18),) * 3,
    "water":  ((0.22, 0.48, 0.85),) * 3,
    "glass":  ((0.75, 0.88, 0.95),) * 3,
    "snow":   ((0.95, 0.96, 0.98),) * 3,
    "ore_iron": ((0.62, 0.55, 0.48),) * 3,
    "ore_coal": ((0.30, 0.30, 0.30),) * 3,
    # the rest of the Overworld ores (issue #25)
    "ore_copper": ((0.62, 0.42, 0.28),) * 3,
    "ore_gold": ((0.85, 0.70, 0.25),) * 3,
    "ore_redstone": ((0.62, 0.18, 0.18),) * 3,
    "ore_lapis": ((0.20, 0.32, 0.68),) * 3,
    "ore_diamond": ((0.42, 0.82, 0.85),) * 3,
    "ore_emerald": ((0.22, 0.72, 0.40),) * 3,
}

TRANSPARENT = {"water": 0.75, "glass": 0.35, "leaves": 1.0}


def block_materials(kind):
    top, side, bottom = BLOCK_COLOURS[kind]
    alpha = TRANSPARENT.get(kind, 1.0)
    rough = 0.25 if kind in ("water", "glass") else 0.9
    return {
        "top": get_material(f"Block_{kind}_top", top, roughness=rough, alpha=alpha),
        "side": get_material(f"Block_{kind}_side", side, roughness=rough, alpha=alpha),
        "bottom": get_material(f"Block_{kind}_bottom", bottom, roughness=rough, alpha=alpha),
    }


# face direction -> (normal, corner offsets in CCW order seen from outside)
FACES = {
    "top":    ((0, 0, 1),  ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))),
    "bottom": ((0, 0, -1), ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0))),
    "north":  ((0, 1, 0),  ((1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1))),
    "south":  ((0, -1, 0), ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1))),
    "east":   ((1, 0, 0),  ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))),
    "west":   ((-1, 0, 0), ((0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1))),
}

SEE_THROUGH = {"water", "glass", "leaves"}


def add_voxels(vb, voxels, group=None):
    """Emit only exposed faces for a {(x,y,z): kind} dict. 1 voxel = 1 m."""
    mats = {}
    for (x, y, z), kind in voxels.items():
        if kind not in mats:
            mats[kind] = block_materials(kind)
        for fname, (n, corners) in FACES.items():
            nb = voxels.get((x + n[0], y + n[1], z + n[2]))
            if nb is not None and not (nb in SEE_THROUGH and nb != kind):
                continue
            if kind == "water" and fname != "top" and nb is not None:
                continue
            slot = "top" if fname == "top" else "bottom" if fname == "bottom" else "side"
            pts = [(x + c[0], y + c[1], z + c[2]) for c in corners]
            if kind == "water" and fname == "top":
                pts = [(px, py, pz - 0.15) for px, py, pz in pts]
            vb.quad(pts, mats[kind][slot], group)
