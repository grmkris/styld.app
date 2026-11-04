import { allowanceBeforePremium } from './Credits.ts'
import type { WalletState } from './WalletState.ts'

/**
 * What `day` has to spend under `dailyAllowance`, and the allowance the day is then granted. A new day starts from the
 * allowance; the same day keeps what is left, topped up by however much the allowance grew since (premium bought
 * mid-day). A smaller allowance (premium ended mid-day) takes nothing back. The Wallet decides reservations with it and
 * the server answers "credits left today" with it, so the two never disagree.
 */
/** The free credits left: what the Wallet recorded, or the whole one-time grant `freeCredits` before it recorded any
 * (absent: a reservation that brings no grant, which spends none). The Wallet decides with it and the server answers
 * "credits left" with it. */
export const freeLeft = (state: Pick<WalletState, 'free'>, freeCredits: number | undefined) => state.free ?? freeCredits

export const spendableOn = (daily: WalletState['daily'], day: string, dailyAllowance: number) => {
  if (daily.day !== day) return { available: dailyAllowance, allowance: dailyAllowance }
  const granted = daily.allowance ?? allowanceBeforePremium
  const allowance = Math.max(granted, dailyAllowance)
  return { available: daily.remaining + allowance - granted, allowance }
}
