import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'

import { LegalFooter } from '@/shared/ui/legal-footer'

import './globals.css'

export const metadata: Metadata = {
  // Pages set their own title and get "· Batalhão" appended.
  title: { default: 'Batalhão, onde o RAP acontece', template: '%s · Batalhão' },
  description:
    'Ligas de batalha de rima: chaveamento, votação da plateia e o histórico de cada MC.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div className="flex min-h-screen flex-col">
            {/* The only element sized to the viewport. Route-group layouts and pages
                fill the rest with `flex-1`, never another `min-h-screen`, which
                would push the footer below the fold. */}
            <div className="flex flex-1 flex-col">{children}</div>
            <LegalFooter />
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
