import { drizzle } from 'drizzle-orm/postgres-js'

import { env } from '@/shared/lib/env'

import { createQueryClient } from './query-client'
import * as schema from './schema'

const queryClient = createQueryClient(env.DATABASE_URL)

export const db = drizzle(queryClient, { schema })

export type Db = typeof db

/** The `tx` handle passed to `db.transaction(async (tx) => ...)`. */
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Anything that can run queries: the pool or an open transaction. */
export type DbExecutor = Db | DbTransaction
