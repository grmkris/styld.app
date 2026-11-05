import { Predicate, Schema } from 'effect'

// How a provider call fails, one error with the reason every caller handles (`Effect.catchReason`):
// - Refused: the provider declined the work and did not bill it; the same request would be declined again.
// - Busy: the provider could not take it now (throttled, unavailable, a call that never left); a later try may pass.
// - OutcomeUnknown: the provider may have taken paid work and its answer was lost; sending it again could pay twice.
// - Broken: the provider answered something Styld cannot read; the same request would read the same way.
// A failure that came from a thrown error (a lost connection, a binding that rejected) keeps it as its `cause`, so its
// log says why. Only the transport's or binding's own error goes there, never a request or a response body: a prompt,
// a picture, a key or a provider's words never enter it (a body that does not parse leaves no cause, since a parser's
// message quotes the body).

class Refused extends Schema.TaggedError<Refused>()('Refused', {}) {}
class Busy extends Schema.TaggedError<Busy>()('Busy', {}) {}
class OutcomeUnknown extends Schema.TaggedError<OutcomeUnknown>()('OutcomeUnknown', {}) {}
class Broken extends Schema.TaggedError<Broken>()('Broken', {}) {}

export class ProviderError extends Schema.TaggedError<ProviderError>()('ProviderError', {
  provider: Schema.String,
  reason: Schema.Union([Refused, Busy, OutcomeUnknown, Broken]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** The error's fields, with its cause when it has one. */
const fields = (provider: string, cause: unknown) => (cause === undefined ? { provider } : { provider, cause })

export const refused = (provider: string, cause?: unknown) =>
  ProviderError.make({ ...fields(provider, cause), reason: Refused.make({}) })
export const busy = (provider: string, cause?: unknown) =>
  ProviderError.make({ ...fields(provider, cause), reason: Busy.make({}) })
export const outcomeUnknown = (provider: string, cause?: unknown) =>
  ProviderError.make({ ...fields(provider, cause), reason: OutcomeUnknown.make({}) })
export const broken = (provider: string, cause?: unknown) =>
  ProviderError.make({ ...fields(provider, cause), reason: Broken.make({}) })

/** Whether a later try may pass: the provider was busy. */
export const isBusy = (error: ProviderError) => Predicate.isTagged(error.reason, 'Busy')

/** Whether the provider may have taken the work: it must never be sent again on its own. */
export const isOutcomeUnknown = (error: ProviderError) => Predicate.isTagged(error.reason, 'OutcomeUnknown')

/** A provider's answer to an HTTP request it did not take: throttling and server errors were not billed and may pass
 * later; any other refusal would repeat. */
export const reasonOfStatus = (provider: string, status: number) =>
  status === 408 || status === 429 || status >= 500 ? busy(provider) : refused(provider)
