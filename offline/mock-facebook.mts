// A local stand-in for Facebook Login, served by the gateway under
// MOCK_FACEBOOK.basePath. Supabase Auth's real Facebook provider talks to it
// (GOTRUE_EXTERNAL_FACEBOOK_URL), so sign-in, PKCE, identities and linking all
// run Auth's own code; only Facebook's three endpoints are stood in for:
//
//   GET  /dialog/oauth        the consent page: pick the email and name Facebook returns
//   POST /oauth/access_token  code → access token (checks the client credentials)
//   GET  /me                  the profile (checks appsecret_proof, like the Graph API)
//
// State lives in memory: restarting the gateway only drops sign-ins in progress.
import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { API_URL, MOCK_FACEBOOK } from './services.mts'

type Profile = { id: string; email: string; name: string }

const codes = new Map<string, Profile>()
const tokens = new Map<string, Profile>()
// Facebook only redirects to registered URIs; the only one here is Auth's callback.
const CALLBACK = `${API_URL}/auth/v1/callback`

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, 'application/json', JSON.stringify(body))

function graphError(res: ServerResponse, status: number, message: string) {
  json(res, status, { error: { message, type: 'OAuthException', code: 190 } })
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { location, 'cache-control': 'no-store' })
  res.end()
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

function consentPage(state: string): string {
  const field = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Facebook (offline stand-in)</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 26rem; margin: 3rem auto; padding: 0 1rem; color: #1c1e21; background: #f0f2f5; }
  main { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 2px rgb(0 0 0 / 0.2); }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { color: #606770; font-size: 0.9rem; margin: 0 0 1rem; }
  label { display: block; font-weight: 600; margin: 1rem 0 0.25rem; }
  input { box-sizing: border-box; width: 100%; padding: 0.6rem; border: 1px solid #ccd0d5; border-radius: 6px; font: inherit; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
  button { flex: 1; padding: 0.6rem; border: 0; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; }
  .allow { background: #1877f2; color: #fff; }
  .deny { background: #e4e6eb; color: #1c1e21; }
</style></head>
<body><main>
  <h1>Continue with Facebook</h1>
  <p>Offline stand-in for Facebook Login. Choose what Facebook would return; signing in again with the same email reaches the same Facebook account.</p>
  <form method="post">
    ${field('state', state)}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required value="mc.offline@example.com">
    <label for="name">Name</label>
    <input id="name" name="name" required value="MC Offline">
    <div class="actions">
      <button class="deny" name="action" value="deny" type="submit">Cancel</button>
      <button class="allow" name="action" value="allow" type="submit">Continue</button>
    </div>
  </form>
</main></body></html>`
}

async function dialog(req: IncomingMessage, res: ServerResponse, url: URL) {
  const query = url.searchParams
  if (query.get('client_id') !== MOCK_FACEBOOK.clientId)
    return graphError(res, 400, 'Invalid app ID')
  if (query.get('redirect_uri') !== CALLBACK)
    return graphError(res, 400, 'URL blocked: redirect_uri is not registered')
  const state = query.get('state') ?? ''

  if (req.method === 'GET') return send(res, 200, 'text/html; charset=utf-8', consentPage(state))

  const form = await readForm(req)
  const back = new URL(CALLBACK)
  back.searchParams.set('state', form.get('state') ?? state)
  if (form.get('action') !== 'allow') {
    back.searchParams.set('error', 'access_denied')
    back.searchParams.set('error_reason', 'user_denied')
    back.searchParams.set('error_description', 'Permissions error')
    return redirect(res, back.toString())
  }

  const email = (form.get('email') ?? '').trim().toLowerCase()
  const name = (form.get('name') ?? '').trim()
  if (!email.includes('@') || !name)
    return send(res, 400, 'text/html; charset=utf-8', consentPage(state))
  // Facebook's user id is stable per account: derive it from the email.
  const id = BigInt(`0x${createHash('sha256').update(email).digest('hex').slice(0, 13)}`).toString()
  const code = randomBytes(24).toString('base64url')
  codes.set(code, { id, email, name })
  back.searchParams.set('code', code)
  redirect(res, back.toString())
}

async function accessToken(req: IncomingMessage, res: ServerResponse) {
  const form = await readForm(req)
  // oauth2 clients send the credentials either as Basic auth or in the body.
  const basic = req.headers.authorization?.match(/^Basic (.+)$/)?.[1]
  const [basicId, basicSecret] = basic
    ? Buffer.from(basic, 'base64').toString('utf8').split(':').map(decodeURIComponent)
    : []
  const clientId = basicId ?? form.get('client_id')
  const secret = basicSecret ?? form.get('client_secret')
  if (clientId !== MOCK_FACEBOOK.clientId || secret !== MOCK_FACEBOOK.secret) {
    return graphError(res, 401, 'Error validating client secret')
  }
  if (form.get('redirect_uri') !== CALLBACK)
    return graphError(res, 400, 'redirect_uri does not match')

  const code = form.get('code') ?? ''
  const profile = codes.get(code)
  codes.delete(code)
  if (!profile)
    return graphError(res, 400, 'This authorization code has expired or was already used')

  const token = randomBytes(32).toString('base64url')
  tokens.set(token, profile)
  json(res, 200, { access_token: token, token_type: 'bearer', expires_in: 5183944 })
}

function me(req: IncomingMessage, res: ServerResponse, url: URL) {
  const token =
    req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ??
    url.searchParams.get('access_token') ??
    ''
  const profile = tokens.get(token)
  if (!profile) return graphError(res, 401, 'Invalid OAuth access token')
  const proof = createHmac('sha256', MOCK_FACEBOOK.secret).update(token).digest('hex')
  if (url.searchParams.get('appsecret_proof') !== proof)
    return graphError(res, 400, 'Invalid appsecret_proof')

  const [firstName, ...rest] = profile.name.split(/\s+/)
  json(res, 200, {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    first_name: firstName,
    last_name: rest.join(' '),
    picture: { data: { url: '' } },
  })
}

/** Handles a request under MOCK_FACEBOOK.basePath; `path` is what follows it. */
export async function handleMockFacebook(req: IncomingMessage, res: ServerResponse, path: string) {
  const url = new URL(path, API_URL)
  if (url.pathname === '/dialog/oauth' && (req.method === 'GET' || req.method === 'POST')) {
    return dialog(req, res, url)
  }
  if (url.pathname === '/oauth/access_token' && req.method === 'POST') return accessToken(req, res)
  if (url.pathname === '/me' && req.method === 'GET') return me(req, res, url)
  json(res, 404, { error: { message: 'Unknown path components', type: 'OAuthException' } })
}
