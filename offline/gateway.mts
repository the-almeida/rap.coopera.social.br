// Stands in for Kong, the gateway of the Supabase CLI's local stack: one origin
// (NEXT_PUBLIC_SUPABASE_URL) in front of Auth and PostgREST. `stack.mts` starts
// it as `node offline/gateway.mts <port> <auth port> <rest port> <templates dir>`.
//
//   /auth/v1/*   → Supabase Auth (GoTrue), prefix stripped
//   /rest/v1/*   → PostgREST, prefix stripped
//   /email/*.html → the email templates GoTrue fetches (supabase/templates)
//   /health      → 200 when the gateway is up
import { readFile } from 'node:fs/promises'
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'

const [port, authPort, restPort, templatesDir] = process.argv.slice(2)
if (!port || !authPort || !restPort || !templatesDir) {
  console.error('usage: gateway.mts <port> <auth port> <rest port> <templates dir>')
  process.exit(1)
}

const upstreams: Record<string, string> = { '/auth/v1': authPort, '/rest/v1': restPort }

function proxy(req: IncomingMessage, res: ServerResponse, upstreamPort: string, path: string) {
  const forwarded = request(
    {
      host: '127.0.0.1',
      port: Number(upstreamPort),
      method: req.method,
      path,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers)
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
