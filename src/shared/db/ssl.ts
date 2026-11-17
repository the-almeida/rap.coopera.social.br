const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function resolveSsl(databaseUrl: string): 'require' | false | undefined {
  const url = new URL(databaseUrl)
  if (url.searchParams.has('sslmode') || url.searchParams.has('sslrootcert')) return undefined
  if (LOOPBACK_HOSTS.has(url.hostname)) return false
  return 'require'
}
