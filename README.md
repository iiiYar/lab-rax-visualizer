# Lab Rax Planner

A browser-based visualizer and parts-list planner for [Lab Rax](https://the-diy-life.com/introducing-lab-rax-a-3d-printable-modular-10-rack-system/),
a 3D-printable modular 10" rack system. Users pick a rack height (4U–12U),
color each part, lay out shelves, fit devices (fans etc.) into the shelves that
take them, and see a real-time 3D model — built from
the actual Lab Rax STL/3MF part files — update in the viewport. The build
can be exported as a checkable parts list (CSV or XLSX) and shared via URL.

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
| Spreadsheet export  | `xlsx` (SheetJS)                                      |

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
      header.tsx         Branding, live size/part-count, Share/CSV/XLSX buttons
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
    export-csv.ts      Plain CSV with a "☐" checkbox glyph column
    export-xlsx.ts     SheetJS workbook, same columns
    download.ts        Shared Blob-download helper

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
- **XLSX checkboxes are not interactive.** The free/community build of
  SheetJS (`xlsx`) can't embed real form-control checkboxes, so both the CSV
  and XLSX exports use a `☐` text glyph in the "Done" column. If real
  tickable checkboxes are required, swap `export-xlsx.ts` to use `exceljs`
  instead.
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
npm run dev       # start the Vite dev server (default: http://localhost:5173)
```

Other scripts:

```bash
npm run typecheck # tsc --noEmit — type-check without emitting files
npm run build     # tsc -b && vite build — production build into dist/
npm run preview   # serve the dist/ build locally, for a pre-deploy sanity check
```

There is no `.env` / environment configuration required — the app has no
backend calls of any kind.

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
| Change export file format/columns                | `src/export/export-csv.ts`, `src/export/export-xlsx.ts`    |
| Adjust camera framing / lighting / ground grid    | `src/components/viewer/scene.tsx`                        |
| Change how real parts are positioned/oriented    | `src/components/viewer/rack-real.tsx`, measured constants in `src/domain/models.ts` |
| Add per-part click-to-edit (the stretch feature) | Start from `selectedPartId` in `use-build-store.ts` and the `onPointerMissed` plumbing already in `scene.tsx` |
| Swap ad/support links                             | `src/components/layout/ad-panel.tsx`                      |
