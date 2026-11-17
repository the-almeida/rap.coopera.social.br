import { drizzle } from 'drizzle-orm/postgres-js'

import { env } from '@/shared/lib/env'

import { createQueryClient } from './query-client'
import * as schema from './schema'

const queryClient = createQueryClient(env.DATABASE_URL)

export const db = drizzle(queryClient, { schema })

export type Db = typeof db
