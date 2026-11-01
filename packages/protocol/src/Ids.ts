import { Schema } from 'effect'

/** An opaque entity id: its two-letter kind, an underscore and 22 base64url characters (16 random bytes), such as
 * `pc_…` for a piece. Every id the contract names is one of these, branded by what it is the id of. */
export const entityId = (prefix: string) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[A-Za-z0-9_-]{22}$`, 'u')))

/** The client's id for one write, chosen anew for each change: repeating a request with the same one answers the first
 * request again instead of doing it twice. */
export const OperationId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/u)).pipe(
  Schema.brand('OperationId'),
)
export type OperationId = typeof OperationId.Type
