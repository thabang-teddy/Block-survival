"""Rebuild and export every Block Survival asset.

Usage (from a shell, headless):
    blender --background --python "Design/blender_scripts/run_all.py"

Or paste into Blender's Text Editor / Python console and run.
Outputs: Design/Characters/*.glb, Design/Assets/*.glb, Design/Islands/*.glb
and Design/blender_scripts/block_survival.blend (the working scene).
"""
import bpy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def run(module_name):
    path = os.path.join(HERE, module_name + ".py")
    ns = {"__file__": path, "__name__": module_name}
    with open(path, encoding="utf-8") as fh:
        exec(compile(fh.read(), path, "exec"), ns)
    return ns["build_all"](export=True)


def main():
    # start from a clean scene (keep the default light/camera)
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.name == "Cube":
            bpy.data.objects.remove(obj, do_unlink=True)
    run("characters")
    run("assets")
    run("islands")
    # tidy layout: characters at the front, props behind, islands far back
    for name, y in (("Characters", 0), ("Assets", 6), ("Islands", 60)):
        col = bpy.data.collections.get(name)
        if col:
            col.hide_viewport = False
            for o in col.objects:
                if o.parent is None:
                    o.location.y += y
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "block_survival.blend"))
    print("Done.")


if __name__ == "__main__":
    main()
