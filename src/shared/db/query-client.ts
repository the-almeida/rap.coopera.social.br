import postgres from 'postgres'

import { resolveSsl } from './ssl'

export function createQueryClient(databaseUrl: string) {
  const ssl = resolveSsl(databaseUrl)
  // Leave the key out when the URL decides: postgres.js lets any `ssl` key,
  // even `undefined`, override the URL's sslmode.
  return postgres(databaseUrl, { prepare: false, ...(ssl === undefined ? {} : { ssl }) })
}
