import { Predicate, Schema } from 'effect'

// How a provider call fails, one error with the reason every caller handles (`Effect.catchReason`):
// - Refused: the provider declined the work and did not bill it; the same request would be declined again.
// - Busy: the provider could not take it now (throttled, unavailable, a call that never left); a later try may pass.
// - OutcomeUnknown: the provider may have taken paid work and its answer was lost; sending it again could pay twice.
// - Broken: the provider answered something Styld cannot read; the same request would read the same way.

export class Refused extends Schema.TaggedError<Refused>()('Refused', {}) {}
export class Busy extends Schema.TaggedError<Busy>()('Busy', {}) {}
export class OutcomeUnknown extends Schema.TaggedError<OutcomeUnknown>()('OutcomeUnknown', {}) {}
export class Broken extends Schema.TaggedError<Broken>()('Broken', {}) {}

export class ProviderError extends Schema.TaggedError<ProviderError>()('ProviderError', {
  provider: Schema.String,
  reason: Schema.Union([Refused, Busy, OutcomeUnknown, Broken]),
}) {}

export const refused = (provider: string) => ProviderError.make({ provider, reason: Refused.make({}) })
export const busy = (provider: string) => ProviderError.make({ provider, reason: Busy.make({}) })
export const outcomeUnknown = (provider: string) => ProviderError.make({ provider, reason: OutcomeUnknown.make({}) })
export const broken = (provider: string) => ProviderError.make({ provider, reason: Broken.make({}) })

/** Whether a later try may pass: the provider was busy. */
export const isBusy = (error: ProviderError) => Predicate.isTagged(error.reason, 'Busy')

/** Whether the provider may have taken the work: it must never be sent again on its own. */
export const isOutcomeUnknown = (error: ProviderError) => Predicate.isTagged(error.reason, 'OutcomeUnknown')

/** A provider's answer to an HTTP request it did not take: throttling and server errors were not billed and may pass
 * later; any other refusal would repeat. */
export const reasonOfStatus = (provider: string, status: number) =>
  status === 408 || status === 429 || status >= 500 ? busy(provider) : refused(provider)
