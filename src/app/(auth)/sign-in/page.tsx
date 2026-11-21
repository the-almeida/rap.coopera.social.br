import { env } from '@/shared/lib/env'

import { activeOAuthProviders } from '@/modules/auth'

import { AuthEntry } from '../_components/auth-entry'

import { SignInForm } from './sign-in-form'

type Props = {
  searchParams: Promise<{ error?: string | string[]; method?: string | string[] }>
}

export default async function SignInPage({ searchParams }: Props) {
  const oauthProviders = activeOAuthProviders(env)
  return (
    <AuthEntry
      searchParams={await searchParams}
      page={{
        path: '/sign-in',
        title: 'Sign in',
        crossLink: { prompt: 'New here?', label: 'Create an account', href: '/sign-up' },
        accountForm: <SignInForm oauthProviders={oauthProviders} />,
        oauthProviders,
      }}
    />
  )
}
