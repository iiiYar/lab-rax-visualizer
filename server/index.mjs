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
 * It also serves the built SPA from ./dist, so one container is enough.
 * No dependencies: node:http + node:fs only.
 */
import { createServer } from 'node:http'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data')
const DATA_FILE = join(DATA_DIR, 'saved-builds.json')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_BODY = 4 * 1024 * 1024

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
