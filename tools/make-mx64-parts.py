"""Convert the user's Y-up MX64 STLs to the repo's CAD Z-up convention.

Source convention (as exported): X = width, Y = height, Z = depth (front +Z).
Repo convention: X = width, Y = depth, Z = height (front -Y).
prepareGeometry() then rotates X-90deg, so a file must be written as
(x, -z_src, y_src) for the bake to reproduce the source exactly.

The shelf's faceplate is 45.25mm tall (0.8mm more than 1U because of its
rounded bevel); it is scaled on the height axis to exactly 44.45mm so every
shelf in the planner keeps the u*44.45 rule. The device is left untouched.

Run:  python tools/make-mx64-parts.py <mx64.stl> <shelf-mx64-1u.stl> [outdir]
"""
import os
import struct
import sys

import numpy as np

DEFAULT_MX64 = os.path.join(os.path.expanduser('~'), 'Downloads', 'mx64.stl')
DEFAULT_SHELF = os.path.join(os.path.expanduser('~'), 'Downloads', 'shelf-mx64-1u.stl')
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'models-3d')


def read_stl(path):
    with open(path, 'rb') as fh:
        fh.seek(80)
        n = struct.unpack('<I', fh.read(4))[0]
        raw = fh.read(n * 50)
    arr = np.frombuffer(raw, dtype=np.uint8).reshape(n, 50)
    normals = arr[:, 0:12].view('<f4').reshape(n, 3).astype(np.float64)
    tris = arr[:, 12:48].reshape(n, 36).view('<f4').reshape(n, 3, 3).astype(np.float64)
    return tris, normals


def write_stl(path, tris, header=b''):
    tri = tris.astype('<f4')
    e1 = tri[:, 1] - tri[:, 0]
    e2 = tri[:, 2] - tri[:, 0]
    n = np.cross(e1, e2)
    ln = np.linalg.norm(n, axis=1)
    ln[ln == 0] = 1
    n = n / ln[:, None]
    with open(path, 'wb') as fh:
        fh.write(header.ljust(80, b'\0')[:80])
        fh.write(struct.pack('<I', len(tri)))
        rec = np.zeros(len(tri), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
        rec['n'] = n
        rec['v'] = tri
        fh.write(rec.tobytes())
    size = tri.reshape(-1, 3).max(0) - tri.reshape(-1, 3).min(0)
    print(f'wrote {os.path.basename(path)}  {len(tri)} tris  size='
          f'{size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} (X,Y,Z as stored)')


def to_z_up(tris, height_scale=1.0):
    out = np.empty_like(tris)
    out[:, :, 0] = tris[:, :, 0]          # X width
    out[:, :, 1] = -tris[:, :, 2]         # Y depth (front +Z -> -Y)
    out[:, :, 2] = tris[:, :, 1]          # Z height
    if height_scale != 1.0:
        out[:, :, 2] *= height_scale
    return out


def bake(tris):
    """Mirror prepareGeometry: rotateX(-90), centre X/Z, bottom Y=0."""
    s = np.empty_like(tris)
    s[:, :, 0] = tris[:, :, 0]
    s[:, :, 1] = tris[:, :, 2]
    s[:, :, 2] = -tris[:, :, 1]
    flat = s.reshape(-1, 3)
    mn, mx = flat.min(0), flat.max(0)
    off = np.array([-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2])
    s += off
    flat = s.reshape(-1, 3)
    return s, flat.min(0), flat.max(0)


mx64_src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MX64
shelf_src = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_SHELF
outdir = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_OUT
os.makedirs(outdir, exist_ok=True)

# ---- shelf ----
shelf_tris, _ = read_stl(shelf_src)
h = shelf_tris[:, :, 1].max() - shelf_tris[:, :, 1].min()
scale = 44.45 / h
shelf_z = to_z_up(shelf_tris, scale)
write_stl(os.path.join(outdir, 'shelf-mx64-1u.stl'), shelf_z,
          f'Cisco Meraki MX64 1U tray 254.8x180.4x44.45 (source faceplate {h:.2f}mm -> 1U)'.encode())

# ---- device ----
dev_tris, _ = read_stl(mx64_src)
dev_z = to_z_up(dev_tris)
write_stl(os.path.join(outdir, 'device-mx64.stl'), dev_z,
          b'Cisco Meraki MX64 239x132x25 (pre-rotated to CAD Z-up)')

# ---- placement report (scene frame after prepareGeometry) ----
_, smin, smax = bake(shelf_z)
_, dmin, dmax = bake(dev_z)
print('\nshelf scene bbox  min', np.round(smin, 2), 'max', np.round(smax, 2),
      'size', np.round(smax - smin, 2))
print('device scene bbox min', np.round(dmin, 2), 'max', np.round(dmax, 2),
      'size', np.round(dmax - dmin, 2))

# key shelf planes in the scene frame
def plane_from_source(z_src):
    """Map a source Z (depth) value to the baked, centred Z."""
    src_c = (shelf_tris[:, :, 2].min() + shelf_tris[:, :, 2].max()) / 2
    return z_src - src_c

floor_top_scene = smin[1] + (3.5 - shelf_tris[:, :, 1].min()) * scale
u_back = plane_from_source(66.5)
face_inner = plane_from_source(85.1)
face_outer = plane_from_source(90.4)
print(f'\nfloor top (scene Y)      : {floor_top_scene:.3f}')
print(f'U-channel back (Z)       : {u_back:.2f}')
print(f'faceplate inner/outer (Z): {face_inner:.2f} / {face_outer:.2f}')

slot_y = floor_top_scene + (dmax[1] - dmin[1]) / 2
slot_z = u_back
print(f'\nSUGGESTED SLOT: {{ x: 0, y: {slot_y:.3f}, z: {slot_z:.2f} }}')
base = np.array([0, slot_y - (dmax[1] - dmin[1]) / 2, slot_z - (dmax[2] - dmin[2]) / 2])
wmin = dmin + base
wmax = dmax + base
print('  device world  min', np.round(wmin, 2), 'max', np.round(wmax, 2))
print('  inside X?', bool(wmin[0] >= smin[0] and wmax[0] <= smax[0]))
print('  inside Z?', bool(wmin[2] >= smin[2] and wmax[2] <= smax[2]))
print('  bottom sits on floor?', round(float(wmin[1] - floor_top_scene), 3))
print('  front recess from faceplate outer:', round(float(face_outer - wmax[2]), 2), 'mm')
print('  rear cable gap:', round(float(wmin[2] - smin[2]), 2), 'mm')
