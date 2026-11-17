import { redirect } from 'next/navigation'

import { getOptionalUser } from '@/modules/auth'

export const dynamic = 'force-dynamic'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalUser()
  if (user) redirect('/dashboard')

  return (
    <main className="bg-background flex flex-1 items-center justify-center px-4 py-6">
      <div className="border-border w-full max-w-sm rounded-lg border p-6">{children}</div>
    </main>
  )
}
