import Link from 'next/link'

export default function HomePage() {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <h1 className="text-center text-4xl font-bold tracking-tight">Batalhão</h1>
      <p className="text-muted-foreground max-w-prose text-center text-lg">
        Ligas de batalha de rima: chaveamento, votação da plateia e o histórico de cada MC.
      </p>
      <div className="flex gap-3">
        <Link
          href="/sign-up"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
        >
          Get started
        </Link>
        <Link
          href="/sign-in"
          className="border-border rounded-md border px-4 py-2 text-sm font-medium"
        >
          Sign in
        </Link>
      </div>
    </section>
  )
}
