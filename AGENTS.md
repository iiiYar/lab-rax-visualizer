# AGENTS.md

Guidance for agents and maintainers working in this repo.

## What the app is

Lab Rax is a 3D-printed mini-rack planner. The user picks the rack height (U),
splits the posts into printable segments, adds shelves and devices, and exports
the print set as an STL ZIP, a parts CSV, or an XLSX parts list. The 3D view
shows the rack built from the designer's real meshes.

## Commands

- `npm run dev` - Vite dev server.
- `npm test` - vitest unit tests.
- `npm run verify` - `tsc --noEmit`, then `vitest run`, then `vite build`.
  Run this before every commit. CI runs the same script.

## Layout

- `src/domain/` - pure rules and measurements (no React, no three.js).
  Split model in `segments.ts`. Measured numbers in `models.ts`.
  Print files and joiner choice in `print-files.ts`. Source and hash
  records in `sources.ts`.
- `src/components/viewer/` - three.js placement. `rack-real.tsx` positions
  every real part. `parts/real-mesh.tsx` is the single mesh wrapper.
- `src/export/` - ZIP (STL bundle), CSV, and XLSX writers.
- `public/models-3d/` - designer files, kept byte-for-byte. Their SHA-256
  hashes are in `REFERENCE_HASHES` in `src/domain/sources.ts`. Do not
  re-save, re-export, or re-orient these files.
- `tools/` - one-off model generators and the live smoke check
  (`tools/smoke.py`).

## Rules

- Every placement number must come from a measured mesh. Put the source
  (file, axis, measured range) in a comment next to the number.
- `*.view.stl` files are viewer-only. They are drawn in the 3D view and are
  never exported. Export uses the real file (for example `.3mf`).
- `RACK_DEPTH_MM = 185` is fixed by the geometry. `geometry.test.ts` pins it.
  Do not change it to make a picture look right.
- Joiner models:
  - Short: `post-joiner.stl`, a per-post plate inside the joint socket.
    4 per joint (one per post per joint).
  - Long: `joiner-brass-insert-PETG.3mf`, a front-post-to-back-post side
    brace seated in the sockets. 2 per joint, 2 per print plate.
- Do not push, deploy, or change the host from a feature commit. Deploy is a
  separate, owner-approved step.

## Deploy

Runs on host `docker0`:

```
cd /docker/lab-rax-visualizer/repo && git pull --ff-only && cd .. && docker compose up -d --build app
```

- Site: http://192.168.1.193:5173
- Health: `GET /api/health` returns `{ ok, builds }`.
- Live check after deploy: `python3 tools/smoke.py`
  (optional base URL argument; exits 1 on any failed check).

## Shelves: rear side and owner uploads
- Every shelf has `side` ('front' default, 'back'). Back shelves are the same mesh turned 180° about Y. Two shelves conflict when their rows overlap and they are on the same side, or their depths sum past `SHELF_USABLE_DEPTH_MM` (245.85) — see `shelvesConflict` in src/domain/shelves.ts.
- Owner-uploaded shelves: ids `custom-<8 hex of sha256>`, catalog in `DATA_DIR/shelves.json`, files in `DATA_DIR/shelves/` (docker0: `/docker/lab-rax-visualizer/data/`). Writes need header `x-admin-password` = `ADMIN_PASSWORD` (docker0: `/docker/lab-rax-visualizer/.env`, 0600, passed through docker-compose). Empty password = uploads disabled (503).
- API: `GET /api/shelves`, `GET /api/shelves/files/<file>`, `POST /api/admin/check`, `POST /api/shelves`, `PATCH|DELETE /api/shelves/<id>`.
- The ZIP worker receives the catalog in its message; uploads go into `shelves/` and are hash-checked against the catalog sha256.
