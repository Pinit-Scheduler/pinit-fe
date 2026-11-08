import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { CANONICAL } from './constants.mjs'
import { QaFailure, check } from './safe.mjs'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' }
export async function candidateTransport(context, directory) {
  const root = await realpath(directory)
  const manifest = new Map()
  let blocked = 0
  // This route never matches mono.pinit.go-gradually.me. API calls are native HTTPS.
  await context.route(CANONICAL + '/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const document = request.isNavigationRequest() && request.resourceType() === 'document'
    if (!['GET', 'HEAD'].includes(request.method())) {
      blocked++
      await route.abort('blockedbyclient')
      return
    }
    let path
    try { path = document ? '/index.html' : decodeURIComponent(url.pathname) } catch {
      blocked++; await route.abort('blockedbyclient'); return
    }
    const file = resolve(root, '.' + path)
    if (!file.startsWith(root + sep)) {
      blocked++; await route.abort('blockedbyclient'); return
    }
    try {
      check((await stat(file)).isFile(), 'STATIC_FILE_MISSING')
      const actual = await realpath(file)
      check(actual.startsWith(root + sep), 'STATIC_PATH_ESCAPE')
      const bytes = await readFile(actual)
      manifest.set(path, { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      await route.fulfill({ status: 200, contentType: MIME[extname(file)] ?? 'application/octet-stream', body: request.method() === 'HEAD' ? Buffer.alloc(0) : bytes })
    } catch {
      blocked++
      await route.abort('blockedbyclient')
    }
  })
  return {
    manifest: () => [...manifest.values()],
    assertValid() { if (blocked) throw new QaFailure('UNEXPECTED_CANONICAL_REQUEST') },
  }
}
