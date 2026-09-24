"""Generates the Minisforum MS-01 mini PC that sits inside the "Minisforum MS
(1U)" rackmount shelf (see SHELF_DEVICE_SLOTS in src/domain/constants.ts) as
TWO model files:

    public/models-3d/minisforum-ms-01-body.stl   -> dark chassis
    public/models-3d/minisforum-ms-01-front.stl  -> front grille + I/O panel

Real external dimensions are 196 x 189 x 48 mm (Minisforum's own spec, also
quoted by ServeTheHome / TechPowerUp). It's modelled Z-up (Z = height) with the
front face at -Y, matching the other device/part models in this project: the
app's Z-up->Y-up bake then stands it upright with its front facing +Z (the
rack's front), so no extra rotation is needed (unlike the fan, which needs
DEVICE_EXTRA_ROT_X).

Dimensional notes vs. its shelf (the printed rackmount body we converted to
shelf-minisforum-ms-1u.stl, measured 253.9 x 44.25 x 179 mm):
  - width 196 < 253.9  -> fits with room to spare, centred on X
  - height 48  > 44.25 -> ~3.75 mm proud of the top, matching the model
                          author's warning that the machine is "a bit thicker
                          than 1U"
  - depth 189  > 179   -> ~10 mm deeper than the printed body; the slot in
                          constants.ts front-aligns it so the overhang is all
                          at the back, where the rack hides it

Run it with CadQuery (throwaway container, same approach as the other models):

  docker run --rm -v "<repo>:/work" -w /work python:3.11-slim sh -c \
    "apt-get update -qq && apt-get install -y -qq libgl1 libglu1-mesa \
     && pip install -q cadquery && python tools/make-minisforum-ms01.py"
"""
import cadquery as cq

W, D, H = 196.0, 189.0, 48.0   # real external size, mm
R = 4.0                        # vertical-edge fillet
POCKET_INSET = 6.0             # front pocket inset from the body edges
POCKET_T = 2.0                 # front pocket depth (front panel thickness)

# --- chassis -----------------------------------------------------------------
body = cq.Workplane("XY").box(W, D, H, centered=(True, True, False)).edges("|Z").fillet(R)

# Top vents: grooves running along X, spread across the middle of the lid.
GROOVE_D = 3.0
for i in range(-8, 9):
    y = i * 8.0
    cutter = (
        cq.Workplane("XY")
        .box(W - 56.0, GROOVE_D, GROOVE_D, centered=(True, True, True))
        .translate((0, y, H))
    )
    body = body.cut(cutter)

# Side vents: horizontal grooves on both cheeks, spread up the height.
for sign in (1, -1):
    for i in range(4):
        z = 12.0 + i * 8.0
        cutter = (
            cq.Workplane("XY")
            .box(GROOVE_D, D - 70.0, 2.4, centered=(True, True, True))
            .translate((sign * (W / 2), 10.0, z))
        )
        body = body.cut(cutter)

# Front pocket, so the separate front panel can sit flush in it.
pocket = (
    cq.Workplane("XY")
    .box(W - 2 * POCKET_INSET, POCKET_T + 10.0, H - 2 * POCKET_INSET, centered=(True, True, True))
    .translate((0, -D / 2 + (POCKET_T - 10.0) / 2, H / 2))
)
body = body.cut(pocket)

# --- front panel -------------------------------------------------------------
panel = (
    cq.Workplane("XY")
    .box(W - 2 * POCKET_INSET, POCKET_T, H - 2 * POCKET_INSET, centered=(True, True, True))
    .translate((0, -D / 2 + POCKET_T / 2, H / 2))
)

# I/O cutouts (front-left): 2x 10G SFP+, 2x 2.5G RJ45, 2x USB-C, HDMI.
# (cx, cz, width, height) measured in the panel's own X/Z.
ports = [
    (-72.0, 30.0, 15.0, 10.0),
    (-72.0, 17.0, 15.0, 10.0),
    (-48.0, 30.0, 14.0, 11.0),
    (-48.0, 17.0, 14.0, 11.0),
    (-20.0, 30.0, 9.0, 5.0),
    (-20.0, 19.0, 9.0, 5.0),
    (-20.0, 8.0, 16.0, 7.0),
]
for cx, cz, pw, ph in ports:
    cutter = (
        cq.Workplane("XY")
        .box(pw, 12.0, ph, centered=(True, True, True))
        .translate((cx, -D / 2 + 4.5, cz))
    )
    panel = panel.cut(cutter)
    body = body.cut(cutter)

# Grille twill (front-right): thin vertical slots through the panel.
for i in range(28):
    x = 8.0 + i * 3.0
    cutter = (
        cq.Workplane("XY")
        .box(1.4, POCKET_T + 1.0, H - 2 * POCKET_INSET - 8.0, centered=(True, True, True))
        .translate((x, -D / 2 + POCKET_T / 2, H / 2))
    )
    panel = panel.cut(cutter)

# --- export one file per rendered part ---------------------------------------
OUT = "/work/public/models-3d/"
parts = [
    ("minisforum-ms-01-body.stl", body.clean()),
    ("minisforum-ms-01-front.stl", panel.clean()),
]
for name, shape in parts:
    cq.exporters.export(shape.val(), OUT + name, tolerance=0.08, angularTolerance=0.3)
    print("exported " + name)
