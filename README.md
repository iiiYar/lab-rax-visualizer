# Lab Rax Planner

A browser-based visualizer and parts-list planner for [Lab Rax](https://the-diy-life.com/introducing-lab-rax-a-3d-printable-modular-10-rack-system/),
a 3D-printable modular 10" rack system. Users pick a rack height (4U–12U),
color each part, lay out shelves, fit devices (fans etc.) into the shelves that
take them, and see a real-time 3D model — built from
the actual Lab Rax STL/3MF part files — update in the viewport. The build
can be exported as a checkable parts list (CSV or XLSX), downloaded as a
ready-to-slice ZIP of every printable file, and shared via URL.

There is no backend, no database, no login, and no build-time secrets. It is
a fully static single-page app — all state lives in the browser
(`localStorage`) or is encoded into the page URL.

## Tech stack

| Concern            | Choice                                              |
|---------------------|------------------------------------------------------|
| Framework           | React 18 + TypeScript                                |
| Build tool          | Vite 5                                                |
| 3D rendering        | Three.js via `@react-three/fiber` + `@react-three/drei` |
| App state           | Zustand (with `persist` middleware → `localStorage`) |
| Styling             | Tailwind CSS                                          |
| Color picker widget | `react-colorful`                                      |
| Spreadsheet export  | `exceljs` — real hyperlinks and a one-click ☐/☑ dropdown per row |
| ZIP packaging       | `jszip` (loaded on demand)                            |

No router, no server framework, no test runner is configured. `npm run build`
produces a static `dist/` folder deployable to any static host.

## How the app is organized

```
src/
  domain/            Pure logic — no React, no Three.js. Start here to understand the model.
    types.ts           Core types: PartType, PartStyle, Shelf, DeviceType, Toggles, BuildState
    constants.ts       Size range (4U–12U), part labels/quantities, pattern registry,
                       device registry + per-shelf-type slot positions
    models.ts          Real-part config: STL/3MF filenames, measured mm offsets used to lay parts out
    defaults.ts        Factory for a fresh default BuildState
    shelves.ts         Shelf placement/gap-finding, resize-clamping and device-slot normalization
    parts-list.ts      buildPartsList() — turns BuildState into export-ready rows (parts + fitted devices)

  store/
    use-build-store.ts Zustand store: the single source of truth for the current build.
                       All mutations (resize, restyle, toggle, shelf edits) go through here.

  components/
    viewer/            The 3D scene
      scene.tsx          <Canvas>, lighting, camera framing (Bounds), OrbitControls, ground grid
      rack-real.tsx       Reads the store and positions every real STL/3MF part in millimetre-space
      parts/real-mesh.tsx             Renders one prepared part geometry with a flat colored material
      materials/use-model-geometry.ts Loads + bakes an .stl/.3mf file into scene-space geometry
    layout/            App chrome
      header.tsx         Branding, live size/part-count, Share/CSV/XLSX/STL ZIP buttons
      sidebar.tsx        Scrollable left menu: size → per-part controls → shelves
      ad-panel.tsx       Unobtrusive support-link panel (bottom of sidebar)
    controls/          Sidebar form controls, one per concern
      size-control.tsx   4U–12U slider
      part-control.tsx   Reusable row: color swatch + visibility toggle (+ on/off toggle for optional parts)
      shelf-editor.tsx   Ordered shelf list with per-shelf type/color + add/remove
      device-editor.tsx  Devices fitted into shelves' own slots (e.g. the 5 fans a 40mm fan plate takes)
      colors-section.tsx Shared 6-swatch palette editor

  ui/                  Generic, store-agnostic input widgets (color-picker, palette-picker, visibility-toggle)

  export/              Parts-list export
    export-csv.ts      Plain CSV with a "☐" tick column (text glyph — CSV has no controls)
    export-xlsx.ts     ExcelJS workbook: parts list + "Print files" sheet, live links,
                       and a ☐/☑ dropdown on every row that can be ticked
    xlsx-common.ts     the shared bits both workbooks use (header band, tick
                       column, links, bytes)
    export-stl-bundle.ts  Zips the printable meshes with PRINT-ME.txt + manifest.csv
    download.ts        Shared Blob-download helper

  domain/print-files.ts  Which files each part needs, their measured sizes, and
                         whether each one is printable (see "Print files" below)

  share/url-state.ts   Encode/decode a BuildState to/from a base64url `?b=` query param

  app.tsx              Top-level grid layout: header / sidebar / viewport
  main.tsx             Entry point — hydrates from a share URL (if present) before mounting React

tools/                 Model-generation scripts (need Docker + CadQuery; not part of the app build)
  make-fan-noctua-40mm.py  Regenerates the fan's frame + impeller STLs in public/models-3d/
  make-minisforum-ms01.py  Regenerates the MS-01's chassis + front-panel STLs in public/models-3d/
  make-lenovo-tiny.py      Regenerates the Lenovo Tiny's chassis + bezel STLs in public/models-3d/
```

### Data flow, in one paragraph

`useBuildStore` (Zustand) holds a single `BuildState` object: rack height,
a `PartStyle` (color, plus a pattern/solid field reserved for a future
per-part pattern feature) per part type, on/off `toggles` for the optional
parts, and an array of `Shelf` objects. Every control in `Sidebar` reads
from and writes to this store. `rack-real.tsx` subscribes to the same store
and re-renders the Three.js scene from the loaded part geometry on every
change. `header.tsx` reads the same store to export or share the current
build.

### The geometry is real, not procedural

Parts are the actual Lab Rax STL/3MF files (`public/models-3d/`), loaded and
prepared once per file (`use-model-geometry.ts` bakes each part's native Z-up
axes into the scene's Y-up convention and re-centers its pivot to
bottom-center). `rack-real.tsx` positions instances of these prepared
geometries using constants measured directly from the models
(`src/domain/models.ts`) rather than nominal/idealized dimensions — rails,
panels, and shelves are mirrored/rotated/offset to snap together the same
way the physical parts do. Height changes are handled by greedily stacking
the fixed segment lengths that actually exist as files (`decomposeIntoSegments`),
e.g. 8U → a 5U + a 3U rail.

### Shelf placement

Each shelf is a fixed-size real part (its size follows `shelfType`, e.g.
always 2U for `plate-2u`) placed at a `startU` row from the bottom of the
rack. Shelves are independently positioned — gaps, and "no shelves at all,"
are both valid; nothing is forced to fill or stack contiguously.
`src/domain/shelves.ts` provides the supporting logic:

- `findFirstGap()` — scans from the top down for the first run of free rows
  a new shelf can occupy.
- `maxDownGrowth()` — how far a shelf (top row held fixed) can grow downward
  before it hits another shelf or the bottom of the rack; caps the shelf-type
  options offered in `ShelfEditor`.
- `clampShelvesToRack()` — called after every resize or load; drops shelves
  that no longer fit, backfills/repairs older persisted/shared shelf data, and
  normalizes each shelf's fitted-device list to its type's own slot count
  (`normalizeShelfDevices()`).

### Device slots (fans and other bolt-ins)

Some shelves have mounting slots of their own, and the parts that go into them
are tracked separately from the printed shelf:

- `SHELF_DEVICE_SLOTS` (`src/domain/constants.ts`) is the whole feature's data:
  per shelf type, the *slot centres* in millimetres (measured off the model
  itself, in the same local frame the shelf mesh is positioned in) plus which
  device types each slot accepts. The **Devices** section of the sidebar only
  appears while a build contains a shelf type with slots. The Devices editor
  covers the shelf's whole bank with one "Slot" row (pick a device and every
  slot fills; "Empty" clears them all).
- `DEVICE_TYPES` gives each device its label, and `DEVICE_TYPE_PARTS`
  (`src/domain/models.ts`) maps it to its own model parts under
  `public/models-3d/` — a file *plus a default colour each*, so a fan renders
  in its real two-tone colours. Devices are loaded like shelves and instanced
  per filled slot by `rack-real.tsx`; `DEVICE_EXTRA_ROT_X` turns a device's
  own axis into the scene's depth axis (so fans face front-to-back), and
  `PreparedGeometry.offset` is what keeps a device's separately-loaded parts
  lined up with each other.
- The one built-in shelf with slots is **40mm fan plate (1U)**: its model is a
  252 × 42 × 6 mm front plate with five 38 × 42 mm openings on a 43.5 mm pitch,
  so one "Slot" row takes five `fan-noctua-40mm` fans — beige frame
  (Noctua PQ-2309C, `#e7ceb4`), brown impeller (Noctua PQ-483C, `#653025`).
- The **Minisforum MS (1U)** rackmount shelf also has one slot, for the
  `minisforum-ms-01` device. The machine's real external size is
  196 × 189 × 48 mm, so against the 253.9 × 44.25 × 179 mm printed shell it is
  slightly taller than the 1U opening and ~10 mm deeper — the slot front-aligns
  it and pushes the overhang to the rear, matching the model author's note that
  the machine is "a bit thicker than 1U".
- **Tiny rack left keystone (1U)** takes one `lenovo-tiny` device (the Lenovo
  ThinkCentre Tiny family — M720q/M920q/M910q/M710q share one chassis, and the
  source STEP part is literally named "M720Q 1U v16"). At 182.9 × 179 × 34.5 mm
  it sits inside the 254 × 44.45 × 190 mm tray with headroom on every axis, so
  the slot just centres it, drops it on the tray floor, and front-aligns it.
- **Keystone plate (1U)** carries ten `keystone-jack` devices — one per 15 mm
  socket bay, centres at ±(11, 33, 55, 77, 99) mm on a 22 mm pitch. The jacks
  slide in from the rear and register against the plate's back face, so the
  dark socket insert faces out through each opening; picking the device in the
  sidebar's Devices section fills all ten bays at once.
- Fitted devices are stored on the shelf (`Shelf.devices`, one entry per slot,
  `null` = empty) so they persist and share with the build, they're re-shaped
  whenever the shelf type changes, and they're counted in the parts list
  export (`buildPartsList`) since they're bought, not printed.

### Persistence and sharing

- `useBuildStore` is wrapped in Zustand's `persist` middleware
  (`localStorage` key `lab-rax-build`), so a reload restores the last build
  automatically.
- The **Share** button (`src/share/url-state.ts`) serializes the current
  `BuildState` to compact JSON, base64url-encodes it, and puts it in a `?b=`
  query param, then copies the full URL to the clipboard.
- On load, `main.tsx` calls `hydrateFromShareParam()` *before* React mounts.
  If a `?b=` param is present and decodes successfully, it overrides
  whatever was in `localStorage` for that session, then strips the param
  from the URL (so a later plain reload falls back to the persisted build,
  not the shared one).
- `decodeBuild()` is defensive: it validates shape field-by-field and falls
  back to defaults for anything missing or malformed, so a hand-edited or
  truncated share link can't crash the app.
- Saved racks live in `src/domain/saved-builds.ts` (`localStorage` key
  `lab-rax-saved-builds`). Every saved entry also has a **Copy link** button
  that produces a normal `?b=` share URL, which is the no-backend way to move
  one rack to another device.
- When the app is served by `server/index.mjs` (the Docker image), the same
  module syncs that list to `GET/PUT /api/builds`. The server keeps it in
  `saved-builds.json` inside the `/data` volume, so saves are shared by every
  device that opens this instance and survive container rebuilds. If the API
  is absent (static hosting) or offline, the module silently stays local-only;
  the sidebar shows whether it is in "server" or "local" mode.

### Print files

`src/domain/print-files.ts` is the single source of truth for "what do I
actually print for this build". Every part maps to one or more files in
`public/models-3d/`, with a measured bounding box and a status:

| Status        | Meaning                                                             |
|---------------|---------------------------------------------------------------------|
| `print`       | Closed, manifold mesh — slice and print as-is                        |
| `review`      | Printable shell but the file also carries open detail shells; repair or delete them first |
| `source-only` | Not a print file: acrylic parts cut from sheet, meshes used only for visualization, and bought hardware |
| `download`    | Printed part with no mesh here — the row gives the count and the model page, and stays out of the zip. Used today by the stand-in side and bottom panels |

That status drives three places:

- the **File** column of the parts list (`buildPartsList`), so a BOM row names
  the exact file instead of only the part;
- the **Print files** sheet of the XLSX export — part, file, measured size,
  quantity, status, note, and a clickable download link per file;
- the **STL ZIP** button in the header, which fetches every `print`/`review`
  file, sorts them into `frame/`, `shelves/`, `accessories/`, and ships one
  ordered row set three ways (`src/export/print-manifest.ts`):
  `print-list.html` — a printable checklist with a tick box and piece count
  per part, split into the print queue (numbered, 1U upward) and a short
  "bought or cut" table; `manifest.xlsx` — the same table with a filter and a
  Summary sheet of counts per group and status; and `manifest.csv` — the same
  rows for scripts. `PRINT-ME.txt` explains all three. `source-only` files are
  never shipped as if they were printable. Every row also carries a **Source**,
  and the workbook gained a `Sources` sheet listing the model page, the files it
  explains, and how it was verified.

  The archive also carries `SHA256SUMS.txt`, one checksum per shipped file in
  `sha256sum -c` format, hashed from the same bytes that were zipped. That is
  what turns "this is the designer's rail" from a label into something a maker
  can verify: download the model, hash it, compare.

`REFERENCE_HASHES` in `domain/sources.ts` goes one step further for the files
whose original download we actually hold: the bundle hashes what it is about to
zip and compares. A match is listed in `PRINT-ME.txt` under **Checked against
the source**; a mismatch prints a warning above it and names both hashes. Only
files with a real reference copy are listed — hashing our own file and calling
it provenance would prove nothing.

Two frame parts are worth naming because the filenames mislead. The top cover
is `panel-top-bottom-fan.stl`, the kit's vented panel and the one the viewer
draws on top; `panel-top-bottom.stl` is a 12-triangle slab with no screw holes,
so a printed bottom is a `download` row pointing at the 5U kit page, not a
file to slice. And the post joiner is derived, not typed in: `buildPartsList` adds it with the same
`joinerCount` the manifest uses, so a parts export cannot list eight rails for
a 12U rack and stay silent about the eight joiners that hold them together.

### The archive is built in a worker, on purpose

`src/export/export-stl-bundle.ts` builds the bundle and downloads it;
`src/export/zip-worker.ts` is the thread it runs on. Keep it that way.

Fetching ~11 MB of mesh, hashing it and deflating the zip on the page thread
used to starve the renderer: on a build with the Mini-ITX shelves the button sat
at "Zipping 10/10" and no download ever fired, while the exact same work took
under a second in Node and half a second in a blank page. The scene, not JSZip,
was the problem — so the work moved to its own thread with its own heap, which
also means the viewer keeps painting during the export. Measured on the 8U
build with both shelves: per-file fetch + hash ~0.4 s total, `generateAsync`
~0.7 s, 3,021,733 bytes out, and `sha256sum -c` verifies all 11 files.

Three things to know before editing this path:

- `vite.config.ts` needs `worker: { format: 'es' }`. The worker imports JSZip
  lazily, and Vite's default IIFE worker output cannot code-split — the build
  fails with `Invalid value "iife" for option "output.format"`.
- The worker returns a `Blob`, not an `ArrayBuffer`. Cloning an immutable Blob
  is cheap; an `ArrayBuffer` would be copied again on the one thread that is
  busy painting.
- The main-thread path is a fallback for "the worker never started" (old
  browser, CSP blocking `worker-src`) and nothing else. A worker that reported a
  real error is re-thrown, because rebuilding the same archive inline would hang
  the way it used to.

`buildStlBundle(state, { baseUrl, fetchFile, onProgress })` stays callable
outside the browser — pass `fetchFile` to read from disk and it builds the whole
archive under Node in about a second, which is how the bundle is checked without
a headless browser.

### Where the model files come from

`src/domain/sources.ts` maps each file in `public/models-3d/` to where it came
from, because a planner that hands out STLs without a trail is a liability:

| Kind          | Meaning                                                        |
|---------------|----------------------------------------------------------------|
| `makerworld`  | A specific MakerWorld model page, with the id in the map        |
| `supplied`    | A download from the owner, pinned by SHA-256 — no page claimed   |
| `repo`        | Built by `tools/make-*.py` from measurements — visualization only |
| `owner`       | The owner's own STL, re-axed by a tool here — printable, no model page |
| `bought`      | Bought hardware; the mesh only shows it in 3D, nothing to print |
| `unrecorded`  | Origin was never written down — flagged on purpose, never invented |

The MakerWorld ids are not search guesses: every page was opened in a browser
and matched by title on 2026-11-13. Header pages in that table:

| Part | Source |
|------|--------|
| Frame kit (rails, handles, feet, panels) | [1294480](https://makerworld.com/en/models/1294480) |
| Posts and side panels 1U–5U | [1294478](https://makerworld.com/en/models/1294478) |
| Extension panels and post joiner | [1304384](https://makerworld.com/en/models/1304384) |
| Open shelf 1U / keystone panel / 5×40mm fan panel | 1297318 / 1293816 / 1293794 |
| 2U 7× SBC holder | [1293865](https://makerworld.com/en/models/1293865) |
| 8-bay HDD enclosure | [2503273](https://makerworld.com/en/models/2503273) |
| Blank cover plates 1U–2U | [1385541](https://makerworld.com/en/models/1385541) |
| 2U two-80mm fan holder | [1385530](https://makerworld.com/en/models/1385530) |
| 1U shelf with slots (remix) | [1357259](https://makerworld.com/en/models/1357259) |
| 2U Mini-ITX + ATX PSU shelf | [1360827](https://makerworld.com/en/models/1360827) |
| 3U Mini-ITX dual-GPU shelf | [1523227](https://makerworld.com/en/models/1523227) |
| Lenovo Tiny mount (remix) | [2213343](https://makerworld.com/en/models/2213343) |

One design limit is stated in the checklist rather than silently ignored: Lab
Rax is designed to 10U. Stacking a second joint past that is physically
possible, but the designer warns the printed parts become the weak point with a
populated rack — so the 11U and 12U builds carry that warning on the sheet.
The app says it too: past 10U the header shows a `Past the 10U design limit`
chip (and the touch controls sheet shows the same line), so the warning is not
buried in an export nobody opened yet.

### Joinery: the part the 5U kit does not include

Posts and panels only come in 1–5U segments, so every rack taller than 5U has a
joint, and each joint takes one printed **post joiner per post** — four per
joint. That row is derived, not typed in:

```ts
joinerCount(rackU) = (segments(rackU).length - 1) * 4   // 8U → 4, 12U → 8
```

The joiner is not in the 5U kit — the designer ships it in the extension pack
(1304384) — so it was the one frame part missing from this repo. It is now
`public/models-3d/post-joiner.stl`, taken from that pack and never redrawn: a
joiner drawn from a description is a joiner that does not fit the posts. The
pack offers a brass-insert variant (shipped here, matching the rest of the
frame) and a bolted 3MF for the bolted kit.

It is also drawn, at every joint, from those measurements rather than by eye —
and the measurements say the plate goes *inside* the post, not on it:

| measured | value | where it comes from |
| --- | --- | --- |
| socket, across the post's width | 7 mm (mesh X 120–127 of 113–143) | `rail-height-{1..5}u.stl` |
| socket, across the post's depth | 24 mm (mesh Y 121.5–145.5 of 110.5–145.5) | same |
| socket depth | 20 mm at both ends (`Z = 20`, `Z = height − 20`, 168 mm² each) | same |
| plate | 23.85 × 39.7 × 7 (23.70 across after the edge chamfer) | `post-joiner.stl` |
| bolts | Ø6.4 (M6 clearance), 20 mm apart, Ø10.9 × 2 mm counterbores on one face | same |

39.7 = 2 × 19.85 is exactly two 20 mm sockets, and 23.85 slides into the
24 mm width, so the plate is a press-fit splice that disappears inside the
post: two stacked segments leave a 40 mm cavity, one bolt lands 10 mm into
each segment, and the only thing visible from outside is the slot on the
post's inner face with the two recessed bolt heads. `rack-real.tsx` puts it
there in the post's own frame (X −8 → −1 mm, Z −17.5 → +6.5 mm, four per
joint) inside the same per-corner group the rails use, so the mirror/rotation
maths is written once. Posts and joiners are separate part types: the joiner
has its own swatch and its own eye icon in **Parts**, and the parts export
follows that swatch instead of borrowing the post colour.

Verified with `trimesh` rather than eyeballed: the prepared plate lands at
`[[−8, 202.4, −17.42], [−1, 242.1, 6.42]]` against a seam at 222.25, inside the
socket's `[[−8, 202.25, −17.5], [−1, 242.25, 6.5]]`, and **0 of 31,680** plate
samples fall inside either neighbouring rail. The counterbored face (raw +Z,
Ø10.9 at 2 mm deep) ends up on local +X after the +90° about Y — the open side
of the socket, which faces the rack interior at all four corners, so the bolt
heads stay reachable from inside the assembled rack.

The plate is 7 mm thick all over: the earlier "5 mm body + 2 mm flange"
reading was wrong, as the area drop above `Z = 5` is the two counterbores
(2 × ~61 mm²), not a flange.

Any printed part this app has no real mesh for falls back to `download`: its
row still appears in the manifest, CSV, workbook and checklist under **Printed,
but not in this archive** with the count and the model page, and stays out of
the zip, because pointing at a filename that is not there — or at a stand-in
mesh — is worse than saying so.

The sizes in `FILE_SIZES` were measured with `trimesh` (`mesh.extents`) over
every file in `public/models-3d/`. If you replace a model, re-measure it:

```bash
python3 -c "import trimesh; print(trimesh.load('public/models-3d/part.stl').extents)"
```

Shelf rows are grouped by `shelfType`, not by height — a 1U fan plate, a 1U
keystone plate, and a 1U open shelf are three different parts and print from
three different files.

### Known simplifications / stretch work not yet built

- **Pattern/perforation styling** is modeled in `PartStyle`/`Shelf`
  (`pattern`, `solid`) and round-trips through persistence, share links, and
  the parts-list export, but there is currently no UI control to set it and
  no visual rendering of it — `RackReal` renders every part as a flat
  colored STL mesh. `part-control.tsx` has a short note on where the control
  used to live.
- **Per-instance part editing** ("click a single rail to recolor just that
  one") is *not* implemented. The store has a `selectedPartId` field and a
  `selectPart` action wired up, and `scene.tsx` clears the selection on an
  empty-space click, but no UI yet reacts to a selection.
- **Checkboxes are dropdowns, not form controls.** Both workbooks write a
  `☐`/`☑` data-validation list into the "Done" column, so one click opens a
  two-item picker and a ticked row dims itself. That is the interactive form
  either library can actually write: OOXML drawing controls are outside
  ExcelJS's and SheetJS's writers, and a dropdown opens without Excel warning
  about unsupported content. The CSV export keeps the `☐` glyph, because a
  plain CSV cell has no control to speak of.
- Ad/support panel links (`ad-panel.tsx`) are placeholders pointing at the
  generic Buy Me a Coffee / Patreon homepages — replace with real account
  links before shipping.
- No automated tests exist yet (no test runner is configured).

## Local development

Prerequisites: Node.js 18+ (project was built/verified with Node 25 and npm
11, but anything ≥18 that supports Vite 5 will work).

```bash
# from the project root
npm install       # install dependencies
npm run server    # JSON persistence API on http://localhost:8787 (optional)
npm run dev       # Vite dev server on http://localhost:5173 (proxies /api)
```

`npm run server` is optional: without it the app runs local-only (saved racks
stay in the browser). With it running, the dev server proxies `/api` to the
JSON file store so you can test cross-device sync locally.

Other scripts:

```bash
npm run typecheck # tsc --noEmit — type-check without emitting files
npm run build     # tsc -b && vite build — production build into dist/
npm run start     # serve dist/ + the /api on PORT (default 8787)
npm run preview   # serve the dist/ build locally, for a pre-deploy sanity check
```

There is no `.env` / environment configuration required. `server/index.mjs`
reads two optional variables: `PORT` (default `8787`) and `DATA_DIR` (default
`./data`).

## Deploying to a web server

The app builds to a fully static `dist/` folder (HTML/CSS/JS + the 3D model
files under `dist/models-3d/`). Any static file host works.

```bash
npm install
npm run build
```

This produces `dist/index.html`, `dist/assets/*.js`/`*.css`, and
`dist/models-3d/*.stl`/`*.3mf`. Copy the entire `dist/` directory to your
host.

A few things to know before deploying:

- **`base` is relative.** `vite.config.ts` sets `base: './'`, so the build's
  asset URLs are relative — it works whether the app is served from a
  domain root (`https://example.com/`) or a subpath
  (`https://example.com/rax-planner/`), with no config changes needed.
- **It's a single-page app with no client-side router**, so there's nothing
  special to configure for deep links — every route *is* `/`. You do not
  need SPA-fallback rewrite rules.
- **Cache the `assets/` folder aggressively.** Vite fingerprints filenames
  in `dist/assets/` (e.g. `index-C0mu_Dzn.js`), so those are safe to cache
  with a long `Cache-Control: max-age=31536000, immutable`. Do *not*
  aggressively cache `index.html` itself — set it to `no-cache` (or a short
  max-age) so users pick up new deploys.
- **Serve `models-3d/*.stl`/`*.3mf` as static assets** (they're plain files
  copied from `public/`, not bundled) — any static host does this by default.

### Docker (with persistent saved racks)

The included `Dockerfile` builds the SPA and runs `server/index.mjs`, which
serves `dist/` and the `/api/builds` JSON store on one port. `docker-compose.yml`
mounts the `rax-data` named volume at `/data`:

```bash
docker compose up -d --build
# open http://<host-ip>:5173 from any device on the same network
```

- Saved racks are written to `/data/saved-builds.json` inside the volume, so
  they survive `docker compose down`, image rebuilds and host reboots.
- Inspect or back up the file:

  ```bash
  docker compose exec app cat /data/saved-builds.json
  docker compose cp app:/data/saved-builds.json ./saved-builds.backup.json
  ```

- Reset every save: `docker compose down -v` (deletes the named volume), or
  remove the JSON file from the volume.
- The API is unauthenticated, which is fine on a trusted LAN. If you publish
  the port to the internet, put it behind a reverse proxy with authentication.

### Example: Nginx

```nginx
server {
    listen 80;
    server_name your-domain.example;
    root /var/www/lab-rax-planner/dist;
    index index.html;

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

### Example: any static host (Netlify, Vercel, GitHub Pages, S3+CloudFront, Cloudflare Pages)

- **Build command:** `npm run build`
- **Publish/output directory:** `dist`
- **Environment variables:** none needed
- No redirect/rewrite rules are required since there's no client-side
  routing; the defaults on all of these platforms serve a static `dist/`
  folder correctly out of the box.

For GitHub Pages specifically, if serving from
`https://<user>.github.io/<repo>/` (a subpath), no change is needed beyond
the existing `base: './'` — this differs from many Vite templates that
require setting `base: '/<repo>/'`, because relative paths already resolve
correctly from any subpath.

## Where to make common changes

| I want to...                                   | Look at...                                             |
|-------------------------------------------------|---------------------------------------------------------|
| Change the size range                            | `src/domain/constants.ts` (`MIN_U`, `MAX_U`, `DEFAULT_U`) |
| Add/remove a part type                           | `src/domain/types.ts` (`PartType`), `constants.ts` (`PART_TYPES`, `PART_LABELS`, `BASE_QUANTITIES`), `rack-real.tsx` (geometry/placement), `defaults.ts` (default style) |
| Add a shelf type                                 | Add the STL/3MF to `public/models-3d/`, register it in `SHELF_TYPES` (`constants.ts`) and `SHELF_TYPE_FILES` (`models.ts`) |
| Add a device type (fan, drive, ...)              | Add the STL/3MF to `public/models-3d/`, register it in `DEVICE_TYPES` (`constants.ts`) and `DEVICE_TYPE_PARTS` (`models.ts`, a file + default colour per rendered part); `tools/` has the generator for the 40mm fan |
| Regenerate a 3D-printed model file               | `tools/make-fan-noctua-40mm.py`, `tools/make-minisforum-ms01.py` (Docker + CadQuery — export the device STLs); other parts were converted from the `.step` files in the repo root the same way |
| Give a shelf its own device slots                | Add the slot centres + accepted devices to `SHELF_DEVICE_SLOTS` (`constants.ts`) — the sidebar's Devices section picks it up automatically |
| Change what's in the parts-list export           | `src/domain/parts-list.ts`                                |
| Change export file format/columns                | `src/export/export-csv.ts`, `src/export/export-xlsx.ts`; shared workbook styling in `src/export/xlsx-common.ts` |
| Change which files a part prints from / print status | `src/domain/print-files.ts`                            |
| Change what goes into the STL archive / how it downloads | `src/export/export-stl-bundle.ts` (build + download) and `src/export/zip-worker.ts` (the thread it runs on) |
| Adjust camera framing / lighting / ground grid    | `src/components/viewer/scene.tsx`                        |
| Change how real parts are positioned/oriented    | `src/components/viewer/rack-real.tsx`, measured constants in `src/domain/models.ts` |
| Add per-part click-to-edit (the stretch feature) | Start from `selectedPartId` in `use-build-store.ts` and the `onPointerMissed` plumbing already in `scene.tsx` |
| Swap ad/support links                             | `src/components/layout/ad-panel.tsx`                      |
