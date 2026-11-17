import { describe, expect, it, vi } from 'vitest'

import { verifyTurnstileToken } from './turnstile'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const failure = (code: string) => ({ ok: false, error: expect.objectContaining({ code }) })

describe('verifyTurnstileToken', () => {
  it('lets everything through without asking Cloudflare when no secret is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await verifyTurnstileToken(
      { token: undefined, ip: '1.2.3.4', secret: undefined },
      fetchImpl,
    )

    expect(result).toEqual({ ok: true, value: undefined })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks for a token when a secret is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await verifyTurnstileToken(
      { token: undefined, ip: '1.2.3.4', secret: 'secret' },
      fetchImpl,
    )

    expect(result).toEqual(failure('VALIDATION_ERROR'))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the secret, the token and the client IP to Cloudflare and accepts its yes', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ success: true }))

    const result = await verifyTurnstileToken(
      { token: 'tok', ip: '1.2.3.4', secret: 'secret' },
      fetchImpl,
    )

    expect(result).toEqual({ ok: true, value: undefined })
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(SITEVERIFY_URL)
    expect(init?.method).toBe('POST')
    const sent = init?.body as URLSearchParams
    expect(Object.fromEntries(sent)).toEqual({
      secret: 'secret',
      response: 'tok',
      remoteip: '1.2.3.4',
    })
  })

  it('refuses a token Cloudflare rejects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ success: false, 'error-codes': ['invalid-input-response'] }),
    )

    const result = await verifyTurnstileToken(
      { token: 'bad', ip: '1.2.3.4', secret: 'secret' },
      fetchImpl,
    )

    expect(result).toEqual(failure('VALIDATION_ERROR'))
  })

  it('refuses when Cloudflare cannot be reached: an outage must not turn the CAPTCHA off', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })

    const result = await verifyTurnstileToken(
      { token: 'tok', ip: '1.2.3.4', secret: 'secret' },
      fetchImpl,
    )

    expect(result).toEqual(failure('EXTERNAL_SERVICE_ERROR'))
  })

  it('refuses when Cloudflare answers with an error status', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503))

    const result = await verifyTurnstileToken(
      { token: 'tok', ip: '1.2.3.4', secret: 'secret' },
      fetchImpl,
    )

    expect(result).toEqual(failure('EXTERNAL_SERVICE_ERROR'))
  })
})
