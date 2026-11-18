import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth'

// A guest account until it is protected: the banner on protected pages, and
// the page that adds a verified email (Google and Facebook linking needs a
// real provider, so it is smoked manually; see docs/dod.md).

const PASSWORD = 'guest-password-123'
const banner = (page: Page) =>
  page.getByRole('complementary', { name: 'Account protection warning' })

async function newGuest(page: Page, nickname: string) {
  await page.goto('/sign-up?method=guest')
  await page.getByLabel('Nickname').fill(nickname)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue as guest' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test.describe('protect banner', () => {
  test('greets a new guest on the dashboard and leads to the protect page', async ({
    page,
    uniqueNickname,
  }) => {
    const nickname = uniqueNickname()
    await newGuest(page, nickname)

    await expect(banner(page)).toContainText(`${nickname}, your guest account can't be recovered`)
    await banner(page).getByRole('link', { name: 'Protect account' }).click()

    await expect(page.getByRole('heading', { name: 'Protect your account' })).toBeVisible()
    await expect(banner(page)).toBeHidden()
  })

  test('stays off the protect page when loaded directly, and shows on other pages', async ({
    page,
    uniqueNickname,
  }) => {
    await newGuest(page, uniqueNickname())

    await page.goto('/account/protect')
    await expect(page.getByRole('heading', { name: 'Protect your account' })).toBeVisible()
    await expect(banner(page)).toBeHidden()

    await page.goto('/account')
    await expect(banner(page)).toBeVisible()
  })

  test('leaves the dashboard within the viewport, footer in view', async ({
    page,
    uniqueNickname,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await newGuest(page, uniqueNickname())
    await expect(banner(page)).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    )
    expect(overflow).toBe(0)
    await expect(page.getByRole('navigation', { name: 'Legal' })).toBeInViewport()
  })

  test('never shows for an account that started with an email', async ({
    page,
    seedUser,
    signInAs,
  }) => {
    await signInAs(page, await seedUser())

    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(banner(page)).toBeHidden()
  })
})

test.describe('adding a verified email to a guest account', () => {
  test('a code emailed to the address protects the account; then the email and the nickname both sign in', async ({
    page,
    uniqueNickname,
    uniqueEmail,
    pollOtp,
  }) => {
    const nickname = uniqueNickname()
    const email = uniqueEmail('guest-protect')
    await newGuest(page, nickname)

    await page.goto('/account/protect')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send verification code' }).click()
    await page.getByLabel('6-digit code').fill(await pollOtp(email))
    await page.getByRole('button', { name: 'Verify and protect account' }).click()

    await expect(page.getByRole('heading', { name: 'Account protected' })).toBeVisible()
    await page.goto('/dashboard')
    await expect(banner(page)).toBeHidden()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await page.goto('/sign-in?method=account')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(email)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await page.goto('/sign-in?method=guest')
    await page.getByLabel('Nickname').fill(nickname)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(email)
    await expect(banner(page)).toBeHidden()
  })

  test('a wrong code is refused and the account stays a guest', async ({
    page,
    uniqueNickname,
    uniqueEmail,
    pollOtp,
  }) => {
    const email = uniqueEmail('guest-wrong-code')
    await newGuest(page, uniqueNickname())

    await page.goto('/account/protect')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send verification code' }).click()
    const code = await pollOtp(email)
    const wrong = code.slice(0, 5) + ((Number(code[5]) + 1) % 10)
    await page.getByLabel('6-digit code').fill(wrong)
    await page.getByRole('button', { name: 'Verify and protect account' }).click()

    await expect(page.locator('form').getByRole('alert')).toContainText('wrong or has expired')
    await page.goto('/dashboard')
    await expect(banner(page)).toBeVisible()
  })
})
