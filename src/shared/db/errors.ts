/**
 * Postgres SQLSTATE helpers. Adapters use them to turn constraint
 * violations into typed `AppError`s (unique -> ConflictError, FK ->
 * NotFound/Conflict) instead of leaking driver errors as 500s.
 *
 * Drizzle may wrap the driver error; the SQLSTATE then lives on `cause`.
 */

export const PG_UNIQUE_VIOLATION = '23505'
export const PG_FOREIGN_KEY_VIOLATION = '23503'
export const PG_CHECK_VIOLATION = '23514'

type PgErrorLike = { code?: unknown; constraint_name?: unknown; cause?: unknown }

function findPgError(error: unknown, code: string): PgErrorLike | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const candidate = current as PgErrorLike
    if (candidate.code === code) return candidate
    current = candidate.cause
  }
  return null
}

function matches(error: unknown, code: string, constraint?: string): boolean {
  const pgError = findPgError(error, code)
  if (!pgError) return false
  return constraint === undefined || pgError.constraint_name === constraint
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return matches(error, PG_UNIQUE_VIOLATION, constraint)
}

export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  return matches(error, PG_FOREIGN_KEY_VIOLATION, constraint)
}
