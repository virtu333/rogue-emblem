"""The Ford as a grey-box 3D previs in Blender: the world's real ground and stones, the water,
and every actor from ford_blocking.js as a mannequin, seen through the camera each frame was
actually rendered with. It answers "is it real?" before any art exists: who faces whom, which
foot carries the weight, where the contact shadows fall.

    blender -b -P tools/cutscene/unwritten/previs3d/ford_scene.py -- \
        [--json References/cutscene/previs3d/ford.json] [--out References/cutscene/previs3d/ford] \
        [--frames 170-250] [--still 192,220] [--side] [--size 960x540] [--blend]

--side renders the flat side-on camera (the blocking's own view) instead of the shot cameras;
--fixcam F holds frame F's camera throughout; --camshot NAME plays that shot's camera move,
held before and after it (a take longer than the cut); --sub DIR names the output folder.
Frames are written as PNGs to <out>/<cam>/####.png; tools/cutscene/unwritten/previs3d/dailies.sh
burns in shot names and joins them into a video.

Axes: the world is X along the crossing, Y up, Z depth (left-handed, as engine/world.js). Blender
gets (x, y, z) = (X, Z, Y), which keeps the screen the same (+X right, +Y up, +Z away).
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if f'--{name}' in argv:
        i = argv.index(f'--{name}')
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return default


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
JSON = opt('json', os.path.join(ROOT, 'References/cutscene/previs3d/ford.json'))
OUT = opt('out', os.path.join(ROOT, 'References/cutscene/previs3d/ford'))
W, H = (int(v) for v in opt('size', '960x540').split('x'))
D = json.load(open(JSON))
FPS = D['fps']
NF = len(D['actors']['edric']['frames'])


def V(X, Y, Z):
    """World (X, Y up, Z depth) -> Blender (x, y, z up)."""
    return Vector((X, Z, Y))


# ------------------------------------------------------------------------------ the scene

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 0
scene.frame_end = NF - 1
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.film_transparent = False
scene.render.engine = 'BLENDER_EEVEE'
ee = scene.eevee
for attr, val in (('use_shadows', True), ('use_gtao', True), ('taa_render_samples', 32)):
    if hasattr(ee, attr):
        setattr(ee, attr, val)
scene.view_settings.view_transform = 'Standard'

world = bpy.data.worlds.new('sky')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.62, 0.62, 0.66, 1)
bg.inputs[1].default_value = 0.55


def mat(name, rgb, rough=0.8, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Roughness'].default_value = rough
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
        if hasattr(m, 'blend_method'):
            m.blend_method = 'BLEND'
        if hasattr(m, 'use_transparency_overlap'):
            m.use_transparency_overlap = False
    return m


M = {
    'ground': mat('ground', (0.36, 0.33, 0.29)),
    'bank': mat('bank', (0.42, 0.40, 0.33)),
    'stone': mat('stone', (0.55, 0.55, 0.57)),
    'slick': mat('slick', (0.40, 0.48, 0.42), rough=0.2),
    'water': None,
    'edric': mat('edric', (0.10, 0.45, 0.42)),
    'edric_legs': mat('edric_legs', (0.45, 0.33, 0.22)),
    'warden': mat('warden', (0.60, 0.06, 0.06)),
    'warden_legs': mat('warden_legs', (0.12, 0.12, 0.13)),
    'line': mat('line', (0.38, 0.10, 0.10)),
    'front': mat('front', (0.95, 0.80, 0.15)),  # the chest plate and nose: which way it faces
    'skin': mat('skin', (0.85, 0.70, 0.58)),
    'steel': mat('steel', (0.85, 0.87, 0.90), rough=0.25),
    'shaft': mat('shaft', (0.30, 0.20, 0.12)),
}



def water_mat():
    # a blue film over the bed: mostly transparent (hashed), so legs and stones read under it
    m = bpy.data.materials.new('water')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    mix = nt.nodes.new('ShaderNodeMixShader')
    dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    dif.inputs[0].default_value = (0.30, 0.45, 0.70, 1)
    mix.inputs[0].default_value = 0.82
    nt.links.new(dif.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


M['water'] = water_mat()

# the sun: low and from upstream-left, so shadows fall toward the lens and read in every shot
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 3.2
sun.angle = math.radians(6)
so = bpy.data.objects.new('sun', sun)
so.rotation_euler = (math.radians(50), 0, math.radians(200))
scene.collection.objects.link(so)


def link(o, coll=None):
    (coll or scene.collection).objects.link(o)
    return o


def mesh_obj(name, verts, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return link(o)


# the ground: the world's own height field (the shoal included)
G = D['world']
xs, zs = G['xs'], G['zs']
verts = [V(X, G['ground'][j][i], Z) for j, Z in enumerate(zs) for i, X in enumerate(xs)]
nx = len(xs)
faces = [
    (j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i)
    for j in range(len(zs) - 1)
    for i in range(nx - 1)
]
mesh_obj('ground', verts, faces, M['ground'])
# a far apron so wide shots don't see the edge of the field
mesh_obj('apron', [V(-200, -0.9, -200), V(200, -0.9, -200), V(200, -0.9, 200), V(-200, -0.9, 200)],
         [(0, 1, 2, 3)], M['bank']).location.z -= 0.02
mesh_obj('water', [V(-40, 0, -60), V(40, 0, -60), V(40, 0, 60), V(-40, 0, 60)],
         [(0, 1, 2, 3)], M['water'])

# the stones: ellipsoids, crown at `top`, sunk into the bed
for k, s in enumerate(G['stones']):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1)
    o = bpy.context.active_object
    o.name = f'stone{k}'
    base = -0.65
    h = s['top'] - base
    o.scale = (s['a'], s['c'], h)
    o.location = V(s['X'], base, s['Z'])
    o.rotation_euler = (0, 0, -math.atan2(s['ez'], s['ex']))
    o.data.materials.append(M['slick' if s['slick'] else 'stone'])
    bpy.ops.object.shade_smooth()

# ------------------------------------------------------------------------- the mannequins

UNIT_CYL = None
UNIT_SPH = None


def unit_meshes():
    global UNIT_CYL, UNIT_SPH
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=1, depth=1)
    c = bpy.context.active_object
    c.data.transform(Matrix.Translation((0, 0, 0.5)))  # base at the origin, along +z
    UNIT_CYL = c.data
    bpy.data.objects.remove(c)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1)
    s = bpy.context.active_object
    UNIT_SPH = s.data
    UNIT_SPH.materials.append(M['stone'])  # one slot; each object links its own material
    bpy.data.objects.remove(s)


def obj_mat(o, material):
    o.material_slots[0].link = 'OBJECT'
    o.material_slots[0].material = material


unit_meshes()


class Seg:
    """A capsule between two moving points: a unit cylinder placed per frame, plus end caps."""

    def __init__(self, name, r, material, caps=True):
        self.r = r
        self.o = link(bpy.data.objects.new(name, UNIT_CYL.copy()))
        self.o.data.materials.append(material)
        self.o.rotation_mode = 'QUATERNION'
        self.caps = []
        if caps:
            for e in ('a', 'b'):
                s = link(bpy.data.objects.new(f'{name}_{e}', UNIT_SPH))
                obj_mat(s, material)
                s.scale = (r, r, r)
                self.caps.append(s)
        self.keys = {'loc': [], 'rot': [], 'scl': [], 'ca': [], 'cb': []}

    def at(self, a, b):
        d = b - a
        L = max(d.length, 1e-4)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        self.keys['loc'].append(a)
        self.keys['rot'].append(q)
        self.keys['scl'].append(Vector((self.r, self.r, L)))
        self.keys['ca'].append(a)
        self.keys['cb'].append(b)

    def bake(self):
        bake(self.o, 'location', self.keys['loc'], 3)
        bake(self.o, 'rotation_quaternion', self.keys['rot'], 4)
        bake(self.o, 'scale', self.keys['scl'], 3)
        if self.caps:
            bake(self.caps[0], 'location', self.keys['ca'], 3)
            bake(self.caps[1], 'location', self.keys['cb'], 3)


def bake(o, path, values, n, frames=None):
    """Write one value per frame as linear keys straight into the F-curves (fast)."""
    frames = frames or list(range(len(values)))
    o.animation_data_create()
    act = o.animation_data.action or bpy.data.actions.new(f'{o.name}_act')
    o.animation_data.action = act
    for i in range(n):
        fc = None
        try:
            fc = act.fcurves.new(path, index=i)
        except Exception:
            # Blender 5 layered actions: fall back to keyframe_insert
            for f, v in zip(frames, values):
                setattr(o, path, v)
                o.keyframe_insert(path, index=i, frame=f)
            continue
        fc.keyframe_points.add(len(values))
        co = []
        for f, v in zip(frames, values):
            co += [f, v[i]]
        fc.keyframe_points.foreach_set('co', co)
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        fc.update()


LOOK = {
    'edric': ('edric', 'edric_legs'),
    'warden': ('warden', 'warden_legs'),
}


def build_actor(name, A):
    top, legs = LOOK.get(name, ('line', 'warden_legs'))
    s = A['dims']
    k = A['scale']
    segs = {
        'trunk': Seg(f'{name}.trunk', 0.15 * k, M[top]),
        'neck': Seg(f'{name}.neck', 0.05 * k, M['skin']),
        'chest': Seg(f'{name}.chest', 0.06 * k, M['front'], caps=False),
        'nose': Seg(f'{name}.nose', 0.035 * k, M['front'], caps=False),
        'shoulders': Seg(f'{name}.shoulders', 0.06 * k, M[top]),
        'hips': Seg(f'{name}.hips', 0.09 * k, M[legs]),
        'weapon': Seg(f'{name}.weapon', 0.018 if A['kind'] == 'spear' else 0.02,
                      M['shaft' if A['kind'] == 'spear' else 'steel'], caps=False),
    }
    for side in ('N', 'F'):
        segs[f'thigh{side}'] = Seg(f'{name}.thigh{side}', 0.075 * k, M[legs])
        segs[f'shin{side}'] = Seg(f'{name}.shin{side}', 0.06 * k, M[legs])
        segs[f'foot{side}'] = Seg(f'{name}.foot{side}', 0.045 * k, M[legs])
        segs[f'upper{side}'] = Seg(f'{name}.upper{side}', 0.05 * k, M[top])
        segs[f'fore{side}'] = Seg(f'{name}.fore{side}', 0.042 * k, M['skin'])
    head = link(bpy.data.objects.new(f'{name}.head', UNIT_SPH))
    obj_mat(head, M[top] if name != 'edric' else M['skin'])
    hr = A['frames'][0].get('headR') or 0.115 * k
    head.scale = (hr, hr, hr * 1.1)
    head_keys = []

    hipW = 0.11 * k
    shW = 0.19 * k
    for F in A['frames']:
        Z = F['Z']
        f = F['facing']
        P = lambda p, dz=0.0: V(p[0], p[1], Z + dz)  # noqa: E731
        hips, neck, head_c, sh = P(F['hips']), P(F['neck']), P(F['head']), P(F['shoulder'])
        segs['trunk'].at(hips, neck)
        segs['neck'].at(neck, head_c)
        head_keys.append(head_c)
        fwd = Vector((f, 0, 0))
        chest_mid = (hips * 0.35 + neck * 0.65)
        segs['chest'].at(chest_mid + fwd * 0.12 * k + Vector((0, 0, -0.08 * k)),
                         chest_mid + fwd * 0.12 * k + Vector((0, 0, 0.12 * k)))
        segs['nose'].at(head_c, head_c + fwd * 0.16 * k)
        segs['shoulders'].at(P(F['shoulder'], -shW), P(F['shoulder'], shW))
        segs['hips'].at(P(F['hips'], -hipW), P(F['hips'], hipW))
        for side, dz_leg, dz_arm in (('N', -hipW, -shW), ('F', hipW, shW)):
            L = F['legs'][side]
            segs[f'thigh{side}'].at(P(F['hips'], dz_leg), P(L['knee'], dz_leg))
            segs[f'shin{side}'].at(P(L['knee'], dz_leg), P(L['foot'], dz_leg))
            segs[f'foot{side}'].at(P(L['foot'], dz_leg), P(L['toe'], dz_leg))
            Ar = F['arms'][side]
            segs[f'upper{side}'].at(P(F['shoulder'], dz_arm), P(Ar['elbow'], dz_arm * 0.7))
            segs[f'fore{side}'].at(P(Ar['elbow'], dz_arm * 0.7), P(Ar['hand'], dz_arm * 0.4))
        w = F['weapon']
        segs['weapon'].at(P(w['butt'], -shW * 0.4), P(w['tip'], -shW * 0.4))
    for sg in segs.values():
        sg.bake()
    bake(head, 'location', head_keys, 3)


for name, A in D['actors'].items():
    build_actor(name, A)

# --------------------------------------------------------------------------- the cameras


def cam_matrix(c):
    """engine/world.js basis(): forward from yaw and pitch, right and up rolled."""
    yaw, pitch, roll = c.get('yaw', 0), c.get('pitch', 0), c.get('roll', 0)
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    f = (sy * cp, sp, cy * cp)
    r0 = (cy, 0, -sy)
    u0 = (f[1] * r0[2] - f[2] * 0, f[2] * r0[0] - f[0] * r0[2], -f[1] * r0[0])
    # engine: u0 = (fy*r0z, fz*r0x - fx*r0z, -fy*r0x)
    u0 = (f[1] * r0[2], f[2] * r0[0] - f[0] * r0[2], -f[1] * r0[0])
    cr, sr = math.cos(roll), math.sin(roll)
    r = [r0[i] * cr + u0[i] * sr for i in range(3)]
    u = [u0[i] * cr - r0[i] * sr for i in range(3)]
    R, U, Fw = V(*r), V(*u), V(*f)
    m = Matrix((
        (R.x, U.x, -Fw.x, 0),
        (R.y, U.y, -Fw.y, 0),
        (R.z, U.z, -Fw.z, 0),
        (0, 0, 0, 1),
    ))
    m.translation = V(c['x'], c['y'], c['z'])
    return m


cam_data = bpy.data.cameras.new('shot')
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.sensor_width = 36
cam_data.clip_start = 0.05
cam_data.clip_end = 500
cam = link(bpy.data.objects.new('shot', cam_data))
scene.camera = cam

side = bool(opt('side'))
if side:
    # the blocking's flat camera: side-on from downstream, following the two fighters, 9 m wide
    E, Wd = D['actors']['edric']['frames'], D['actors']['warden']['frames']
    mats = []
    for i in range(NF):
        cx = (E[i]['hips'][0] + Wd[i]['hips'][0]) / 2
        mats.append(cam_matrix({'x': cx, 'y': 0.6, 'z': -14, 'yaw': 0, 'pitch': 0, 'roll': 0}))
    cam.rotation_mode = 'QUATERNION'
    bake(cam, 'location', [m.to_translation() for m in mats], 3)
    bake(cam, 'rotation_quaternion', [m.to_quaternion() for m in mats], 4)
    cam_data.lens = (240 * 14 / 4.5) * 36 / 480
else:
    cams = D['cams']
    if opt('fixcam'):
        # one held camera for the whole range (a reference video for a video model)
        held = cams[int(opt('fixcam'))]
        cams = [held] * len(cams)
    if opt('camshot'):
        # one shot's camera move, held before its first frame and after its last: a take
        # that runs longer than the cut (a video model needs 4 s or more)
        sh = next(x for x in D['shots'] if x['name'] == opt('camshot'))
        f0 = math.ceil(sh['from'] * FPS - 1e-6)
        f1 = min(NF - 1, math.ceil(sh['to'] * FPS - 1e-6) - 1)
        own = [i for i in range(f0, f1 + 1) if cams[i]]
        a_, b_ = own[0], own[-1]
        cams = [cams[min(max(i, a_), b_)] for i in range(len(cams))]
    last = next(c for c in cams if c)
    mats, lens = [], []
    for c in cams:
        last = c or last
        mats.append(cam_matrix(last['cam']))
        lens.append(last['cam'].get('focal', 360) * 36 / 480)
    cam.rotation_mode = 'QUATERNION'
    bake(cam, 'location', [m.to_translation() for m in mats], 3)
    bake(cam, 'rotation_quaternion', [m.to_quaternion() for m in mats], 4)
    cam_data.animation_data_create()
    act = bpy.data.actions.new('lens')
    cam_data.animation_data.action = act
    try:
        fc = act.fcurves.new('lens')
        fc.keyframe_points.add(len(lens))
        co = []
        for f, v in enumerate(lens):
            co += [f, v]
        fc.keyframe_points.foreach_set('co', co)
        for kp in fc.keyframe_points:
            kp.interpolation = 'CONSTANT'
    except Exception:
        for f, v in enumerate(lens):
            cam_data.lens = v
            cam_data.keyframe_insert('lens', frame=f)

# --------------------------------------------------------------------------- render

if opt('blend'):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ford_previs.blend'))

sub = opt('sub') or ('side' if side else 'shots')
os.makedirs(os.path.join(OUT, sub), exist_ok=True)
frames = range(NF)
if opt('frames'):
    a, b = (int(v) for v in opt('frames').split('-'))
    frames = range(a, b + 1)
if opt('still'):
    frames = [round(float(t) * FPS) for t in opt('still').split(',')]
for fr in frames:
    scene.frame_set(fr)
    scene.render.filepath = os.path.join(OUT, sub, f'{fr:04d}.png')
    bpy.ops.render.render(write_still=True)
print(f'rendered {len(list(frames))} frames to {os.path.join(OUT, sub)}')
