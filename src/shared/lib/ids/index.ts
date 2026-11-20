import { z } from 'zod'

export const UserIdSchema = z.uuid().brand<'UserId'>()
export const AccountDeletionRequestIdSchema = z.uuid().brand<'AccountDeletionRequestId'>()
export const McProfileIdSchema = z.uuid().brand<'McProfileId'>()
export const VulgoIdSchema = z.uuid().brand<'VulgoId'>()
export const VulgoClaimIdSchema = z.uuid().brand<'VulgoClaimId'>()
export const LeagueIdSchema = z.uuid().brand<'LeagueId'>()
export const EditionIdSchema = z.uuid().brand<'EditionId'>()
export const EntryIdSchema = z.uuid().brand<'EntryId'>()
export const CrowdDrawIdSchema = z.uuid().brand<'CrowdDrawId'>()
export const BattleIdSchema = z.uuid().brand<'BattleId'>()
export const BattleRoundIdSchema = z.uuid().brand<'BattleRoundId'>()
export const WithdrawalIdSchema = z.uuid().brand<'WithdrawalId'>()

export type UserId = z.infer<typeof UserIdSchema>
export type AccountDeletionRequestId = z.infer<typeof AccountDeletionRequestIdSchema>
export type McProfileId = z.infer<typeof McProfileIdSchema>
export type VulgoId = z.infer<typeof VulgoIdSchema>
export type VulgoClaimId = z.infer<typeof VulgoClaimIdSchema>
export type LeagueId = z.infer<typeof LeagueIdSchema>
export type EditionId = z.infer<typeof EditionIdSchema>
export type EntryId = z.infer<typeof EntryIdSchema>
export type CrowdDrawId = z.infer<typeof CrowdDrawIdSchema>
export type BattleId = z.infer<typeof BattleIdSchema>
export type BattleRoundId = z.infer<typeof BattleRoundIdSchema>
export type WithdrawalId = z.infer<typeof WithdrawalIdSchema>
