import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const pathname = vi.fn(() => '/dashboard')
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }))
// The client barrel also re-exports server actions, which cannot load here.
// @wc-test-auditor-allow: internal-mock — stands in for the barrel's server actions; the real PROTECT_ACCOUNT_PATH is followed end to end in e2e/full/guest-protect.spec.ts ("greets a new guest … leads to the protect page")
vi.mock('@/modules/auth/client', () => ({ PROTECT_ACCOUNT_PATH: '/account/protect' }))

const { GuestAccountBanner } = await import('./guest-account-banner')

describe('GuestAccountBanner', () => {
  afterEach(cleanup)

  it('shows on protected pages, linking to the protect page', () => {
    pathname.mockReturnValue('/dashboard')
    render(<GuestAccountBanner nickname="bob" providersPhrase="Google or Facebook" />)

    const banner = screen.getByRole('complementary', { name: 'Account protection warning' })
    expect(banner.textContent).toContain("bob, your guest account can't be recovered")
    expect(screen.getByRole('link', { name: 'Protect account' }).getAttribute('href')).toBe(
      '/account/protect',
    )
  })

  it('hides on the protect page, which it would only repeat', () => {
    pathname.mockReturnValue('/account/protect')
    render(<GuestAccountBanner nickname="bob" providersPhrase="Google or Facebook" />)

    expect(screen.queryByRole('complementary', { name: 'Account protection warning' })).toBeNull()
  })

  it('still shows on other account pages', () => {
    pathname.mockReturnValue('/account')
    render(<GuestAccountBanner nickname={null} providersPhrase="Google or Facebook" />)

    expect(screen.getByRole('complementary').textContent).toContain('Your guest account')
  })

  it('offers linking only the providers that are active', () => {
    pathname.mockReturnValue('/dashboard')
    render(<GuestAccountBanner nickname="bob" providersPhrase="Facebook" />)

    expect(screen.getByRole('complementary').textContent).toContain(
      'Add a verified email or link Facebook to protect it.',
    )
  })

  it('offers only the email when no provider is active', () => {
    pathname.mockReturnValue('/dashboard')
    render(<GuestAccountBanner nickname="bob" providersPhrase="" />)

    const text = screen.getByRole('complementary').textContent
    expect(text).toContain('Add a verified email to protect it.')
    expect(text).not.toContain('link')
  })
})
