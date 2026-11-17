import { env } from '@/shared/lib/env'

import { activeOAuthProviders } from '@/modules/auth'

import { AuthEntry } from '../_components/auth-entry'

import { SignUpForm } from './sign-up-form'

type Props = {
  searchParams: Promise<{ error?: string | string[]; method?: string | string[] }>
}

export default async function SignUpPage({ searchParams }: Props) {
  return (
    <AuthEntry
      searchParams={await searchParams}
      page={{
        path: '/sign-up',
        title: 'Create an account',
        crossLink: { prompt: 'Already registered?', label: 'Sign in', href: '/sign-in' },
        accountForm: <SignUpForm oauthProviders={activeOAuthProviders(env)} />,
      }}
    />
  )
}
