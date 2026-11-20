import type { Result } from '@/shared/lib/result'

import { db, type DbTransaction } from './client'

class RollbackWithResult {
  constructor(readonly result: Result<never, unknown>) {}
}

/**
 * `db.transaction` for code that reports expected failures as `Result`
 * instead of throwing: an `err` returned by `fn` rolls the transaction
 * back (so a rule checked after a write never leaves that write behind)
 * and is handed back to the caller as-is. Thrown errors roll back and
 * propagate as usual.
 */
export async function transactionWithResult<R extends Result<unknown, unknown>>(
  fn: (tx: DbTransaction) => Promise<R>,
): Promise<R> {
  try {
    return await db.transaction(async (tx) => {
      const result = await fn(tx)
      if (!result.ok) throw new RollbackWithResult(result)
      return result
    })
  } catch (error) {
    if (error instanceof RollbackWithResult) return error.result as R
    throw error
  }
}
