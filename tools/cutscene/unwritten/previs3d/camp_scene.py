"""The Night Before as a grey-box 3D previs in Blender: the fire as the only light (with the
shadows it throws), the tents and props of camp_blocking SET, the three at the fire as seated
mannequins whose heads follow the gaze, and Edric's rise, seen through the seven shot cameras.

    node tools/cutscene/unwritten/previs3d/export_camp.mjs
    blender -b -P tools/cutscene/unwritten/previs3d/camp_scene.py -- \
        [--frames 0-307] [--still 3.0,8.8] [--camshot rise] [--fixcam F] [--sub DIR] \
        [--size 960x540] [--blend]

Edric sits on the ground (batch 8: c_edric_fire, c_edric_rise draw him there), not on the rock
the code camp put under a drawing that never sat on it. Sera sits on her blanket hugging her
knees; Kira on her crate with the map on her knee.

Axes as ford_scene.py: world (X, Y up, Z away) -> Blender (X, Z, Y).
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
JSON = opt('json', os.path.join(ROOT, 'References/cutscene/previs3d/camp.json'))
OUT = opt('out', os.path.join(ROOT, 'References/cutscene/previs3d/camp'))
W, H = (int(v) for v in opt('size', '960x540').split('x'))
D = json.load(open(JSON))
FPS = D['fps']
NF = len(D['cams'])
T = D['time']


def V(X, Y, Z):
    return Vector((X, Z, Y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 0, NF - 1
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.engine = 'BLENDER_EEVEE'
ee = scene.eevee
for attr, val in (('use_shadows', True), ('use_gtao', True), ('taa_render_samples', 32)):
    if hasattr(ee, attr):
        setattr(ee, attr, val)
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('night')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.08, 0.08, 0.16, 1)
bg.inputs[1].default_value = 0.12


def mat(name, rgb, rough=0.85, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*rgb, 1)
        p.inputs['Emission Strength'].default_value = emit
    return m


M = {
    'ground': mat('ground', (0.30, 0.26, 0.20)),
    'canvas': mat('canvas', (0.62, 0.50, 0.30)),
    'wood': mat('wood', (0.35, 0.25, 0.15)),
    'stone': mat('stone', (0.45, 0.44, 0.42)),
    'fire': mat('fire', (1.0, 0.45, 0.12), emit=12),
    'blanket': mat('blanket', (0.45, 0.20, 0.25)),
    'edric': mat('edric', (0.10, 0.45, 0.42)),
    'edric_legs': mat('edric_legs', (0.45, 0.33, 0.22)),
    'sera': mat('sera', (0.45, 0.18, 0.45)),
    'kira': mat('kira', (0.62, 0.10, 0.12)),
    'kira_legs': mat('kira_legs', (0.20, 0.15, 0.12)),
    'skin': mat('skin', (0.85, 0.70, 0.58)),
    'front': mat('front', (0.95, 0.80, 0.15)),
    'steel': mat('steel', (0.85, 0.87, 0.90), rough=0.25),
    'map': mat('map', (0.85, 0.78, 0.60)),
}


def link(o):
    scene.collection.objects.link(o)
    return o


def mesh_obj(name, verts, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(material)
    return link(o)


def prim(kind, material, loc, scale, rot_z=0.0, **kw):
    getattr(bpy.ops.mesh, f'primitive_{kind}_add')(**kw)
    o = bpy.context.active_object
    o.location = loc
    o.scale = scale
    o.rotation_euler = (0, 0, rot_z)
    o.data.materials.append(material)
    return o


# the ground: a wide plane with a slight roll so the far tents sit lower than the horizon
mesh_obj('ground', [V(-80, 0, -80), V(80, 0, -80), V(80, 0, 120), V(-80, 0, 120)], [(0, 1, 2, 3)],
         M['ground'])

# the fire: a ring of stones, two logs, a flame cone, and its light (the only key light)
F = D['fire']
for k in range(9):
    a = k / 9 * math.tau
    prim('uv_sphere', M['stone'], V(F['x'] + 0.5 * math.cos(a), 0.06, F['z'] + 0.5 * math.sin(a)),
         (0.13, 0.11, 0.09), segments=12, ring_count=6)
for a in (0.5, 2.2):
    o = prim('cylinder', M['wood'], V(F['x'], 0.12, F['z']), (0.06, 0.06, 0.45), vertices=10)
    o.rotation_euler = (math.radians(70), 0, a)
flame = prim('cone', M['fire'], V(F['x'], 0.35, F['z']), (0.28, 0.28, 0.35), vertices=12)
flame.visible_shadow = False  # the flame must not block its own light
light = bpy.data.lights.new('fire', 'POINT')
light.color = (1.0, 0.55, 0.25)
light.energy = 700
light.shadow_soft_size = 0.25
lo = bpy.data.objects.new('fire', light)
lo.location = V(F['x'], 0.8, F['z'])
link(lo)
# a faint cool fill from the sky so the far sides aren't black
moon = bpy.data.lights.new('sky', 'SUN')
moon.energy = 0.08
moon.color = (0.6, 0.65, 1.0)
mo = bpy.data.objects.new('sky', moon)
mo.rotation_euler = (math.radians(40), 0, math.radians(160))
link(mo)
# flicker: the fire light breathes on twos
lo.data.animation_data_create()
act = bpy.data.actions.new('flicker')
lo.data.animation_data.action = act
for f in range(0, NF, 2):
    e = 700 * (0.85 + 0.15 * math.sin(f * 1.7) * math.sin(f * 0.61 + 1))
    light.energy = e
    light.keyframe_insert('energy', frame=f)

# the set
S = D['set']
for k, tnt in enumerate(S['tents']):
    L, w, h = tnt['L'], tnt['w'], tnt['h']
    # a ridge tent: a triangular prism along local x, centred, the door at -x
    vs = [(-L / 2, -w / 2, 0), (-L / 2, w / 2, 0), (-L / 2, 0, h - tnt.get('sag', 0) * 0.3),
          (L / 2, -w / 2, 0), (L / 2, w / 2, 0), (L / 2, 0, h - tnt.get('sag', 0) * 0.3)]
    fs = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (0, 2, 5, 3)]
    o = mesh_obj(f'tent{k}', vs, fs, M['canvas'])
    o.location = V(tnt['x'], 0, tnt['z'])
    o.rotation_euler = (0, 0, -tnt['yaw'])
for s in S['stumps']:
    prim('cylinder', M['wood'], V(s['x'], s['h'] / 2, s['z']), (s['r'], s['r'], s['h'] / 2),
         vertices=14)
for b in S['barrels']:
    prim('cylinder', M['wood'], V(b['x'], b['h'] / 2, b['z']), (b['r'], b['r'], b['h'] / 2),
         vertices=16)
for c in S['crates']:
    prim('cube', M['wood'], V(c['x'], c['sy'], c['z']), (c['sx'], c['sz'], c['sy']),
         rot_z=-c['yaw'])
for bn in S['benches']:
    prim('cube', M['wood'], V(bn['x'], bn['h'], bn['z']), (bn['sx'], bn['sz'], 0.04),
         rot_z=-bn['yaw'])
# Sera's blanket
seat = {s['id']: s for s in S['seats']}
bl = seat['sera']
prim('cube', M['blanket'], V(bl['x'], 0.03, bl['z']), (bl['sx'], bl['sz'], 0.03), rot_z=-bl['yaw'])
# Kira's crate (her drawing paints it; here it carries the mannequin)
kc = seat['kira']
prim('cube', M['wood'], V(kc['x'], kc['h'] / 2, kc['z']), (kc['sx'], kc['sz'], kc['h'] / 2),
     rot_z=-kc['yaw'])
# the spear tripod and the banner pole
tp = S['tripod']
for k in range(3):
    a = k / 3 * math.tau
    base = V(tp['x'] + 0.45 * math.cos(a), 0, tp['z'] + 0.45 * math.sin(a))
    top = V(tp['x'], 2.4, tp['z'])
    d = top - base
    o = prim('cylinder', M['wood'], base, (0.025, 0.025, d.length), vertices=8)
    o.data.transform(Matrix.Translation((0, 0, 0.5)))
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
bp = S['banner']
prim('cylinder', M['wood'], V(bp['x'], bp['h'] / 2, bp['z']), (0.04, 0.04, bp['h'] / 2), vertices=8)

# ------------------------------------------------------------------------ the mannequins
#
# Each person is a few joints in a local frame (x forward, y up, z to their left), placed at the
# seat and turned to face +X or -X. Poses are keyed in time; the head turns to the gaze point.

POSES = {
    # Edric on the ground (c_edric_fire): one knee drawn up, the other leg folded under it,
    # forearms on the knee, the sword across it
    'e_sit': {
        'hips': (0.0, 0.14, 0), 'neck': (0.08, 0.66, 0), 'head': (0.11, 0.86, 0),
        'kneeN': (0.36, 0.48, -0.1), 'footN': (0.5, 0.06, -0.12),
        'kneeF': (0.42, 0.18, 0.2), 'footF': (0.12, 0.06, 0.08),
        'elbowN': (0.28, 0.42, -0.2), 'handN': (0.44, 0.46, -0.12),
        'elbowF': (0.26, 0.42, 0.2), 'handF': (0.42, 0.44, 0.06),
        'sword': ((0.2, 0.42, -0.05), (1.05, 0.06, 0.05)),
    },
    # pushing up: a hand flat on the ground behind, one foot under him, hips coming up
    'e_push': {
        'hips': (0.0, 0.34, 0), 'neck': (0.22, 0.78, 0), 'head': (0.26, 0.98, 0),
        'kneeN': (0.32, 0.5, -0.1), 'footN': (0.28, 0.06, -0.12),
        'kneeF': (0.35, 0.25, 0.15), 'footF': (0.05, 0.06, 0.12),
        'elbowN': (0.08, 0.5, -0.24), 'handN': (-0.15, 0.04, -0.28),
        'elbowF': (0.36, 0.55, 0.2), 'handF': (0.5, 0.45, 0.12),
        'sword': ((0.5, 0.45, 0.12), (1.2, 0.2, 0.15)),
    },
    'e_crouch': {
        'hips': (0.05, 0.62, 0), 'neck': (0.3, 1.1, 0), 'head': (0.34, 1.3, 0),
        'kneeN': (0.4, 0.5, -0.1), 'footN': (0.28, 0.06, -0.12),
        'kneeF': (0.25, 0.42, 0.12), 'footF': (-0.12, 0.06, 0.12),
        'elbowN': (0.3, 0.8, -0.24), 'handN': (0.4, 0.56, -0.22),
        'elbowF': (0.36, 0.85, 0.2), 'handF': (0.5, 0.65, 0.12),
        'sword': ((0.5, 0.65, 0.12), (1.0, 0.0, 0.18)),
    },
    'e_stand': {
        'hips': (0.0, 0.95, 0), 'neck': (0.02, 1.48, 0), 'head': (0.0, 1.68, 0),
        'kneeN': (0.05, 0.5, -0.1), 'footN': (0.08, 0.06, -0.12),
        'kneeF': (-0.02, 0.5, 0.12), 'footF': (-0.05, 0.06, 0.12),
        'elbowN': (0.0, 1.2, -0.24), 'handN': (0.05, 0.92, -0.24),
        'elbowF': (0.0, 1.2, 0.24), 'handF': (0.08, 0.92, 0.22),
        'sword': ((0.08, 0.92, 0.22), (0.45, 0.02, 0.3)),
    },
    # Sera on her blanket, hugging her knees
    's_sit': {
        'hips': (0.0, 0.2, 0), 'neck': (0.0, 0.72, 0), 'head': (0.02, 0.92, 0),
        'kneeN': (0.3, 0.52, -0.08), 'footN': (0.42, 0.1, -0.08),
        'kneeF': (0.3, 0.52, 0.08), 'footF': (0.42, 0.1, 0.08),
        'elbowN': (0.18, 0.42, -0.2), 'handN': (0.36, 0.5, -0.02),
        'elbowF': (0.18, 0.42, 0.2), 'handF': (0.36, 0.5, 0.02),
    },
    # Kira on the crate, the map on her knee
    'k_sit': {
        'hips': (0.0, 0.58, 0), 'neck': (0.05, 1.1, 0), 'head': (0.07, 1.3, 0),
        'kneeN': (0.42, 0.6, -0.1), 'footN': (0.46, 0.06, -0.12),
        'kneeF': (0.42, 0.6, 0.1), 'footF': (0.48, 0.06, 0.12),
        'elbowN': (0.2, 0.82, -0.2), 'handN': (0.42, 0.7, -0.1),
        'elbowF': (0.2, 0.82, 0.2), 'handF': (0.42, 0.7, 0.1),
        'map': ((0.3, 0.68, -0.18), (0.62, 0.66, 0.18)),
    },
}


def pose_lerp(a, b, k):
    out = {}
    for key in a:
        va, vb = a[key], b[key]
        if isinstance(va[0], tuple):
            out[key] = tuple(tuple(x + (y - x) * k for x, y in zip(p, q)) for p, q in zip(va, vb))
        else:
            out[key] = tuple(x + (y - x) * k for x, y in zip(va, vb))
    return out


def smooth(u):
    u = min(1, max(0, u))
    return u * u * (3 - 2 * u)


def edric_pose(t):
    keys = [(T['rise'], 'e_sit'), (T['rise'] + 0.3, 'e_push'), (T['rise'] + 0.55, 'e_crouch'),
            (T['standing'], 'e_stand')]
    if t <= keys[0][0]:
        return POSES['e_sit']
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t <= t1:
            return pose_lerp(POSES[p0], POSES[p1], smooth((t - t0) / (t1 - t0)))
    return POSES['e_stand']


def world_pt(who, p):
    P = D['people'][who]
    f = P['face']
    sx, sz = P['seat']
    # local (x forward, y up, z to their left): facing +X their left is +Z (away from the
    # default camera, which sees their right side); facing -X both turn round
    return V(sx + f * p[0], p[1], sz + f * p[2])


UNIT_CYL = None
UNIT_SPH = None


def unit_meshes():
    global UNIT_CYL, UNIT_SPH
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=1, depth=1)
    c = bpy.context.active_object
    c.data.transform(Matrix.Translation((0, 0, 0.5)))
    UNIT_CYL = c.data
    bpy.data.objects.remove(c)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1)
    s = bpy.context.active_object
    UNIT_SPH = s.data
    UNIT_SPH.materials.append(M['stone'])
    bpy.data.objects.remove(s)


unit_meshes()


def obj_mat(o, material):
    o.material_slots[0].link = 'OBJECT'
    o.material_slots[0].material = material


def bake(o, path, values, n):
    o.animation_data_create()
    act = o.animation_data.action or bpy.data.actions.new(f'{o.name}_act')
    o.animation_data.action = act
    for i in range(n):
        for f, v in enumerate(values):
            setattr(o, path, v)
            o.keyframe_insert(path, index=i, frame=f)


class Seg:
    def __init__(self, name, r, material):
        self.r = r
        self.o = link(bpy.data.objects.new(name, UNIT_CYL.copy()))
        self.o.data.materials.append(material)
        self.o.rotation_mode = 'QUATERNION'
        self.caps = []
        for e in 'ab':
            s = link(bpy.data.objects.new(f'{name}_{e}', UNIT_SPH))
            obj_mat(s, material)
            s.scale = (r, r, r)
            self.caps.append(s)
        self.k = {'loc': [], 'rot': [], 'scl': [], 'a': [], 'b': []}

    def at(self, a, b):
        d = b - a
        self.k['loc'].append(a)
        self.k['rot'].append(Vector((0, 0, 1)).rotation_difference(d.normalized()))
        self.k['scl'].append(Vector((self.r, self.r, max(d.length, 1e-4))))
        self.k['a'].append(a)
        self.k['b'].append(b)

    def bake(self, static=False):
        if static:
            self.o.location, self.o.rotation_quaternion, self.o.scale = (
                self.k['loc'][0], self.k['rot'][0], self.k['scl'][0])
            self.caps[0].location, self.caps[1].location = self.k['a'][0], self.k['b'][0]
            return
        bake(self.o, 'location', self.k['loc'], 3)
        bake(self.o, 'rotation_quaternion', self.k['rot'], 4)
        bake(self.o, 'scale', self.k['scl'], 3)
        bake(self.caps[0], 'location', self.k['a'], 3)
        bake(self.caps[1], 'location', self.k['b'], 3)


LOOK = {'edric': ('edric', 'edric_legs'), 'sera': ('sera', 'sera'), 'kira': ('kira', 'kira_legs')}
BASE = {'edric': 'e_sit', 'sera': 's_sit', 'kira': 'k_sit'}


def build(who):
    top, legs = LOOK[who]
    segs = {n: Seg(f'{who}.{n}', r, M[m]) for n, r, m in [
        ('trunk', 0.15, top), ('neck', 0.05, 'skin'), ('hips', 0.09, legs),
        ('shoulders', 0.06, top), ('thighN', 0.075, legs), ('shinN', 0.06, legs),
        ('thighF', 0.075, legs), ('shinF', 0.06, legs), ('upperN', 0.05, top),
        ('foreN', 0.042, 'skin'), ('upperF', 0.05, top), ('foreF', 0.042, 'skin'),
        ('nose', 0.035, 'front')]}
    extra = None
    if who == 'edric':
        extra = Seg('edric.sword', 0.02, M['steel'])
    if who == 'kira':
        extra = Seg('kira.map', 0.12, M['map'])
    head = link(bpy.data.objects.new(f'{who}.head', UNIT_SPH))
    obj_mat(head, M['skin'])
    head.scale = (0.115, 0.115, 0.13)
    head_k = []
    moving = who == 'edric'
    gz = D['gaze'][who]
    face = D['people'][who]['face']
    for fr in range(NF):
        t = fr / FPS
        p = edric_pose(t) if who == 'edric' else POSES[BASE[who]]
        P = {k: world_pt(who, v) for k, v in p.items() if not isinstance(v[0], tuple)}
        segs['trunk'].at(P['hips'], P['neck'])
        segs['neck'].at(P['neck'], P['head'])
        head_k.append(P['head'])
        side = Vector((0, face * 0.11, 0))
        segs['hips'].at(P['hips'] - side, P['hips'] + side)
        segs['shoulders'].at(P['neck'] - side * 1.7 + Vector((0, 0, -0.06)),
                             P['neck'] + side * 1.7 + Vector((0, 0, -0.06)))
        hipN = P['hips'] - side
        hipF = P['hips'] + side
        segs['thighN'].at(hipN, P['kneeN'])
        segs['shinN'].at(P['kneeN'], P['footN'])
        segs['thighF'].at(hipF, P['kneeF'])
        segs['shinF'].at(P['kneeF'], P['footF'])
        shN = P['neck'] - side * 1.7 + Vector((0, 0, -0.06))
        shF = P['neck'] + side * 1.7 + Vector((0, 0, -0.06))
        segs['upperN'].at(shN, P['elbowN'])
        segs['foreN'].at(P['elbowN'], P['handN'])
        segs['upperF'].at(shF, P['elbowF'])
        segs['foreF'].at(P['elbowF'], P['handF'])
        # the nose points at what they look at (the gaze point), smoothed over a few frames
        g = Vector(gz[max(0, fr - 2)])
        tgt = V(g[0], g[1], g[2])
        d = (tgt - P['head']).normalized()
        segs['nose'].at(P['head'], P['head'] + d * 0.17)
        if who == 'edric':
            a, b = p['sword']
            extra.at(world_pt(who, a), world_pt(who, b))
        if who == 'kira':
            a, b = p['map']
            extra.at(world_pt(who, a), world_pt(who, b))
    for name, s in segs.items():
        s.bake(static=not moving and name != 'nose')
    if extra:
        extra.bake(static=not moving)
    bake(head, 'location', head_k, 3) if moving else setattr(head, 'location', head_k[0])


for who in D['people']:
    build(who)

# ------------------------------------------------------------------------ the camera


def cam_matrix(c):
    yaw, pitch, roll = c.get('yaw', 0), c.get('pitch', 0), c.get('roll', 0)
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    f = (sy * cp, sp, cy * cp)
    r0 = (cy, 0, -sy)
    u0 = (f[1] * r0[2], f[2] * r0[0] - f[0] * r0[2], -f[1] * r0[0])
    cr, sr = math.cos(roll), math.sin(roll)
    r = [r0[i] * cr + u0[i] * sr for i in range(3)]
    u = [u0[i] * cr - r0[i] * sr for i in range(3)]
    R, U, Fw = V(*r), V(*u), V(*f)
    m = Matrix(((R.x, U.x, -Fw.x, 0), (R.y, U.y, -Fw.y, 0), (R.z, U.z, -Fw.z, 0), (0, 0, 0, 1)))
    m.translation = V(c['x'], c['y'], c['z'])
    return m


cd = bpy.data.cameras.new('shot')
cd.sensor_fit = 'HORIZONTAL'
cd.sensor_width = 36
cd.clip_start, cd.clip_end = 0.05, 500
cam = link(bpy.data.objects.new('shot', cd))
scene.camera = cam
cams = [c['cam'] for c in D['cams']]
if opt('fixcam'):
    cams = [cams[int(opt('fixcam'))]] * NF
if opt('camshot'):
    sh = next(x for x in D['shots'] if x['name'] == opt('camshot'))
    f0 = math.ceil(sh['from'] * FPS - 1e-6)
    f1 = min(NF - 1, math.ceil(sh['to'] * FPS - 1e-6) - 1)
    cams = [cams[min(max(i, f0), f1)] for i in range(NF)]
cam.rotation_mode = 'QUATERNION'
mats = [cam_matrix(c) for c in cams]
bake(cam, 'location', [m.to_translation() for m in mats], 3)
bake(cam, 'rotation_quaternion', [m.to_quaternion() for m in mats], 4)
cd.animation_data_create()
for f, c in enumerate(cams):
    cd.lens = c.get('focal', 360) * 36 / 480
    cd.keyframe_insert('lens', frame=f)

if opt('blend'):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'camp_previs.blend'))

sub = opt('sub') or 'shots'
os.makedirs(os.path.join(OUT, sub), exist_ok=True)
frames = range(NF)
if opt('frames'):
    a_, b_ = (int(v) for v in opt('frames').split('-'))
    frames = range(a_, min(NF - 1, b_) + 1)
if opt('still'):
    frames = [round(float(t) * FPS) for t in opt('still').split(',')]
for fr in frames:
    scene.frame_set(fr)
    scene.render.filepath = os.path.join(OUT, sub, f'{fr:04d}.png')
    bpy.ops.render.render(write_still=True)
print(f'rendered {len(list(frames))} frames to {os.path.join(OUT, sub)}')
