/**
 * Minimal persistence + static server for Lab Rax Planner.
 *
 * Everything is stored in one JSON file inside DATA_DIR (a Docker volume in
 * production), so saved racks survive container rebuilds and are visible from
 * any device that opens this instance.
 *
 *   GET  /api/health   -> { ok, builds }
 *   GET  /api/builds   -> { version, updatedAt, builds: [...] }
 *   PUT  /api/builds   -> replace the list (body: array or { builds })
 *
 * Owner-uploaded shelf models (custom shelves). Reads are public; every write
 * needs the header `x-admin-password` matching ADMIN_PASSWORD, and every write
 * answers 503 when ADMIN_PASSWORD is not set.
 *
 *   GET    /api/shelves                 -> { shelves: [CustomShelf] }
 *   GET    /api/shelves/files/<file>    -> the STL/3MF bytes
 *   POST   /api/admin/check             -> { ok: true } or 401
 *   POST   /api/shelves                 -> add a shelf (JSON, base64 file) -> 201
 *   PATCH  /api/shelves/<id>            -> change label/u/depth/rotation/source
 *   DELETE /api/shelves/<id>            -> remove the entry and its file
 *
 * Shelf data lives in DATA_DIR/shelves.json (catalog) and DATA_DIR/shelves/
 * (files).
 *
 * It also serves the built SPA from ./dist, so one container is enough.
 * No dependencies: node:http + node:fs + node:crypto only.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data')
const DATA_FILE = join(DATA_DIR, 'saved-builds.json')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_BODY = 4 * 1024 * 1024
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const SHELVES_DIR = join(DATA_DIR, 'shelves')
const SHELVES_FILE = join(DATA_DIR, 'shelves.json')
// The shelf upload is base64 inside JSON, so its body limit is larger than the
// builds limit: a 6 MB file is about 8 MB of base64 plus the JSON around it.
const MAX_SHELF_BODY = 9 * 1024 * 1024
const MAX_SHELF_BYTES = 6 * 1024 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.stl': 'model/stl',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
}

/* ------------------------------------------------------------------ store */

async function readStore() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const builds = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.builds)
        ? parsed.builds
        : []
    return { version: 1, updatedAt: parsed?.updatedAt ?? null, builds }
  } catch {
    return { version: 1, updatedAt: null, builds: [] }
  }
}

/** Atomic write: temp file + rename, so a crash never leaves half a JSON. */
async function writeStore(builds) {
  await mkdir(DATA_DIR, { recursive: true })
  const payload = JSON.stringify(
    { version: 1, updatedAt: new Date().toISOString(), builds },
    null,
    2,
  )
  const tmp = `${DATA_FILE}.tmp`
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, DATA_FILE)
}

function sanitizeBuilds(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.builds) ? value.builds : null
  if (!list) return null
  return list.filter(
    (b) =>
      b &&
      typeof b === 'object' &&
      typeof b.id === 'string' &&
      b.id.length <= 128 &&
      typeof b.name === 'string' &&
      b.name.length <= 256 &&
      b.state &&
      typeof b.state === 'object',
  )
}

/* ------------------------------------------------------------------- http */

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/* ----------------------------------------------------- owner shelf uploads */

const ROTATIONS = [0, 90, 180, 270]
const SHELF_FILE_RE = /^custom-[0-9a-f]{8}\.(stl|3mf)$/
const SHELF_ID_RE = /^custom-[0-9a-f]{8}$/
const SHELF_MIME = { stl: 'model/stl', '3mf': 'model/3mf' }

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** One checker per editable field; each returns the cleaned value or null. */
const SHELF_FIELDS = {
  label: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 60 ? v.trim() : null),
  u: (v) => (Number.isInteger(v) && v >= 1 && v <= 4 ? v : null),
  depthMm: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000 ? v : null),
  sizeMm: (v) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 2000)
      ? v
      : null,
  rotX: (v) => (ROTATIONS.includes(v) ? v : null),
  rotY: (v) => (ROTATIONS.includes(v) ? v : null),
  rotZ: (v) => (ROTATIONS.includes(v) ? v : null),
  sourceUrl: (v) => (v === '' || isHttpUrl(v) ? v : null),
}

const SHELF_EDITABLE = ['label', 'u', 'depthMm', 'rotX', 'rotY', 'rotZ', 'sourceUrl']

/** Original upload name: a bare file name ending .stl or .3mf. */
function checkOriginalName(v) {
  if (typeof v !== 'string') return null
  const name = v.trim()
  if (name.length < 1 || name.length > 120 || basename(name) !== name) return null
  const ext = extname(name).toLowerCase().slice(1)
  return ext === 'stl' || ext === '3mf' ? name : null
}

/** Reads a JSON body up to `limit` bytes. Unlike readBody, it does not destroy
 * the socket when the limit is hit, so the caller can still answer 413. */
function readLimitedBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readShelfCatalog() {
  try {
    const parsed = JSON.parse(await readFile(SHELVES_FILE, 'utf8'))
    return { version: 1, shelves: Array.isArray(parsed?.shelves) ? parsed.shelves : [] }
  } catch {
    return { version: 1, shelves: [] }
  }
}

/** Atomic write, like the builds store: temp file + rename. */
async function writeShelfCatalog(shelves) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${SHELVES_FILE}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, shelves }, null, 2), 'utf8')
  await rename(tmp, SHELVES_FILE)
}

async function writeShelfFile(file, bytes) {
  await mkdir(SHELVES_DIR, { recursive: true })
  const path = join(SHELVES_DIR, file)
  await writeFile(`${path}.tmp`, bytes)
  await rename(`${path}.tmp`, path)
}

// Catalog read-modify-write runs one at a time, so two uploads cannot both
// read the old list and drop each other's entry.
let shelfQueue = Promise.resolve()
function withShelfLock(fn) {
  const run = shelfQueue.then(fn, fn)
  shelfQueue = run.catch(() => {})
  return run
}

/** 'disabled' (no ADMIN_PASSWORD), 'denied', or 'ok'. Hashing both sides to
 * SHA-256 gives timingSafeEqual two buffers of the same length. */
function adminState(req) {
  if (!ADMIN_PASSWORD) return 'disabled'
  const given = req.headers['x-admin-password']
  const a = createHash('sha256').update(typeof given === 'string' ? given : '').digest()
  const b = createHash('sha256').update(ADMIN_PASSWORD).digest()
  return typeof given === 'string' && timingSafeEqual(a, b) ? 'ok' : 'denied'
}

/** True when the request may write. Otherwise it has already sent the reply. */
function requireAdmin(req, res) {
  const state = adminState(req)
  if (state === 'disabled') {
    sendJson(res, 503, { error: 'admin disabled' })
    return false
  }
  if (state === 'denied') {
    sendJson(res, 401, { error: 'unauthorized' })
    return false
  }
  return true
}

function parseJsonObject(raw) {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

async function handleShelves(req, res, pathname) {
  if (pathname === '/api/shelves' && req.method === 'GET') {
    sendJson(res, 200, { shelves: (await readShelfCatalog()).shelves })
    return true
  }

  if (pathname.startsWith('/api/shelves/files/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const file = pathname.slice('/api/shelves/files/'.length)
    if (!SHELF_FILE_RE.test(file)) {
      sendJson(res, 404, { error: 'not found' })
      return true
    }
    try {
      const body = await readFile(join(SHELVES_DIR, file))
      res.writeHead(200, {
        'Content-Type': SHELF_MIME[extname(file).slice(1)],
        'Content-Length': body.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      sendJson(res, 404, { error: 'not found' })
    }
    return true
  }

  if (pathname === '/api/admin/check' && req.method === 'POST') {
    if (requireAdmin(req, res)) sendJson(res, 200, { ok: true })
    return true
  }

  if (pathname === '/api/shelves' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return true
    let raw
    try {
      raw = await readLimitedBody(req, MAX_SHELF_BODY)
    } catch (err) {
      sendJson(res, err.status === 413 ? 413 : 400, { error: err.status === 413 ? 'body too large' : 'bad body' })
      return true
    }
    const body = parseJsonObject(raw)
    if (!body) {
      sendJson(res, 400, { error: 'expected a JSON object' })
      return true
    }

    const fields = {}
    for (const key of ['label', 'u', 'depthMm', 'sizeMm', 'rotX', 'rotY', 'rotZ']) {
      fields[key] = SHELF_FIELDS[key](body[key])
      if (fields[key] === null) {
        sendJson(res, 400, { error: `invalid ${key}` })
        return true
      }
    }
    const sourceUrl = body.sourceUrl === undefined ? '' : SHELF_FIELDS.sourceUrl(body.sourceUrl)
    if (sourceUrl === null) {
      sendJson(res, 400, { error: 'invalid sourceUrl' })
      return true
    }
    const originalName = checkOriginalName(body.originalName)
    if (!originalName) {
      sendJson(res, 400, { error: 'originalName must be a .stl or .3mf file name' })
      return true
    }
    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
    if (
      dataBase64.length === 0 ||
      dataBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) ||
      (dataBase64.length / 4) * 3 > MAX_SHELF_BYTES + 2
    ) {
      sendJson(res, 400, { error: 'dataBase64 is not valid base64' })
      return true
    }
    const bytes = Buffer.from(dataBase64, 'base64')
    if (bytes.length === 0 || bytes.length > MAX_SHELF_BYTES) {
      sendJson(res, 400, { error: 'file must be 1 byte to 6 MB' })
      return true
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const id = `custom-${sha256.slice(0, 8)}`
    const file = `${id}.${extname(originalName).toLowerCase().slice(1)}`
    return withShelfLock(async () => {
      const catalog = await readShelfCatalog()
      const existing = catalog.shelves.find((s) => s.sha256 === sha256)
      if (existing) {
        sendJson(res, 409, { error: 'duplicate', shelf: existing })
        return true
      }
      if (catalog.shelves.some((s) => s.id === id)) {
        sendJson(res, 409, { error: 'id collision, rename the file and try again' })
        return true
      }
      await writeShelfFile(file, bytes)
      const entry = {
        id,
        label: fields.label,
        u: fields.u,
        depthMm: fields.depthMm,
        sizeMm: fields.sizeMm,
        rotX: fields.rotX,
        rotY: fields.rotY,
        rotZ: fields.rotZ,
        file,
        originalName,
        sha256,
        sourceUrl,
        addedAt: new Date().toISOString(),
      }
      await writeShelfCatalog([...catalog.shelves, entry])
      sendJson(res, 201, entry)
      return true
    })
  }

  const match = /^\/api\/shelves\/([^/]+)$/.exec(pathname)
  if (match && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!requireAdmin(req, res)) return true
    const id = decodeURIComponent(match[1])
    if (!SHELF_ID_RE.test(id)) {
      sendJson(res, 404, { error: 'not found' })
      return true
    }

    if (req.method === 'PATCH') {
      const body = parseJsonObject(await readBody(req))
      if (!body) {
        sendJson(res, 400, { error: 'expected a JSON object' })
        return true
      }
      const patch = {}
      for (const key of SHELF_EDITABLE) {
        if (!(key in body)) continue
        const value = SHELF_FIELDS[key](body[key])
        if (value === null) {
          sendJson(res, 400, { error: `invalid ${key}` })
          return true
        }
        patch[key] = value
      }
      if (Object.keys(patch).length === 0) {
        sendJson(res, 400, { error: 'nothing to update' })
        return true
      }
      return withShelfLock(async () => {
        const catalog = await readShelfCatalog()
        const index = catalog.shelves.findIndex((s) => s.id === id)
        if (index < 0) {
          sendJson(res, 404, { error: 'not found' })
          return true
        }
        const next = { ...catalog.shelves[index], ...patch }
        catalog.shelves[index] = next
        await writeShelfCatalog(catalog.shelves)
        sendJson(res, 200, next)
        return true
      })
    }

    return withShelfLock(async () => {
      const catalog = await readShelfCatalog()
      const index = catalog.shelves.findIndex((s) => s.id === id)
      if (index < 0) {
        sendJson(res, 404, { error: 'not found' })
        return true
      }
      const [removed] = catalog.shelves.splice(index, 1)
      await writeShelfCatalog(catalog.shelves)
      await rm(join(SHELVES_DIR, removed.file), { force: true })
      sendJson(res, 200, { ok: true })
      return true
    })
  }

  return false
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function serveStatic(req, res) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end('bad request')
    return
  }
  if (pathname === '/') pathname = '/index.html'

  const file = resolve(DIST, `.${pathname}`)
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(file)
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
    const immutable = pathname.startsWith('/assets/')
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    // SPA fallback (client-side routes / share URLs)
    try {
      const html = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Content-Length': html.length,
        'Cache-Control': 'no-cache',
      })
      res.end(html)
    } catch {
      res.writeHead(404).end('Not found. Run `npm run build` first.')
    }
  }
}

const server = createServer(async (req, res) => {
  // The app is same-origin in production; permissive CORS keeps local dev easy.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const pathname = new URL(req.url, 'http://localhost').pathname

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      const store = await readStore()
      sendJson(res, 200, { ok: true, builds: store.builds.length })
      return
    }

    if (pathname === '/api/builds' && req.method === 'GET') {
      sendJson(res, 200, await readStore())
      return
    }

    if (pathname === '/api/builds' && req.method === 'PUT') {
      const raw = await readBody(req)
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        sendJson(res, 400, { error: 'invalid JSON' })
        return
      }
      const builds = sanitizeBuilds(parsed)
      if (!builds) {
        sendJson(res, 400, { error: 'expected an array of builds' })
        return
      }
      // Newest first, so every client sees the same order.
      builds.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
      await writeStore(builds)
      sendJson(res, 200, { ok: true, count: builds.length })
      return
    }

    if (pathname.startsWith('/api/shelves') || pathname === '/api/admin/check') {
      if (await handleShelves(req, res, pathname)) return
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'unknown endpoint' })
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res)
      return
    }

    res.writeHead(405).end('method not allowed')
  } catch (err) {
    console.error('[api]', err)
    sendJson(res, 500, { error: 'internal error' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[lab-rax] serving on http://${HOST}:${PORT}`)
  console.log(`[lab-rax] data file: ${DATA_FILE}`)
})
