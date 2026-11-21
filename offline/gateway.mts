// Stands in for Kong, the gateway of the Supabase CLI's local stack: one origin
// (NEXT_PUBLIC_SUPABASE_URL) in front of Auth and PostgREST. `stack.mts` starts
// it as `node offline/gateway.mts <port> <auth port> <rest port> <templates dir>`.
//
//   /auth/v1/*   → Supabase Auth (GoTrue), prefix stripped
//   /rest/v1/*   → PostgREST, prefix stripped
//   /email/*.html → the email templates GoTrue fetches (supabase/templates)
//   /mock-oauth/facebook/* → the Facebook Login stand-in (mock-facebook.mts)
//   /health      → 200 when the gateway is up
import { readFile } from 'node:fs/promises'
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'

import { handleMockFacebook } from './mock-facebook.mts'
import { MOCK_FACEBOOK } from './services.mts'

const [port, authPort, restPort, templatesDir] = process.argv.slice(2)
if (!port || !authPort || !restPort || !templatesDir) {
  console.error('usage: gateway.mts <port> <auth port> <rest port> <templates dir>')
  process.exit(1)
}

const upstreams: Record<string, string> = { '/auth/v1': authPort, '/rest/v1': restPort }

// CORS the way Kong's cors plugin does it with Supabase's defaults (any origin,
// no credentials). The browser calls Auth directly from the app's origin, for
// example `linkIdentity`, so without these headers it blocks the request.
const CORS_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS'

function isPreflight(req: IncomingMessage) {
  return req.method === 'OPTIONS' && req.headers['access-control-request-method'] !== undefined
}

function preflight(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': CORS_METHODS,
    'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '',
    'access-control-max-age': '3600',
    'content-length': '0',
  })
  res.end()
}

/** The upstream's headers with the gateway's CORS answer in place of the upstream's own. */
function withCors(headers: IncomingMessage['headers']) {
  const kept = Object.fromEntries(
    Object.entries(headers).filter(([name]) => !name.startsWith('access-control-')),
  )
  return { ...kept, 'access-control-allow-origin': '*' }
}

function proxy(req: IncomingMessage, res: ServerResponse, upstreamPort: string, path: string) {
  if (isPreflight(req)) return preflight(req, res)
  const forwarded = request(
    {
      host: '127.0.0.1',
      port: Number(upstreamPort),
      method: req.method,
      path,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, withCors(upstream.headers))
      upstream.pipe(res)
    },
  )
  forwarded.on('error', (error) => {
    if (res.headersSent) return res.destroy(error)
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: `upstream on port ${upstreamPort} unreachable` }))
  })
  req.pipe(forwarded)
}

async function serveTemplate(res: ServerResponse, name: string) {
  // Only plain file names: no path separators, so nothing outside the folder.
  if (!/^[\w-]+\.html$/.test(name)) return notFound(res)
  try {
    const body = await readFile(join(templatesDir!, name))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  } catch {
    notFound(res)
  }
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ message: 'no route matched' }))
}

createServer((req, res) => {
  const url = req.url ?? '/'
  if (url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end('ok')
  }
  if (url.startsWith('/email/')) return void serveTemplate(res, url.slice('/email/'.length))
  // Unused unless Auth points its Facebook provider here (`start --mock-oauth`).
  if (url.startsWith(`${MOCK_FACEBOOK.basePath}/`)) {
    return void handleMockFacebook(req, res, url.slice(MOCK_FACEBOOK.basePath.length)).catch(
      (error: unknown) => {
        console.error('mock facebook failed', error)
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'mock facebook failed' }))
      },
    )
  }

  for (const [prefix, upstreamPort] of Object.entries(upstreams)) {
    if (url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)) {
      const rest = url.slice(prefix.length)
      return proxy(req, res, upstreamPort, rest.startsWith('/') ? rest : `/${rest}`)
    }
  }
  notFound(res)
}).listen(Number(port), '127.0.0.1', () => {
  console.log(`gateway listening on http://127.0.0.1:${port}`)
})
