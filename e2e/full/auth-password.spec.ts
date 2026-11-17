import { expect, test } from '../fixtures/auth'

// Auth specs share state via the local Supabase + Mailpit instances.
// Running serially within the file keeps cleanup deterministic; other
// spec files still run in parallel via the global `fullyParallel` flag.
test.describe.configure({ mode: 'serial' })

test.describe('password sign-up', () => {
  test('user confirms the emailed code, lands on the dashboard, then signs in with the password alone', async ({
    page,
    uniqueEmail,
    pollOtp,
  }) => {
    const email = uniqueEmail('signup')
    const name = 'Eve Newuser'
    const password = 'strong-password-123'

    await page.goto('/sign-up')
    await page.getByLabel('Name').fill(name)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByLabel('6-digit code').fill(await pollOtp(email))
    await page.getByRole('button', { name: 'Verify' }).click()

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
    await expect(page.getByText(`(${name})`)).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })
})

test.describe('password not yet verified', () => {
  test('confirms once with an emailed code, then the password alone works', async ({
    page,
    seedUser,
    pollOtp,
  }) => {
    const user = await seedUser({ passwordVerified: false })

    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText("For your security, confirm it's you.")).toBeVisible()
    await page.getByLabel('6-digit code').fill(await pollOtp(user.email))
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('knowing the password without the mailbox opens no session', async ({ page, seedUser }) => {
    const user = await seedUser({ passwordVerified: false })

    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByLabel('6-digit code')).toBeVisible()

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe('password sign-in', () => {
  test('seeded user can sign in and see their dashboard', async ({ page, seedUser }) => {
    const user = await seedUser({ name: 'Frank Existing' })

    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText(user.email)).toBeVisible()
  })

  test('wrong password shows an error and keeps the user on /sign-in', async ({
    page,
    seedUser,
  }) => {
    const user = await seedUser()

    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Server action returns Result(err); the form renders the message in
    // its role=alert region. Don't pin the exact text — Supabase phrases
    // it as "Invalid login credentials" today and may rephrase later.
    await expect(page.locator('form').getByRole('alert')).toBeVisible()
    // Scoped to the form: Next's route announcer is also role=alert (empty).
    // Production builds replace returned Error instances with React's generic
    // message; the action seam must hand the form real, plain error data.
    await expect(page.locator('form').getByRole('alert')).not.toContainText('omitted in production')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe('sign-out', () => {
  test('signed-in user can sign out and is redirected to /sign-in', async ({ page, seedUser }) => {
    const user = await seedUser()

    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)

    // Confirm the dashboard is no longer reachable without a session.
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})
