import Link from 'next/link'

import { BattleAgenda } from './_components/battle-agenda'

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-12 px-6 py-24">
      <section className="flex flex-col items-center gap-6">
        <h1 className="text-center text-5xl font-bold tracking-tight">Batalhão</h1>
        <p className="text-muted-foreground text-center text-xl">onde o RAP acontece</p>
        <div className="flex gap-3">
          <Link
            href="/sign-up"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          >
            Criar conta
          </Link>
          <Link
            href="/sign-in"
            className="border-border rounded-md border px-4 py-2 text-sm font-medium"
          >
            Entrar
          </Link>
        </div>
      </section>
      <BattleAgenda />
    </div>
  )
}
