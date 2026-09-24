"""Generates the 40mm fan that fits the "40mm fan plate (1U)" shelf
(see SHELF_DEVICE_SLOTS in src/domain/constants.ts) as TWO model files:

    public/models-3d/fan-noctua-40mm-frame.stl     -> beige frame + struts
    public/models-3d/fan-noctua-40mm-impeller.stl  -> brown hub + blades

They're separate files so each part can carry its own colour, the way a real
Noctua fan does: the frame is Noctua's beige (Pantone PQ-2309C, #e7ceb4) and
the impeller their brown (Pantone PQ-483C, #653025) — see DEVICE_TYPE_PARTS in
src/domain/models.ts for where those defaults live in the app.

Noctua's own free CAD downloads (noctua.at -> product -> Downloads) are STEP
files, but that site rate-limits/blocks scripted downloads, so this models the
fan's real external dimensions instead:

  - frame 40 x 40 x 10mm, corner fillet R2
  - 4 x Ø4.3mm mounting holes on a 32 x 32mm grid
  - Ø37mm bore, 4 rear struts, Ø15.5 x 6.5mm hub, 7 pitched blades

Both parts are modelled Z-up in the same coordinate frame (fan axis along +Z),
and the frame part spans the whole 40 x 40 x 10mm envelope. `rack-real.tsx`
passes DEVICE_EXTRA_ROT_X (+90 deg X, on top of the app's Z-up->Y-up bake) so
the fan ends up blowing along the rack's depth axis, then places both parts in
the shelf's slots — see `PreparedGeometry.offset`, which is what keeps parts
loaded separately lined up with each other.

Run it with CadQuery (no local install needed — the same throwaway-container
approach used for the other part conversions):

  docker run --rm -v "<repo>:/work" -w /work python:3.11-slim sh -c \
    "apt-get update -qq && apt-get install -y -qq libgl1 libglu1-mesa \
     && pip install -q cadquery && python tools/make-fan-noctua-40mm.py"
"""
import cadquery as cq

W = 40.0          # frame width / height
T = 10.0          # frame thickness (fan depth)
CORNER_R = 2.0
BORE_D = 37.0
HOLE_D = 4.3
HOLE_PITCH = 32.0
HUB_D = 15.5
HUB_Z0, HUB_Z1 = 2.0, 8.5
STRUT_W = 4.0
STRUT_T = 1.2
STRUT_Z = 0.6
BLADES = 7
BLADE_T = 0.8
BLADE_PITCH = 38.0      # degrees, tilt about the radial axis
BLADE_R0, BLADE_R1 = 7.5, 18.0
BLADE_HALF_W0, BLADE_HALF_W1 = 2.2, 3.4
BLADE_Z = 5.2

# --- frame -------------------------------------------------------------------
# Rounded corners are filleted on the extruded solid's own vertical edges —
# the 2D sketch fillet (`rect(...).vertices().fillet(...)`) needs the Sketch
# API in CadQuery 2.5 and raises on a plain Workplane.
frame = cq.Workplane("XY").rect(W, W).extrude(T).edges("|Z").fillet(CORNER_R)
frame = frame.cut(cq.Workplane("XY").circle(BORE_D / 2).extrude(T))

q = HOLE_PITCH / 2
holes = (
    cq.Workplane("XY")
    .pushPoints([(-q, -q), (q, -q), (-q, q), (q, q)])
    .circle(HOLE_D / 2)
    .extrude(T)
)
frame = frame.cut(holes)

# --- rear struts holding the motor hub ---------------------------------------
strut_len = BORE_D / 2 - (HUB_D / 2 - 1.0)
one_strut = (
    cq.Workplane("XY")
    .center(HUB_D / 2 - 1.0 + strut_len / 2, 0)
    .rect(strut_len, STRUT_W)
    .extrude(STRUT_T)
    .translate((0, 0, STRUT_Z))
)
struts = None
for i in range(4):
    arm = one_strut.rotate((0, 0, 0), (0, 0, 1), 45 + 90 * i)
    struts = arm if struts is None else struts.union(arm)

# --- motor hub ---------------------------------------------------------------
hub = cq.Workplane("XY").circle(HUB_D / 2).extrude(HUB_Z1 - HUB_Z0).translate((0, 0, HUB_Z0))
# --- impeller ----------------------------------------------------------------
def blade():
    return (
        cq.Workplane("XY")
        .polyline(
            [
                (BLADE_R0, -BLADE_HALF_W0),
                (BLADE_R1, -BLADE_HALF_W1),
                (BLADE_R1, BLADE_HALF_W1),
                (BLADE_R0, BLADE_HALF_W0),
            ]
        )
        .close()
        .extrude(BLADE_T)
        .rotate((0, 0, 0), (1, 0, 0), BLADE_PITCH)
        .translate((0, 0, BLADE_Z))
    )


impeller = hub
for i in range(BLADES):
    impeller = impeller.union(blade().rotate((0, 0, 0), (0, 0, 1), i * 360.0 / BLADES + 10))

# --- export one file per rendered part ---------------------------------------
OUT = "/work/public/models-3d/"
parts = [
    ("fan-noctua-40mm-frame.stl", frame.union(struts).clean()),
    ("fan-noctua-40mm-impeller.stl", impeller.clean()),
]
for name, shape in parts:
    cq.exporters.export(shape.val(), OUT + name, tolerance=0.06, angularTolerance=0.2)
    print("exported " + name)
