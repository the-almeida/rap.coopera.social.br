import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/shared/observability/logger'

import { selectTransport } from './transports'

const message = { to: 'alice@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' }
const okResponse = () => new Response('{}', { status: 200 })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectTransport', () => {
  it('sends through Resend when an API key is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse())

    const result = await selectTransport(
      {
        resendApiKey: 're_123',
        from: 'App <no-reply@example.com>',
        mailpitUrl: 'http://127.0.0.1:54324',
      },
      fetchImpl,
    )(message)

    expect(result).toEqual({ ok: true, value: undefined })
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://api.resend.com/emails')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer re_123')
    expect(JSON.parse(init?.body as string)).toEqual({
      from: 'App <no-reply@example.com>',
      to: ['alice@example.com'],
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
  })

  it('refuses Resend without a sender, which Resend needs verified', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await selectTransport({ resendApiKey: 're_123' }, fetchImpl)(message)

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EXTERNAL_SERVICE_ERROR' }),
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends to Mailpit, the local Supabase inbox, in development and CI', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse())

    const result = await selectTransport(
      { mailpitUrl: 'http://127.0.0.1:54324' },
      fetchImpl,
    )(message)

    expect(result).toEqual({ ok: true, value: undefined })
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toBe('http://127.0.0.1:54324/api/v1/send')
    expect(JSON.parse(init?.body as string)).toMatchObject({
      To: [{ Email: 'alice@example.com' }],
      Subject: 'Hi',
      HTML: '<p>Hi</p>',
      Text: 'Hi',
    })
  })

  it('says so when no provider is configured, instead of dropping the email', async () => {
    const result = await selectTransport({}, vi.fn<typeof fetch>())(message)

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EXTERNAL_SERVICE_ERROR', service: 'email' }),
    })
  })

  it('answers a provider failure with a fixed message, keeping its text out', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('secret detail', { status: 500 }),
    )

    const result = await selectTransport(
      { resendApiKey: 're_1', from: 'a@b.co' },
      fetchImpl,
    )(message)

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EXTERNAL_SERVICE_ERROR' }),
    })
    expect(result.ok ? '' : result.error.message).not.toContain('secret detail')
  })

  it('reports a failed send, without the address it was for', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('down', { status: 503 }))

    await selectTransport({ resendApiKey: 're_1', from: 'a@b.co' }, fetchImpl)(message)

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'email', service: 'resend', status: 503 }),
      expect.any(String),
    )
    expect(JSON.stringify(logged.mock.calls)).not.toContain(message.to)
  })
})
