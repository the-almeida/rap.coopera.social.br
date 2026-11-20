/**
 * The home page agenda. Static sample nights for now; it will list the
 * leagues' upcoming editions once organizers schedule them in the app.
 */

type AgendaItem = {
  date: string
  weekday: string
  league: string
  edition: number
  city: string
}

const SAMPLE_AGENDA: AgendaItem[] = [
  { date: '21 nov', weekday: 'sáb', league: 'Batalha da Praça', edition: 12, city: 'São Paulo' },
  { date: '25 nov', weekday: 'qua', league: 'Rima de Quarta', edition: 4, city: 'Belo Horizonte' },
  {
    date: '28 nov',
    weekday: 'sáb',
    league: 'Liga do Viaduto',
    edition: 31,
    city: 'Rio de Janeiro',
  },
  { date: '05 dez', weekday: 'sáb', league: 'Batalha da Estação', edition: 8, city: 'Recife' },
]

function AgendaRow({ item }: { item: AgendaItem }) {
  return (
    <li className="border-border flex items-center gap-4 rounded-lg border px-4 py-3">
      <div className="w-14 shrink-0 text-center">
        <p className="text-muted-foreground text-xs uppercase">{item.weekday}</p>
        <p className="text-lg font-bold">{item.date}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">
          {item.league} <span className="text-muted-foreground">#{item.edition}</span>
        </p>
        <p className="text-muted-foreground text-sm">{item.city}</p>
      </div>
    </li>
  )
}

export function BattleAgenda() {
  return (
    <section aria-labelledby="agenda-heading" className="flex w-full flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 id="agenda-heading" className="text-2xl font-bold">
          Agenda
        </h2>
        <p className="text-muted-foreground text-xs">exemplo</p>
      </div>
      <ul className="flex flex-col gap-2">
        {SAMPLE_AGENDA.map((item) => (
          <AgendaRow key={`${item.league}-${item.edition}`} item={item} />
        ))}
      </ul>
    </section>
  )
}
