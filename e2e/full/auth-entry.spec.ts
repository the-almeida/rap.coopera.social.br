import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth'

// The auth pages start with a choice: a secure account first, a guest account
// (nickname) second. Then only that path shows. Each test starts with a fresh
// browser context, so nothing is remembered at the start.

const chooser = (page: Page) => page.getByRole('navigation', { name: 'Choose how to continue' })
const GUEST = 'Quick visitant access with Nickname'

test.describe('auth entry', () => {
  for (const [path, accountLabel] of [
    ['/sign-in', 'Sign in to your secure/persistent account'],
    ['/sign-up', 'Create secure/persistent account'],
  ] as const) {
    test(`${path} offers the secure account first, then guest access, and no form yet`, async ({
      page,
    }) => {
      await page.goto(path)

      const options = chooser(page).getByRole('link')
      await expect(options).toHaveCount(2)
      await expect(options.nth(0)).toContainText(accountLabel)
      await expect(options.nth(1)).toContainText(GUEST)
      await expect(page.getByLabel('Email')).toBeHidden()
      await expect(page.getByLabel('Nickname')).toBeHidden()
    })
  }

  test('the account step shows the email form only, and leads back to the choice', async ({
    page,
  }) => {
    await page.goto('/sign-in')
    await chooser(page)
      .getByRole('link', { name: /secure\/persistent account/ })
      .click()

    await expect(page).toHaveURL(/\/sign-in\?method=account/)
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Nickname')).toBeHidden()

    await page.getByRole('button', { name: '← Choose another way' }).click()
    await expect(chooser(page)).toBeVisible()
  })

  test('the guest step is the same on both pages: heading, warning and form', async ({ page }) => {
    for (const path of ['/sign-in', '/sign-up']) {
      await page.goto(path)
      await chooser(page)
        .getByRole('link', { name: new RegExp(GUEST) })
        .click()

      await expect(page.getByRole('heading', { name: GUEST })).toBeVisible()
      await expect(page.getByRole('note')).toContainText('cannot be recovered')
      await expect(page.getByLabel('Nickname')).toBeVisible()
      await expect(page.getByLabel('Email')).toBeHidden()

      await page.getByRole('button', { name: '← Choose another way' }).click()
      await expect(chooser(page)).toBeVisible()
    }
  })

  test("the browser's back button returns from a step to the choice", async ({ page }) => {
    await page.goto('/sign-up')
    await chooser(page)
      .getByRole('link', { name: /secure\/persistent account/ })
      .click()
    await expect(page.getByLabel('Email')).toBeVisible()

    await page.goBack()

    await expect(page).toHaveURL(/\/sign-up$/)
    await expect(chooser(page)).toBeVisible()
  })
})

test.describe('remembered choice', () => {
  test('opens the last choice directly on both pages, until "choose another way" forgets it', async ({
    page,
  }) => {
    await page.goto('/sign-in')
    await chooser(page)
      .getByRole('link', { name: new RegExp(GUEST) })
      .click()
    await expect(page.getByLabel('Nickname')).toBeVisible()

    await page.goto('/sign-in')
    await expect(page.getByLabel('Nickname')).toBeVisible()
    await page.goto('/sign-up')
    await expect(page.getByLabel('Nickname')).toBeVisible()

    await page.getByRole('button', { name: '← Choose another way' }).click()
    await expect(chooser(page)).toBeVisible()
    await page.goto('/sign-in')
    await expect(chooser(page)).toBeVisible()
  })

  test('stores only the choice, nothing about the person', async ({
    page,
    context,
    uniqueNickname,
  }) => {
    const nickname = uniqueNickname()
    await page.goto('/sign-in?method=guest')
    await page.getByLabel('Nickname').fill(nickname)
    await page.getByLabel('Password').fill('guest-password-123')
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    const cookies = await context.cookies()
    expect(cookies.find((c) => c.name === 'auth_method')?.value).toBe('guest')
    expect(cookies.filter((c) => decodeURIComponent(c.value).includes(nickname))).toEqual([])
  })

  test('reopens the guest step on /sign-in after a guest signs out', async ({
    page,
    uniqueNickname,
  }) => {
    await page.goto('/sign-in?method=guest')
    await page.getByLabel('Nickname').fill(uniqueNickname())
    await page.getByLabel('Password').fill('guest-password-123')
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.getByLabel('Nickname')).toBeVisible()
  })

  test('lands an OAuth failure on the account step with its error, even when guest is remembered', async ({
    page,
    context,
  }) => {
    await page.goto('/sign-in?method=guest')
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === 'auth_method')?.value)
      .toBe('guest')

    await page.goto('/sign-in?error=oauth_failed')

    await expect(page.getByRole('alert').filter({ hasText: /sign-in failed/i })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
  })
})
