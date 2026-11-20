import { type Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth'

// Only the root layout sizes itself to the viewport. A route-group layout or
// page that does it again pushes the footer below the fold and adds a
// scrollbar to pages with little content. The viewport is pinned so "short
// page" stays true when the default changes. Each route group is checked on
// one of its short pages: /data-deletion/status for (public), since the home
// page lists the battle agenda and may scroll.
test.use({ viewport: { width: 1280, height: 800 } })

function verticalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
}

test.describe('@smoke layout', () => {
  for (const path of ['/data-deletion/status', '/sign-in']) {
    test(`${path} fits the viewport with the footer in view`, async ({ page }) => {
      await page.goto(path)

      expect(await verticalOverflow(page)).toBe(0)
      await expect(page.getByRole('navigation', { name: 'Legal' })).toBeInViewport()
    })
  }

  test('/dashboard fits the viewport with the footer in view', async ({
    page,
    seedUser,
    signInAs,
  }) => {
    await signInAs(page, await seedUser())
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

    expect(await verticalOverflow(page)).toBe(0)
    await expect(page.getByRole('navigation', { name: 'Legal' })).toBeInViewport()
  })
})
