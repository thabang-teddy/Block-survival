"""Build rigged + animated voxel characters for Block Survival and export as GLB.

Run inside Blender (see run_all.py).  Each character is one skinned mesh +
armature with NLA tracks: three.js can play them via AnimationMixer using the
clip names listed in CHARACTER_ANIMS below.
"""
import bpy
import os
import sys
import math
import random
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import voxel_lib
importlib.reload(voxel_lib)
from voxel_lib import VoxelBuilder, get_material, get_collection, clear_collection, export_glb, PX, CHAR_DIR

rad = math.radians
FPS = 24

# --------------------------------------------------------------------------- palettes
SKIN = (0.87, 0.66, 0.50)
HAIR = (0.34, 0.20, 0.09)
EYE_WHITE = (0.95, 0.95, 0.95)
EYE_PUPIL = (0.20, 0.30, 0.55)
CAMO_BASE = (0.47, 0.43, 0.28)
CAMO_GREEN = (0.30, 0.37, 0.20)
CAMO_BROWN = (0.55, 0.42, 0.27)
CAMO_DARK = (0.24, 0.26, 0.17)
PANTS_TAN = (0.62, 0.53, 0.35)
BOOT = (0.24, 0.17, 0.11)
BELT = (0.18, 0.14, 0.10)
PACK = (0.44, 0.31, 0.18)
PACK_LIGHT = (0.54, 0.39, 0.23)
STRAP = (0.22, 0.18, 0.13)

ZOMBIE_SKIN = (0.47, 0.66, 0.36)
ZOMBIE_SKIN_DARK = (0.36, 0.52, 0.28)
ZOMBIE_EYE = (0.70, 1.00, 0.45)
ZOMBIE_MOUTH = (0.35, 0.05, 0.05)
TOOTH = (0.92, 0.92, 0.80)


# --------------------------------------------------------------------------- shared body parts
def add_face(vb, eye_mat, pupil_mat=None, mouth_mat=None, emissive_eyes=False):
    """Eyes (and optional mouth) as thin slabs on the head front (y = -4)."""
    y = -4.12
    for side in (-1, 1):
        if pupil_mat and not emissive_eyes:
            vb.box((side * 2.5, y, 28.5), (1, 0.25, 1), eye_mat, "Head")
            vb.box((side * 1.5, y, 28.5), (1, 0.25, 1), pupil_mat, "Head")
        else:
            vb.box((side * 2.0, y, 28.5), (2, 0.25, 1), eye_mat, "Head")
    if mouth_mat:
        vb.box((0, y, 26.0), (3, 0.25, 1.2), mouth_mat, "Head")
        vb.box((-0.9, y - 0.02, 26.4), (0.6, 0.3, 0.5), get_material("Tooth", TOOTH), "Head")
        vb.box((0.9, y - 0.02, 25.7), (0.6, 0.3, 0.5), get_material("Tooth", TOOTH), "Head")


def add_camo_patches(vb, base_group, center, size, mats, seed, density=7):
    """Scatter thin coloured slabs on the 4 vertical faces of a box to fake camo."""
    rng = random.Random(seed)
    cx, cy, cz = center
    w, d, h = size
    for i in range(density):
        mat = mats[i % len(mats)]
        pw, ph = rng.uniform(1.2, 3.0), rng.uniform(1.0, 2.5)
        z = rng.uniform(cz - h / 2 + ph / 2, cz + h / 2 - ph / 2)
        face = rng.choice(("front", "back", "left", "right"))
        if face in ("front", "back"):
            x = rng.uniform(cx - w / 2 + pw / 2, cx + w / 2 - pw / 2)
            y = cy - d / 2 - 0.08 if face == "front" else cy + d / 2 + 0.08
            vb.box((x, y, z), (pw, 0.16, ph), mat, base_group)
        else:
            y = rng.uniform(cy - d / 2 + pw / 2, cy + d / 2 - pw / 2)
            x = cx - w / 2 - 0.08 if face == "left" else cx + w / 2 + 0.08
            vb.box((x, y, z), (0.16, pw, ph), mat, base_group)


def add_limbs(vb, upper_mat, lower_mat, arm_upper_h=9, leg_upper_h=9, lower_arm_mat=None,
              boot_mat=None, torn_legs=None):
    """Arms/legs. Arms: sleeve (upper) + hand (lower). Legs: pants + boots/skin."""
    lower_arm_mat = lower_arm_mat or lower_mat
    for side, name in ((1, "Arm_L"), (-1, "Arm_R")):
        x = side * 6
        vb.box((x, 0, 24 - arm_upper_h / 2), (4, 4, arm_upper_h), upper_mat, name)
        hand_h = 12 - arm_upper_h
        vb.box((x, 0, 12 + hand_h / 2), (4, 4, hand_h), lower_arm_mat, name)
    for side, name in ((1, "Leg_L"), (-1, "Leg_R")):
        x = side * 2
        pants_h = leg_upper_h
        if torn_legs and name in torn_legs:
            pants_h = torn_legs[name]
        vb.box((x, 0, 12 - pants_h / 2), (4, 4, pants_h), upper_mat if not torn_legs else torn_legs.get("mat", upper_mat), name)
        rest = 12 - pants_h
        if boot_mat and rest > 0:
            vb.box((x, 0, rest / 2), (4.4, 4.4, rest), boot_mat, name)
        elif rest > 0:
            vb.box((x, 0, rest / 2), (4, 4, rest), lower_mat, name)


# --------------------------------------------------------------------------- characters
def build_survivor(col):
    vb = VoxelBuilder("Survivor")
    m_skin = get_material("Skin", SKIN)
    m_hair = get_material("Hair", HAIR)
    m_camo = get_material("CamoBase", CAMO_BASE)
    camo_mats = [get_material("CamoGreen", CAMO_GREEN), get_material("CamoBrown", CAMO_BROWN),
                 get_material("CamoDark", CAMO_DARK)]
    m_pants = get_material("PantsTan", PANTS_TAN)
    m_boot = get_material("Boot", BOOT)
    m_belt = get_material("Belt", BELT)
    m_pack = get_material("Pack", PACK)
    m_pack_l = get_material("PackLight", PACK_LIGHT)
    m_strap = get_material("Strap", STRAP)

    # head + hair
    vb.box((0, 0, 28), (8, 8, 8), m_skin, "Head")
    vb.box((0, 0, 32.4), (9, 9, 1.4), m_hair, "Head")                 # top
    vb.box((0, 4.3, 29.5), (9, 1.4, 6.5), m_hair, "Head")              # back
    for s in (-1, 1):
        vb.box((s * 4.3, 0.8, 30.5), (1.4, 7.6, 4.5), m_hair, "Head")   # sides
    vb.box((0, -4.3, 31.3), (9, 1.4, 1.6), m_hair, "Head")             # fringe
    vb.box((-2.2, -4.35, 30.2), (3.2, 1.2, 1.2), m_hair, "Head")       # swept fringe
    add_face(vb, get_material("EyeWhite", EYE_WHITE), get_material("EyePupil", EYE_PUPIL))

    # torso / jacket
    vb.box((0, 0, 18), (8, 4, 12), m_camo, "Body")
    add_camo_patches(vb, "Body", (0, 0, 18), (8, 4, 12), camo_mats, seed=1, density=10)
    for s in (-1, 1):                                                   # chest straps
        vb.box((s * 2.6, -2.16, 18.5), (1.4, 0.2, 11), m_strap, "Body")
    vb.box((0, 0, 12.6), (8.5, 4.5, 1.2), m_belt, "Body")              # belt
    vb.box((0, -2.35, 12.6), (1.6, 0.3, 1.0), get_material("Buckle", (0.6, 0.55, 0.4)), "Body")
    # backpack
    vb.box((0, 3.6, 18.5), (7, 3.2, 9.5), m_pack, "Body")
    vb.box((0, 5.5, 16.5), (4.5, 1.6, 3.5), m_pack_l, "Body")          # bottom pouch
    vb.box((0, 4.6, 22.2), (5.5, 2.0, 2.2), m_pack_l, "Body")          # top roll
    for s in (-1, 1):
        vb.box((s * 3.8, 3.6, 18.5), (0.6, 2.4, 8), m_strap, "Body")   # side straps

    add_limbs(vb, m_camo, m_skin, arm_upper_h=9, leg_upper_h=9, boot_mat=m_boot)
    for side in (1, -1):
        add_camo_patches(vb, "Arm_L" if side > 0 else "Arm_R", (side * 6, 0, 19.5), (4, 4, 9),
                         camo_mats, seed=2 + side, density=4)
    for side in (1, -1):                                                # knee pads
        vb.box((side * 2, -2.15, 7.5), (3.2, 0.3, 2.4), get_material("KneePad", (0.45, 0.38, 0.25)),
               "Leg_L" if side > 0 else "Leg_R")
    return vb.build(col)


def build_zombie(col, name, skin, shirt, pants, extras=None, eye=ZOMBIE_EYE):
    vb = VoxelBuilder(name)
    m_skin = get_material(f"{name}_Skin", skin)
    m_skin_d = get_material(f"{name}_SkinDark", tuple(c * 0.78 for c in skin))
    m_eye = get_material(f"{name}_Eye", eye, emission=eye)
    m_mouth = get_material("ZombieMouth", ZOMBIE_MOUTH)
    m_shirt = get_material(f"{name}_Shirt", shirt)
    m_pants = get_material(f"{name}_Pants", pants)

    vb.box((0, 0, 28), (8, 8, 8), m_skin, "Head")
    add_face(vb, m_eye, mouth_mat=m_mouth, emissive_eyes=True)
    vb.box((0, -4.1, 29.6), (5, 0.25, 0.6), m_skin_d, "Head")          # brow
    for s in (-1, 1):                                                   # rot patches
        vb.box((s * 4.1, 1.5, 29.5), (0.25, 2, 2), m_skin_d, "Head")
    vb.box((1.5, 4.1, 27.0), (2.5, 0.25, 2.5), m_skin_d, "Head")

    # torso: shirt on top, torn hem with skin showing
    vb.box((0, 0, 18), (8, 4, 12), m_skin, "Body")
    vb.box((0, 0, 20.5), (8.3, 4.3, 7), m_shirt, "Body")
    vb.box((-2.4, 0, 16.2), (2.6, 4.3, 1.8), m_shirt, "Body")
    vb.box((2.0, 0, 16.6), (2.0, 4.3, 1.2), m_shirt, "Body")
    vb.box((0.3, -2.2, 15.0), (2.0, 0.25, 1.5), m_skin_d, "Body")      # wound

    torn = {"Leg_L": 9, "Leg_R": 6, "mat": m_pants}
    add_limbs(vb, m_shirt, m_skin, arm_upper_h=7, torn_legs=torn)
    vb.box((6, 0, 15), (4.3, 4.3, 1.2), m_skin_d, "Arm_L")             # arm rot
    vb.box((-2, 0, 1.2), (4.4, 4.6, 2.4), get_material("ZombieShoe", (0.3, 0.22, 0.15)), "Leg_R")

    if extras:
        extras(vb, name)
    return vb.build(col)


def worker_extras(vb, name):
    m_hat = get_material("HardHat", (0.95, 0.72, 0.12))
    vb.box((0, 0, 32.6), (9.2, 9.2, 1.6), m_hat, "Head")
    vb.box((0, 0, 33.6), (6, 6, 1.0), m_hat, "Head")
    vb.box((0, -4.9, 31.7), (9.2, 2.2, 0.6), m_hat, "Head")            # brim
    # flannel check on the shirt
    m_check = get_material("FlannelCheck", (0.18, 0.42, 0.34))
    for x in (-3, -1, 1, 3):
        vb.box((x, -2.25, 20.5), (0.8, 0.2, 7.2), m_check, "Body")
        vb.box((x, 2.25, 20.5), (0.8, 0.2, 7.2), m_check, "Body")
    for z in (18.5, 20.5, 22.5):
        vb.box((0, -2.28, z), (8.4, 0.2, 0.7), m_check, "Body")
        vb.box((0, 2.28, z), (8.4, 0.2, 0.7), m_check, "Body")


def soldier_extras(vb, name):
    mats = [get_material("CamoGreyDark", (0.28, 0.28, 0.25)), get_material("CamoGreyTan", (0.62, 0.56, 0.44))]
    add_camo_patches(vb, "Body", (0, 0, 20.5), (8.3, 4.3, 7), mats, seed=11, density=8)
    for side in (1, -1):
        add_camo_patches(vb, "Arm_L" if side > 0 else "Arm_R", (side * 6, 0, 20.5), (4, 4, 7), mats, seed=5 + side, density=3)
    m_vest = get_material("Vest", (0.36, 0.34, 0.28))
    vb.box((0, -2.3, 19.5), (6.5, 0.5, 8), m_vest, "Body")
    vb.box((0, 2.3, 19.5), (6.5, 0.5, 8), m_vest, "Body")
    for s in (-1, 1):
        vb.box((s * 1.7, -2.6, 18.2), (2.2, 0.5, 2.0), get_material("VestPouch", (0.30, 0.28, 0.22)), "Body")
    vb.box((0, 0, 33.0), (8.8, 8.8, 2.0), get_material("Helmet", (0.32, 0.36, 0.28)), "Head")
    vb.box((0, 0, 31.2), (9.0, 9.0, 1.6), get_material("Helmet", (0.32, 0.36, 0.28)), "Head")


def toxic_extras(vb, name):
    m_spot = get_material("ToxicSpot", (0.08, 0.45, 0.10))
    rng = random.Random(9)
    for _ in range(10):
        vb.box((rng.uniform(-3.5, 3.5), -4.12, rng.uniform(25, 31.5)), (1, 0.2, 1), m_spot, "Head")
        vb.box((rng.uniform(-3.5, 3.5), -2.2, rng.uniform(13, 23)), (1.2, 0.2, 1.2), m_spot, "Body")


ZOMBIES = [
    ("Zombie_Basic", ZOMBIE_SKIN, (0.42, 0.42, 0.36), (0.27, 0.31, 0.42), None, ZOMBIE_EYE),
    ("Zombie_Worker", (0.50, 0.68, 0.40), (0.20, 0.36, 0.48), (0.25, 0.30, 0.45), worker_extras, ZOMBIE_EYE),
    ("Zombie_Soldier", (0.44, 0.62, 0.34), (0.46, 0.45, 0.40), (0.40, 0.40, 0.34), soldier_extras, ZOMBIE_EYE),
    ("Zombie_Toxic", (0.16, 0.76, 0.16), (0.12, 0.60, 0.14), (0.10, 0.45, 0.12), toxic_extras, (1.0, 0.85, 0.2)),
]


# --------------------------------------------------------------------------- rig
BONES = {
    # name: (head_px, tail_px, parent)
    "Root":   ((0, 0, 0),   (0, 0, 4),   None),
    "Body":   ((0, 0, 12),  (0, 0, 24),  "Root"),
    "Head":   ((0, 0, 24),  (0, 0, 32),  "Body"),
    "Arm_L":  ((6, 0, 22),  (6, 0, 12),  "Body"),
    "Arm_R":  ((-6, 0, 22), (-6, 0, 12), "Body"),
    "Hand_L": ((6, 0, 12),  (6, 0, 10),  "Arm_L"),
    "Hand_R": ((-6, 0, 12), (-6, 0, 10), "Arm_R"),
    "Leg_L":  ((2, 0, 12),  (2, 0, 0),   "Root"),
    "Leg_R":  ((-2, 0, 12), (-2, 0, 0),  "Root"),
}


def build_armature(col, name, mesh_obj):
    arm_data = bpy.data.armatures.new(name + "_rig")
    arm_obj = bpy.data.objects.new(name + "_rig", arm_data)
    col.objects.link(arm_obj)
    arm_obj.location = mesh_obj.location
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, (h, t, parent) in BONES.items():
        eb = arm_data.edit_bones.new(bname)
        eb.head = Vector(h) * PX
        eb.tail = Vector(t) * PX
        eb.roll = 0.0
        if parent:
            eb.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh_obj.parent = arm_obj
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm_obj


def forward_sign(arm_obj, bone):
    """+1 if positive local-X rotation swings the bone tail toward -Y (forward)."""
    pb = arm_obj.pose.bones[bone]
    pb.rotation_euler = (rad(90), 0, 0)
    bpy.context.view_layer.update()
    y_after = (arm_obj.matrix_world @ pb.tail).y
    pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    y_rest = (arm_obj.matrix_world @ pb.tail).y
    return 1.0 if y_after < y_rest else -1.0


# --------------------------------------------------------------------------- animation
def action_fcurves(action):
    """F-curves of an action across legacy (<=4.3) and layered (4.4+/5.x) actions."""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


class Animator:
    def __init__(self, arm_obj):
        self.arm = arm_obj
        self.ad = arm_obj.animation_data_create()
        self.fwd_limb = forward_sign(arm_obj, "Arm_L")   # arms & legs share orientation
        self.fwd_body = forward_sign(arm_obj, "Body")    # body & head share orientation

    def _reset(self):
        for pb in self.arm.pose.bones:
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)

    def clip(self, name, length, keys):
        """keys: {frame: {bone: (rx, ry, rz)}} in degrees, using 'forward-positive' convention.
        Optional bone key 'Root@loc' gives a Z offset in metres."""
        self._reset()
        action = bpy.data.actions.new(name)
        self.ad.action = action
        slot = None
        if hasattr(action, "slots"):
            slot = action.slots.new("OBJECT", self.arm.name)
            self.ad.action_slot = slot
        for frame, pose in keys.items():
            self._reset()
            for bone, rot in pose.items():
                if bone == "Root@loc":
                    pb = self.arm.pose.bones["Root"]
                    pb.location = (0, 0, rot)
                    pb.keyframe_insert("location", frame=frame)
                    continue
                pb = self.arm.pose.bones[bone]
                sign = self.fwd_body if bone in ("Body", "Head") else self.fwd_limb
                pb.rotation_euler = (rad(rot[0]) * sign, rad(rot[1]), rad(rot[2]))
            for pb in self.arm.pose.bones:
                pb.keyframe_insert("rotation_euler", frame=frame)
        action.frame_range = (1, length)
        action.use_frame_range = True
        for fc in action_fcurves(action):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
        track = self.ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, action)
        if slot is not None:
            try:
                strip.action_slot = slot
            except Exception:
                pass
        self.ad.action = None
        self._reset()
        return action


def survivor_clips(anim):
    anim.clip("Idle", 48, {
        1:  {"Arm_L": (2, 0, 0), "Arm_R": (-2, 0, 0), "Body": (0, 0, 0), "Head": (0, 0, 0)},
        25: {"Arm_L": (-2, 0, 0), "Arm_R": (2, 0, 0), "Body": (1.5, 0, 0), "Head": (-1.5, 0, 0), "Root@loc": -0.012},
        49: {"Arm_L": (2, 0, 0), "Arm_R": (-2, 0, 0), "Body": (0, 0, 0), "Head": (0, 0, 0)},
    })
    anim.clip("Walk", 24, {
        1:  {"Leg_L": (30, 0, 0), "Leg_R": (-30, 0, 0), "Arm_L": (-30, 0, 0), "Arm_R": (30, 0, 0)},
        7:  {"Leg_L": (0, 0, 0), "Leg_R": (0, 0, 0), "Arm_L": (0, 0, 0), "Arm_R": (0, 0, 0), "Root@loc": -0.02},
        13: {"Leg_L": (-30, 0, 0), "Leg_R": (30, 0, 0), "Arm_L": (30, 0, 0), "Arm_R": (-30, 0, 0)},
        19: {"Leg_L": (0, 0, 0), "Leg_R": (0, 0, 0), "Arm_L": (0, 0, 0), "Arm_R": (0, 0, 0), "Root@loc": -0.02},
        25: {"Leg_L": (30, 0, 0), "Leg_R": (-30, 0, 0), "Arm_L": (-30, 0, 0), "Arm_R": (30, 0, 0)},
    })
    anim.clip("Run", 16, {
        1:  {"Leg_L": (50, 0, 0), "Leg_R": (-50, 0, 0), "Arm_L": (-55, 0, 0), "Arm_R": (55, 0, 0), "Body": (10, 0, 0)},
        5:  {"Leg_L": (0, 0, 0), "Leg_R": (0, 0, 0), "Arm_L": (0, 0, 0), "Arm_R": (0, 0, 0), "Body": (10, 0, 0), "Root@loc": -0.04},
        9:  {"Leg_L": (-50, 0, 0), "Leg_R": (50, 0, 0), "Arm_L": (55, 0, 0), "Arm_R": (-55, 0, 0), "Body": (10, 0, 0)},
        13: {"Leg_L": (0, 0, 0), "Leg_R": (0, 0, 0), "Arm_L": (0, 0, 0), "Arm_R": (0, 0, 0), "Body": (10, 0, 0), "Root@loc": -0.04},
        17: {"Leg_L": (50, 0, 0), "Leg_R": (-50, 0, 0), "Arm_L": (-55, 0, 0), "Arm_R": (55, 0, 0), "Body": (10, 0, 0)},
    })
    anim.clip("Aim", 2, {
        1: {"Arm_R": (90, 0, 0), "Arm_L": (85, 0, -25), "Head": (0, 0, 0)},
        2: {"Arm_R": (90, 0, 0), "Arm_L": (85, 0, -25), "Head": (0, 0, 0)},
    })
    anim.clip("Swing", 16, {
        1:  {"Arm_R": (150, 0, 15), "Body": (-5, 0, -15), "Arm_L": (20, 0, 0)},
        6:  {"Arm_R": (30, 0, -10), "Body": (10, 0, 15), "Arm_L": (-10, 0, 0)},
        10: {"Arm_R": (10, 0, -10), "Body": (10, 0, 15), "Arm_L": (-10, 0, 0)},
        17: {"Arm_R": (0, 0, 0), "Body": (0, 0, 0), "Arm_L": (0, 0, 0)},
    })


def zombie_clips(anim):
    anim.clip("Idle", 48, {
        1:  {"Arm_L": (88, 0, 0), "Arm_R": (92, 0, 0), "Head": (6, 0, 4), "Body": (4, 0, 0)},
        25: {"Arm_L": (94, 0, 0), "Arm_R": (86, 0, 0), "Head": (8, 0, -4), "Body": (6, 0, 0), "Root@loc": -0.01},
        49: {"Arm_L": (88, 0, 0), "Arm_R": (92, 0, 0), "Head": (6, 0, 4), "Body": (4, 0, 0)},
    })
    anim.clip("Walk", 32, {
        1:  {"Leg_L": (25, 0, 0), "Leg_R": (-20, 0, 0), "Arm_L": (85, 0, 0), "Arm_R": (95, 0, 0), "Body": (8, 0, 4), "Head": (5, 0, 0)},
        9:  {"Leg_L": (0, 0, 0), "Leg_R": (0, 0, 0), "Arm_L": (90, 0, 0), "Arm_R": (90, 0, 0), "Body": (8, 0, 0), "Head": (5, 0, 0), "Root@loc": -0.025},
        17: {"Leg_L": (-20, 0, 0), "Leg_R": (25, 0, 0), "Arm_L": (95, 0, 0), "Arm_R": (85, 0, 0), "Body": (8, 0, -4), "Head": (5, 0, 0)},
        25: {"Leg_L": (0, 0, 0), "Leg_R": (0, 0, 0), "Arm_L": (90, 0, 0), "Arm_R": (90, 0, 0), "Body": (8, 0, 0), "Head": (5, 0, 0), "Root@loc": -0.025},
        33: {"Leg_L": (25, 0, 0), "Leg_R": (-20, 0, 0), "Arm_L": (85, 0, 0), "Arm_R": (95, 0, 0), "Body": (8, 0, 4), "Head": (5, 0, 0)},
    })
    anim.clip("Attack", 20, {
        1:  {"Arm_L": (90, 0, 0), "Arm_R": (90, 0, 0), "Body": (5, 0, 0)},
        7:  {"Arm_L": (140, 0, 10), "Arm_R": (140, 0, -10), "Body": (-8, 0, 0), "Head": (-10, 0, 0)},
        13: {"Arm_L": (55, 0, -5), "Arm_R": (55, 0, 5), "Body": (18, 0, 0), "Head": (12, 0, 0)},
        21: {"Arm_L": (90, 0, 0), "Arm_R": (90, 0, 0), "Body": (5, 0, 0)},
    })


CHARACTER_ANIMS = {
    "Survivor": ["Idle", "Walk", "Run", "Aim", "Swing"],
    "Zombie_*": ["Idle", "Walk", "Attack"],
}


# --------------------------------------------------------------------------- main
def build_all(export=True):
    bpy.context.scene.render.fps = FPS
    clear_collection("Characters")
    for action in list(bpy.data.actions):          # drop stale clips from earlier runs
        if action.users == 0 or action.name.split(".")[0] in ("Idle", "Walk", "Run", "Aim", "Swing", "Attack"):
            bpy.data.actions.remove(action)
    col = get_collection("Characters")
    built = []

    survivor = build_survivor(col)
    rig = build_armature(col, "Survivor", survivor)
    survivor_clips(Animator(rig))
    built.append(("Survivor", survivor, rig))

    for i, (name, skin, shirt, pants, extras, eye) in enumerate(ZOMBIES):
        z = build_zombie(col, name, skin, shirt, pants, extras, eye)
        zr = build_armature(col, name, z)
        zombie_clips(Animator(zr))
        built.append((name, z, zr))

    # lay them out side by side for viewing
    for i, (name, mesh, rig) in enumerate(built):
        rig.location = ((i - 2) * 1.5, 0, 0)

    if export:
        for name, mesh, rig in built:
            saved = rig.location.copy()
            rig.location = (0, 0, 0)
            export_glb([rig, mesh], os.path.join(CHAR_DIR, f"{name}.glb"), animations=True)
            rig.location = saved
    return built


if __name__ == "__main__":
    build_all()
