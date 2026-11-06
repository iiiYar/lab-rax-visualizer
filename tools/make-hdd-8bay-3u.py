"""Merge the 8-bay HDD enclosure STLs (print orientation) into ONE app-frame
STL for the Lab Rax planner.

App frame (Z-up CAD, matching existing shelf models like shelf-open-1u):
  X = width (222 nominal, centered on 0)
  Y = depth (front 0 .. rear ~179.5)
  Z = height (0 .. 133.35 = exactly 3U; the real shell is 147.5 tall, so a
      uniform Z squash of 133.35/147.5 ~= 0.904 is baked in so the part fills
      a 3U slot without clipping its neighbours — same as the ~2-3mm undersize
      the stock plates already carry, just larger. Print dimensions are
      unaffected: makers print from MakerWorld, not from this viz mesh.)

Assembly (from photos + measured bounds, all mm):
  Bottom plate  [0..19.5]      Top plate [127..147.5]
  Back panel    Y [158.5..179.5] (21 thick at rear)
  8 caddy bodies X pitch ~27 (measured from bottom-plate guide ribs),
                Y [0.75..157.75], Z [20..139] (tops bury into top plate,
                as on the real part where caddy tops meet the top rail)
  8 handles     ship as the SEPARATE device-hdd-caddy-handle.stl (one bay,
                X-centred, Z bottom-anchored) so the app can paint them brown
                and count them in the parts list; slot math lives in
                SHELF_DEVICE_SLOTS (domain/constants.ts), in the baked shelf
                frame (X centred, Y bottom-anchored mm, Z centred mm).
  2 rear handles on the back panel, protruding 14mm rearward (as built)
  Backplane mount buried in the top-plate zone at the rear (invisible,
  kept for fidelity)
  OMITTED: "HDD Bay Rails" (227x147.5x18.2 vented slab) — does not belong on
  the open front (photos prove open bays); likely rack-side slide hardware.

Transforms (all det=+1 rotations, winding preserved):
  plates:  rotX(+90): (x,y,z) -> (x,-z,y)
  back/frame/handle2: perm (x,y,z) -> (y,z,x)
  caddy1:  rotY(+90): (x,y,z) -> (z,y,-x)

Source: the MakerWorld "8-Bay Hard Drive Enclosure For Mini Rack" model
(ID 2503273) ZIP placed next to this script's repo root as
"8+Bay+Hard+Drive+Enclosure+For+Mini+Rack.zip". The script extracts it to a
temp dir, assembles, and writes public/models-3d/shelf-hdd-8bay-3u.stl.

Run:  python tools/make-hdd-8bay-3u.py   (stdlib only, needs the source ZIP)
"""
import struct
import glob
import os
import sys
import tempfile
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, '8+Bay+Hard+Drive+Enclosure+For+Mini+Rack.zip')
OUT = os.path.join(REPO, 'public', 'models-3d', 'shelf-hdd-8bay-3u.stl')
OUT_HANDLE = os.path.join(REPO, 'public', 'models-3d', 'device-hdd-caddy-handle.stl')

U3 = 3 * 44.45          # 133.35
SHELL_H = 147.5
ZSCALE = U3 / SHELL_H   # ~0.9037


def load(path):
    with open(path, 'rb') as fh:
        fh.seek(80)
        n = struct.unpack('<I', fh.read(4))[0]
        tris = [struct.unpack('<12x9fH', fh.read(50))[:9] for _ in range(n)]
    return tris


def xf(tris, fn):
    out = []
    for t in tris:
        p = [fn(t[0], t[1], t[2]), fn(t[3], t[4], t[5]), fn(t[6], t[7], t[8])]
        out.append((p[0][0], p[0][1], p[0][2], p[1][0], p[1][1], p[1][2], p[2][0], p[2][1], p[2][2]))
    return out


def translate(tris, tx, ty, tz):
    return xf(tris, lambda x, y, z: (x + tx, y + ty, z + tz))


def bounds(tris):
    xs = [t[i] for t in tris for i in (0, 3, 6)]
    ys = [t[i] for t in tris for i in (1, 4, 7)]
    zs = [t[i] for t in tris for i in (2, 5, 8)]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def measure_bays(bottom):
    """X centers of the 8 caddy slots from the bottom plate's top-face ribs."""
    b = bounds(bottom)
    top = []
    for t in bottom:
        for v in ((t[0], t[1], t[2]), (t[3], t[4], t[5]), (t[6], t[7], t[8])):
            if v[1] > b[3] - 3.0:
                top.append(v)
    # histogram of top-face vertex X at 1mm
    lo, hi = b[0], b[1]
    nb = int(hi - lo) + 1
    h = [0] * nb
    for (x, y, z) in top:
        h[max(0, min(nb - 1, int(x - lo)))] += 1
    # smooth
    s = [sum(h[max(0, i - 2):i + 3]) for i in range(nb)]
    # peaks: local maxima above mean
    mean = sum(s) / len(s)
    peaks = []
    for i in range(2, nb - 2):
        if s[i] > mean * 1.5 and s[i] >= max(s[i - 2:i]) and s[i] >= max(s[i + 1:i + 3]):
            peaks.append(lo + i)
    # merge peaks closer than 8mm (one rib)
    merged = []
    for p in peaks:
        if merged and p - merged[-1] < 8:
            merged[-1] = (merged[-1] + p) / 2
        else:
            merged.append(p)
    print('rib peaks:', [round(p, 1) for p in merged], flush=True)
    # 17 peaks = 9 boundary ribs (slot edges) + 8 center guide ribs, i.e.
    # peaks[0::2] are the 9 slot boundaries; slots are their midpoints.
    if len(merged) == 17:
        edges = merged[0::2]
        gaps = [edges[i + 1] - edges[i] for i in range(8)]
        print('rib pitch:', [round(g, 2) for g in gaps], flush=True)
        if all(24 < g < 31 for g in gaps):
            # +6 shifts designer X into the centered assembly frame
            # (same +6 the plates get below).
            return [(edges[i] + edges[i + 1]) / 2 + 6 for i in range(8)]
    print('WARNING: expected 17 rib peaks, found %d — falling back to even spacing' % len(merged), flush=True)
    cx = (b[0] + b[1]) / 2 + 6
    return [cx + (i - 3.5) * 27.75 for i in range(8)]


def main():
    if not os.path.isfile(SRC):
        print('missing source ZIP next to repo root:', SRC)
        sys.exit(1)
    work = tempfile.mkdtemp(prefix='hdd8bay-')
    with zipfile.ZipFile(SRC) as z:
        z.extractall(work)

    files = {os.path.basename(p): load(p) for p in glob.glob(work + '/*.stl')}
    print('loaded:', {k: len(v) for k, v in files.items()}, flush=True)

    bottom = files['Bottom HDD bay.stl']
    bays = measure_bays(bottom)
    print('bay centers:', [round(c, 2) for c in bays], flush=True)
    pitch = sum(bays[i + 1] - bays[i] for i in range(7)) / 7
    print('bay pitch: %.2f  span: %.1f' % (pitch, bays[-1] - bays[0]), flush=True)

    parts = []

    def add(name, tris):
        b = bounds(tris)
        print('%-22s X[%7.1f..%7.1f] Y[%7.1f..%7.1f] Z[%7.1f..%7.1f]' %
              (name, b[0], b[1], b[2], b[3], b[4], b[5]), flush=True)
        parts.append(tris)

    # --- plates: rotX(+90) (x,y,z)->(x,-z,y) ---
    bot = xf(bottom, lambda x, y, z: (x, -z, y))
    bot = translate(bot, 6, 158.5, 23)          # X[-111..111] Y[0..158.5] Z[0..19.5]
    add('bottom', bot)

    topf = files['Top HDD bay.stl']
    top = xf(topf, lambda x, y, z: (x, -z, y))
    top = translate(top, 5, 158.5, 138)         # Z[127..147.5]
    add('top', top)

    # --- back + front frame + rear handles + caddy handles: (x,y,z)->(y,z,x) ---
    back = xf(files['HDD Bay Back.stl'], lambda x, y, z: (y, z, x))
    back = translate(back, 33, 158.5, 11)       # X[-111..111] Y[158.5..179.5] Z[0..147.5]
    add('back', back)

    # NOTE (v2): "HDD Bay Rails" (a 227x147.5x18.2 vented slab) is NOT merged.
    # It was first tried as the front bezel, but straight-on renders plus the
    # MakerWorld photos prove the front is OPEN bays (caddy plates edge to
    # edge, no slab, no full-width honeycomb band). The slab matches no
    # enclosure face and is not visible in any photo, so it is almost
    # certainly rack-side rail hardware (the designer's separate slide-rail
    # system) or an optional cover — left out until the assembly guide
    # places it. If it ever belongs in the mesh, map (x,y,z)->(y,z,x),
    # translate (6, 0, 115.5) and append.
    frame = None

    # --- caddy bodies x8 (handles are NOT merged here — they ship as the
    # separate hdd-caddy-handle device so they carry their own colour) ---
    c1 = files['HDD Caddy Part1.stl']
    c2 = files['HDD Caddy Part2.stl']
    for cx in bays:
        # body: rotY(+90) (x,y,z)->(z,y,-x), full 26.1mm width — the real
        # caddies run with ~0.45mm/side clearance in their guides, and the
        # hairline gaps read as the bay dividers in the photos.
        body = xf(c1, lambda x, y, z: (z, y, -x))
        body = translate(body, cx - 13.05, -28.25, 230)   # Y[0.75..157.75] Z[20..139]
        parts.append(body)
    print('caddies: 8 bodies placed (handles ship as device)', flush=True)

    # --- standalone handle device: one bay's handle, X-centred, Z
    # bottom-anchored, unsquashed (slot math in constants.ts lives in the
    # baked shelf frame and accounts for the shelf's Z squash) ---
    hd = xf(c2, lambda x, y, z: (y, z, x))
    hd = translate(hd, 105.05, 0, -98.7)                        # X[-8.85..8.85] Y[0..9.5] Z[0..83.1]
    bhd = bounds(hd)
    print('handle-device X[%.1f..%.1f] Y[%.1f..%.1f] Z[%.1f..%.1f]' %
          (bhd[0], bhd[1], bhd[2], bhd[3], bhd[4], bhd[5]), flush=True)
    with open(OUT_HANDLE, 'wb') as fh:
        fh.write(b'LabRax HDD caddy handle (device)'.ljust(80, b'\0')[:80])
        fh.write(struct.pack('<I', len(hd)))
        for t in hd:
            fh.write(struct.pack('<12x9fH', t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], 0))
    print('wrote', OUT_HANDLE, os.path.getsize(OUT_HANDLE), 'bytes', flush=True)

    # --- rear handles x2 (as built: surface-mounted, protruding rearward) ---
    rh = xf(files['Back Bay Handle.stl'], lambda x, y, z: (y, z, x))
    rhl = translate(rh, -26.2, 179.5, 66.2)   # centered X ~ -103
    add('rear-handle-L', rhl)
    rhr = translate(rh, 179.8, 179.5, 66.2)   # centered X ~ +103
    add('rear-handle-R', rhr)

    # --- backplane mount: buried in the top-plate zone at the rear ---
    bpm = files['HDD Backplane Mount.stl']
    bpm = translate(bpm, -435.2, -35.7, 128)    # X[-62.6..62.6] Y[138..158.4] Z[128..140]
    add('backplane-mount', bpm)

    # --- global Z squash to exactly 3U ---
    merged = [t for p in parts for t in p]
    merged = xf(merged, lambda x, y, z: (x, y, z * ZSCALE))
    b = bounds(merged)
    print('MERGED X[%.1f..%.1f] Y[%.1f..%.1f] Z[%.1f..%.1f] tris=%d' %
          (b[0], b[1], b[2], b[3], b[4], b[5], len(merged)), flush=True)

    with open(OUT, 'wb') as fh:
        fh.write(b'LabRax 8-bay HDD enclosure (3U viz mesh)'.ljust(80, b'\0')[:80])
        fh.write(struct.pack('<I', len(merged)))
        for t in merged:
            fh.write(struct.pack('<12x9fH', t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], 0))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes', flush=True)


if __name__ == '__main__':
    main()
