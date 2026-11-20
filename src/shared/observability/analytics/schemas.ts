import { z } from 'zod'

import { Events } from './events'

export const eventSchemas = {
  [Events.USER_SIGNED_UP]: z.object({
    method: z.enum(['email', 'otp', 'google', 'facebook', 'guest']),
  }),
  [Events.USER_SIGNED_IN]: z.object({
    method: z.enum(['email', 'otp', 'google', 'facebook', 'guest']),
  }),
  [Events.ACCOUNT_PROTECTED]: z.object({ method: z.enum(['email', 'oauth']) }),
  [Events.USER_SIGNED_OUT]: z.object({}),
  [Events.CRITICAL_ERROR_SHOWN]: z.object({
    page: z.string(),
    code: z.string(),
  }),
  [Events.EXPECTED_ERROR]: z.object({
    kind: z.enum([
      'validation',
      'not_found',
      'forbidden',
      'unauthenticated',
      'conflict',
      'external_service',
    ]),
    feature: z.string(),
  }),
  [Events.LEAGUE_CREATED]: z.object({}),
  [Events.BRACKET_DRAWN]: z.object({
    bracketSize: z.union([z.literal(8), z.literal(16)]),
    entries: z.number().int().positive(),
  }),
  [Events.EDITION_COMPLETED]: z.object({
    bracketSize: z.union([z.literal(8), z.literal(16)]),
  }),
  [Events.VULGO_CLAIM_DECIDED]: z.object({
    decision: z.enum(['approved', 'rejected']),
  }),
} as const

export type EventPayload<E extends keyof typeof eventSchemas> = z.infer<(typeof eventSchemas)[E]>
