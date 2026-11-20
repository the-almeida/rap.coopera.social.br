import { z } from 'zod'

export const slugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be a lowercase slug')

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(20),
})

export const isoDateSchema = z.iso.datetime()

/**
 * Accepts a `Date` (server actions receive real Dates through React
 * Flight) or an ISO-8601 string with an explicit offset (API/JSON callers),
 * always producing a `Date`. Offset-less strings are rejected on purpose:
 * "20:00" means different instants in different time zones.
 */
export const dateInputSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
])

/** Trimmed, non-blank text with a max length. */
export const requiredText = (max: number) => z.string().trim().min(1).max(max)

/**
 * Optional text where blank means "no value": `''` / `'  '` / `null` become
 * `null`. `undefined` stays `undefined` so update schemas can tell "leave
 * as is" (absent) from "clear it" (null or blank).
 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null))
