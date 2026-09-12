"""Shared helpers for building Block Survival voxel assets in Blender.

Conventions
-----------
* 1 world block = 1 m.  Character parts are authored in "pixels" where 16 px = 1 m
  (so a standard character is 32 px = 2 m tall).
* Characters face Blender -Y, which becomes +Z after the glTF Y-up conversion.
* Everything is flat shaded; colours come from simple Principled materials so
  they map cleanly onto three.js MeshStandardMaterial.
"""
import bpy
import bmesh
import os

PX = 1.0 / 16.0  # metres per pixel

DESIGN_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHAR_DIR = os.path.join(DESIGN_DIR, "Characters")
ASSET_DIR = os.path.join(DESIGN_DIR, "Assets")
ISLAND_DIR = os.path.join(DESIGN_DIR, "Islands")


# --------------------------------------------------------------------------- materials
def get_material(name, color, roughness=0.85, emission=None, alpha=1.0):
    """Return a flat Principled material, creating it if needed."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 2.0
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    return mat


# --------------------------------------------------------------------------- collections
def get_collection(name):
    col = bpy.data.collections.get(name)
    if not col:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def clear_collection(name):
    col = bpy.data.collections.get(name)
    if not col:
        return
    for obj in list(col.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


# --------------------------------------------------------------------------- bmesh building
class VoxelBuilder:
    """Accumulates axis-aligned boxes / faces into one mesh with material slots
    and optional per-part vertex groups (for rigging)."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.materials = []           # list of bpy materials (slot order)
        self.groups = []              # vertex group names (index order)
        # create the layer up-front: adding layers later invalidates BMVert refs
        self.deform = self.bm.verts.layers.deform.verify()

    def mat_index(self, mat):
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def group_index(self, name):
        if name is None:
            return None
        if name not in self.groups:
            self.groups.append(name)
        return self.groups.index(name)

    def _deform_layer(self):
        return self.deform

    def box(self, center, size, mat, group=None, scale=PX):
        """Add a box. center/size are in pixels (x, y, z)."""
        cx, cy, cz = (c * scale for c in center)
        hx, hy, hz = (s * scale * 0.5 for s in size)
        mi = self.mat_index(mat)
        gi = self.group_index(group)
        verts = [self.bm.verts.new((cx + sx * hx, cy + sy * hy, cz + sz * hz))
                 for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                    (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
        faces = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                 (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7))
        for f in faces:
            face = self.bm.faces.new([verts[i] for i in f])
            face.material_index = mi
            face.smooth = False
        if gi is not None:
            dl = self._deform_layer()
            for v in verts:
                v[dl][gi] = 1.0
        return verts

    def quad(self, points, mat, group=None):
        """Add one quad from 4 world-space points (metres), CCW seen from outside."""
        mi = self.mat_index(mat)
        gi = self.group_index(group)
        verts = [self.bm.verts.new(p) for p in points]
        face = self.bm.faces.new(verts)
        face.material_index = mi
        face.smooth = False
        if gi is not None:
            dl = self._deform_layer()
            for v in verts:
                v[dl][gi] = 1.0

    def build(self, collection, location=(0, 0, 0)):
        mesh = bpy.data.meshes.new(self.name + "_mesh")
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        for g in self.groups:
            obj.vertex_groups.new(name=g)
        for m in self.materials:
            mesh.materials.append(m)
        self.bm.to_mesh(mesh)
        self.bm.free()
        mesh.update()
        obj.location = location
        return obj


# --------------------------------------------------------------------------- export
def export_glb(objects, filepath, animations=False):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    # hidden objects/collections cannot be selected, so unhide before exporting
    for o in objects:
        for col in o.users_collection:
            col.hide_viewport = False
            col.hide_render = False
        for lc in bpy.context.view_layer.layer_collection.children:
            if lc.collection in o.users_collection:
                lc.exclude = False
                lc.hide_viewport = False
        o.hide_viewport = False
        o.hide_set(False)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    if not any(o.select_get() for o in objects):
        raise RuntimeError(f"Nothing selectable to export for {filepath}")
    bpy.context.view_layer.objects.active = objects[0]
    kwargs = dict(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_materials="EXPORT",
        export_animations=animations,
        export_skins=animations,
    )
    if animations:
        kwargs.update(
            export_animation_mode="NLA_TRACKS",
            export_reset_pose_bones=True,
            export_rest_position_armature=True,
            export_optimize_animation_size=True,
        )
    bpy.ops.export_scene.gltf(**kwargs)
    bpy.ops.object.select_all(action="DESELECT")
    return filepath
