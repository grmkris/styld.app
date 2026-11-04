import { allowanceBeforePremium } from './Credits.ts'
import type { WalletState } from './WalletState.ts'

/**
 * What `day` has to spend under `dailyAllowance`, and the allowance the day is then granted. A new day starts from the
 * allowance; the same day keeps what is left, topped up by however much the allowance grew since (premium bought
 * mid-day). A smaller allowance (premium ended mid-day) takes nothing back. The Wallet decides reservations with it and
 * the server answers "credits left today" with it, so the two never disagree.
 */
export const spendableOn = (daily: WalletState['daily'], day: string, dailyAllowance: number) => {
  if (daily.day !== day) return { available: dailyAllowance, allowance: dailyAllowance }
  const granted = daily.allowance ?? allowanceBeforePremium
  const allowance = Math.max(granted, dailyAllowance)
  return { available: daily.remaining + allowance - granted, allowance }
}
