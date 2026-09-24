"""Generates the Lenovo ThinkCentre Tiny (M720q / M920q family) that slides
into the "Tiny rack left keystone (1U)" shelf (see SHELF_DEVICE_SLOTS in
src/domain/constants.ts) as TWO model files:

    public/models-3d/lenovo-tiny-body.stl   -> dark chassis + top vents
    public/models-3d/lenovo-tiny-front.stl  -> front bezel + I/O

The whole M7xxq/M9xxq Tiny family shares one chassis, so one model covers
M720q, M920q, M910q, M710q and friends. Official size is 182.9 x 179 x 34.5 mm
(W x D x H). It's modelled Z-up (Z = height) with its front at -Y, matching the
other parts here: the app's Z-up->Y-up bake then stands it upright facing +Z
(the rack's front), needing no extra rotation.

Dimensional notes vs. its shelf (shelf-tiny-rack-left-keystone.stl, the STEP
part named "M720Q 1U v16", measured 254 x 44.45 x 190 mm):
  - width 182.9 < 254  -> fits with room to spare, centred on X
  - height 34.5  < 44.45 -> sits inside the 1U opening with ~10mm headroom
  - depth 179    < 190  -> slides in with ~11mm to spare at the rear

Run it with CadQuery (throwaway container, same approach as the other models):

  docker run --rm -v "<repo>:/work" -w /work python:3.11-slim sh -c \
    "apt-get update -qq && apt-get install -y -qq libgl1 libglu1-mesa \
     && pip install -q cadquery && python tools/make-lenovo-tiny.py"
"""
import cadquery as cq

W, D, H = 182.9, 179.0, 34.5   # real external size, mm
R = 3.0                        # vertical-edge fillet
FRONT_T = 2.5                  # front bezel thickness
BEZEL_MARGIN = 4.0             # bezel inset from the body edges

# --- chassis -----------------------------------------------------------------
body = (
    cq.Workplane("XY")
    .box(W, D - FRONT_T, H, centered=(True, True, False))
    .translate((0, FRONT_T / 2, 0))
    .edges("|Z")
    .fillet(R)
)

# Top vents: grooves along X across the lid.
GROOVE = 2.5
for i in range(-7, 8):
    y = -30.0 + i * 8.0
    cutter = (
        cq.Workplane("XY")
        .box(W - 70.0, GROOVE, GROOVE, centered=(True, True, True))
        .translate((0, y, H))
    )
    body = body.cut(cutter)

# Side vents: short horizontal grooves on both cheeks.
for sign in (1, -1):
    for i in range(3):
        z = 9.0 + i * 8.0
        cutter = (
            cq.Workplane("XY")
            .box(GROOVE, D - 90.0, 2.2, centered=(True, True, True))
            .translate((sign * (W / 2), 5.0, z))
        )
        body = body.cut(cutter)

# Recess for the front bezel so it sits flush.
recess = (
    cq.Workplane("XY")
    .box(W - 2 * BEZEL_MARGIN, FRONT_T + 8.0, H - 2 * BEZEL_MARGIN, centered=(True, True, True))
    .translate((0, -D / 2 + (FRONT_T - 8.0) / 2, H / 2))
)
body = body.cut(recess)

# --- front bezel -------------------------------------------------------------
front = (
    cq.Workplane("XY")
    .box(W - 2 * BEZEL_MARGIN, FRONT_T, H - 2 * BEZEL_MARGIN, centered=(True, True, True))
    .translate((0, -D / 2 + FRONT_T / 2, H / 2))
)

# I/O cutouts across the bezel: power button, USB-C, USB-A x2, headset, and the
# Lenovo punch-out by the logo. (cx, cz, w, h) in the bezel's own X/Z.
ports = [
    (-70.0, 25.0, 12.0, 6.0),
    (-70.0, 13.0, 12.0, 6.0),
    (-78.0, 3.0, 9.0, 4.0),
    (-50.0, 17.0, 9.0, 6.0),
    (-30.0, 17.0, 9.0, 6.0),
    (-10.0, 17.0, 9.0, 6.0),
    (-52.0, 4.0, 6.0, 6.0),
]
for cx, cz, pw, ph in ports:
    cutter = (
        cq.Workplane("XY")
        .box(pw, FRONT_T + 12.0, ph, centered=(True, True, True))
        .translate((cx, -D / 2 + 4.0, cz))
    )
    front = front.cut(cutter)
    body = body.cut(cutter)

# Slim vent slots on the right of the bezel (the Tiny's front grille).
for i in range(12):
    x = 20.0 + i * 4.0
    cutter = (
        cq.Workplane("XY")
        .box(1.8, FRONT_T + 2.0, H - 2 * BEZEL_MARGIN - 8.0, centered=(True, True, True))
        .translate((x, -D / 2 + FRONT_T / 2, H / 2))
    )
    front = front.cut(cutter)

# --- export one file per rendered part ---------------------------------------
OUT = "/work/public/models-3d/"
parts = [
    ("lenovo-tiny-body.stl", body.clean()),
    ("lenovo-tiny-front.stl", front.clean()),
]
for name, shape in parts:
    cq.exporters.export(shape.val(), OUT + name, tolerance=0.08, angularTolerance=0.3)
    print("exported " + name)
