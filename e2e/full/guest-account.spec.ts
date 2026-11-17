import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth'

const PASSWORD = 'guest-password-123'

async function continueAsGuest(
  page: Page,
  from: '/sign-in' | '/sign-up',
  nickname: string,
  password = PASSWORD,
) {
  await page.goto(`${from}?method=guest`)
  await page.getByLabel('Nickname').fill(nickname)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Continue as guest' }).click()
}

test.describe('guest access (one step, no email)', () => {
  test('a new nickname gets an account at once, from either page', async ({
    page,
    uniqueNickname,
  }) => {
    for (const from of ['/sign-up', '/sign-in'] as const) {
      const nickname = uniqueNickname()

      await continueAsGuest(page, from, nickname)

      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(page.getByRole('main')).toContainText(nickname)
      // The address behind a nickname is internal; nobody needs to see it.
      await expect(page.getByRole('main')).not.toContainText('@guest.invalid')
      await page.goto('/account')
      await expect(page.getByRole('main')).toContainText(nickname)
      await expect(page.getByRole('main')).not.toContainText('@guest.invalid')
      await page.goto('/dashboard')
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(page).toHaveURL(/\/sign-in/)
    }
  })

  test('a returning guest signs back in with the same nickname and password', async ({
    page,
    uniqueNickname,
  }) => {
    const nickname = uniqueNickname()
    await continueAsGuest(page, '/sign-up', nickname)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)

    await continueAsGuest(page, '/sign-in', nickname)

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test("someone else's nickname with a wrong password is refused", async ({
    page,
    uniqueNickname,
  }) => {
    const nickname = uniqueNickname()
    await continueAsGuest(page, '/sign-up', nickname)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)

    await continueAsGuest(page, '/sign-in', nickname, 'definitely-not-the-password')

    await expect(page.locator('form').getByRole('alert')).toContainText('That nickname is taken')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})
