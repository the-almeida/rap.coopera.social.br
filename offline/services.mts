// How each service of the offline stack is configured. The values mirror what
// the Supabase CLI passes to its containers for `supabase/config.toml`, so the
// app, the tests and the e2e suite see the same stack as under `supabase start`.
// When config.toml's [auth] settings change, change them here too.
import { createHmac } from 'node:crypto'

// The Supabase CLI's local ports, so `.env.local`, tests and e2e need no changes.
// Auth and PostgREST listen behind the gateway, on ports the CLI does not use.
export const PORTS = {
  gateway: 54321,
  db: 54322,
  mailpit: 54324,
  smtp: 54325,
  auth: 54330,
  rest: 54331,
} as const

export const SITE_URL = 'http://localhost:3000'
export const API_URL = `http://127.0.0.1:${PORTS.gateway}`

// The Supabase CLI's well-known local secret. Signing the same payloads gives
// the same anon and service-role keys `supabase start` prints. Local only.
export const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

function signJwt(payload: Record<string, unknown>): string {
  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url')
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`
  return `${unsigned}.${createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')}`
}

export const ANON_KEY = signJwt({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 })
export const SERVICE_ROLE_KEY = signJwt({
  iss: 'supabase-demo',
  role: 'service_role',
  exp: 1983812996,
})

export type DatabaseUrls = {
  /** Superuser: migrations, and the app's DATABASE_URL. */
  admin: string
  /** supabase_auth_admin, the role Supabase Auth logs in as. */
  auth: string
  /** authenticator, the role PostgREST logs in as. */
  rest: string
}

/** The same server and database, logged in as each of the roles bootstrap.sql creates. */
export function databaseUrls(admin: string): DatabaseUrls {
  const as = (user: string) => {
    const url = new URL(admin)
    url.username = user
    url.password = 'postgres'
    return url.toString()
  }
  return { admin, auth: as('supabase_auth_admin'), rest: as('authenticator') }
}

/** Supabase Auth (GoTrue), configured like config.toml's [auth] sections. */
export function authEnv(databaseUrl: string, migrationsPath: string): Record<string, string> {
  const verifyUrl = `${API_URL}/auth/v1/verify`
  return {
    API_EXTERNAL_URL: API_URL,
    GOTRUE_API_HOST: '127.0.0.1',
    GOTRUE_API_PORT: String(PORTS.auth),
    GOTRUE_DB_DRIVER: 'postgres',
    GOTRUE_DB_DATABASE_URL: databaseUrl,
    GOTRUE_DB_MIGRATIONS_PATH: migrationsPath,

    GOTRUE_SITE_URL: SITE_URL,
    GOTRUE_URI_ALLOW_LIST: `${SITE_URL}/**`,
    GOTRUE_DISABLE_SIGNUP: 'false',

    GOTRUE_JWT_SECRET: JWT_SECRET,
    GOTRUE_JWT_ISSUER: `${API_URL}/auth/v1`,
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_JWT_EXP: '3600',

    GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true',
    GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL: '10',
    GOTRUE_SECURITY_MANUAL_LINKING_ENABLED: 'true',
    GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION: 'false',
    GOTRUE_PASSWORD_MIN_LENGTH: '6',
    GOTRUE_PASSWORD_REQUIRED_CHARACTERS: '',

    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: 'true',
    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: 'pg-functions://postgres/public/custom_access_token_hook',

    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    // No internet offline, so no Google or Facebook sign-in.
    GOTRUE_EXTERNAL_GOOGLE_ENABLED: 'false',
    GOTRUE_EXTERNAL_FACEBOOK_ENABLED: 'false',

    GOTRUE_MAILER_AUTOCONFIRM: 'false',
    GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED: 'true',
    GOTRUE_MAILER_OTP_LENGTH: '6',
    GOTRUE_MAILER_OTP_EXP: '3600',
    GOTRUE_MAILER_SUBJECTS_CONFIRMATION: 'Confirm your sign-up',
    GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: 'Your sign-in code',
    // GoTrue fetches templates over HTTP; the gateway serves supabase/templates.
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION: `${API_URL}/email/confirmation.html`,
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: `${API_URL}/email/magic_link.html`,
    GOTRUE_MAILER_TEMPLATE_RELOADING_ENABLED: 'true',
    GOTRUE_MAILER_URLPATHS_CONFIRMATION: verifyUrl,
    GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: verifyUrl,
    GOTRUE_MAILER_URLPATHS_INVITE: verifyUrl,
    GOTRUE_MAILER_URLPATHS_RECOVERY: verifyUrl,

    GOTRUE_SMTP_HOST: '127.0.0.1',
    GOTRUE_SMTP_PORT: String(PORTS.smtp),
    GOTRUE_SMTP_ADMIN_EMAIL: 'admin@email.com',
    GOTRUE_SMTP_SENDER_NAME: 'Admin',
    GOTRUE_SMTP_MAX_FREQUENCY: '1s',

    // The CLI's local limits, high enough for the test suite.
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '360000',
    GOTRUE_RATE_LIMIT_OTP: '100',
    GOTRUE_RATE_LIMIT_VERIFY: '30',
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '150',
    GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: '1000',

    GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'false',
    GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'false',
    GOTRUE_MFA_PHONE_ENROLL_ENABLED: 'false',
    GOTRUE_MFA_PHONE_VERIFY_ENABLED: 'false',
  }
}

/** PostgREST. The app never calls it; the security tests check it exposes nothing. */
export function restEnv(databaseUrl: string): Record<string, string> {
  return {
    PGRST_DB_URI: databaseUrl,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_DB_MAX_ROWS: '1000',
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_SERVER_PORT: String(PORTS.rest),
  }
}

/** Mailpit: the inbox for every email (sign-up codes and the app's own). */
export function mailpitArgs(databaseFile: string): string[] {
  return [
    '--listen',
    `127.0.0.1:${PORTS.mailpit}`,
    '--smtp',
    `127.0.0.1:${PORTS.smtp}`,
    '--smtp-auth-accept-any',
    '--smtp-auth-allow-insecure',
    '--database',
    databaseFile,
  ]
}
