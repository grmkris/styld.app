import { Colour, ManifestId, Name, Pattern, PieceType } from '@styld/protocol'
import { Schema } from 'effect'

// The house garments to generate (owner, 4 November 2026): one spec per garment image, each generated once, imported
// into every house account that uses it and reused on all of that account's boards. A spec's id is its permanent key:
// the import's `seed:<id>`, its picture `pictures/<id>`, its provenance row and a later photo swap all use it.

/** The two house accounts. */
const HouseAccount = Schema.Literals(['women', 'men'])
type HouseAccount = typeof HouseAccount.Type

const Words = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(160))

/** One garment: what it is in the repo's terms, and the words its picture is generated from. */
export const Spec = Schema.Struct({
  id: ManifestId,
  accounts: Schema.Array(HouseAccount).check(Schema.isMinLength(1), Schema.isUnique()),
  type: PieceType,
  colours: Schema.Array(Colour).check(Schema.isMinLength(1), Schema.isMaxLength(6), Schema.isUnique()),
  pattern: Pattern,
  subcategory: Words,
  material: Words,
  /** Colour words, pattern and texture: what `colours` cannot say. */
  look: Words,
  name: Name,
})
export type Spec = typeof Spec.Type

export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  model: Schema.Literal('muse-image-1.0'),
  specs: Schema.Array(Spec),
})
export type Manifest = typeof Manifest.Type

/** The cheap first batch (owner, 4 November): both accounts and a shared spec, two stripes, two prints, knit texture. */
export const testBatch = [
  'u-trainers-white',
  'w-knitwear-white-navy',
  'm-shirts-blue-white',
  'w-scarves-purple-pink',
  'm-scarves-navy-red',
  'w-knitwear-beige',
  'm-coats-navy',
  'w-dresses-black',
  'm-jeans-blue',
  'w-bags-brown',
] as const

/** A manifest decoded strictly, its ids unique and each id saying which accounts it is for. */
export const manifestOf = (yaml: unknown): Manifest => {
  const manifest = Schema.decodeUnknownSync(Manifest)(yaml, { onExcessProperty: 'error' })
  const ids = manifest.specs.map(({ id }) => id)
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (repeated.length > 0) throw new Error(`Manifest ids used twice: ${repeated.join(', ')}`)
  const misprefixed = manifest.specs.filter((spec) => !spec.id.startsWith(prefixOf(spec.accounts)))
  if (misprefixed.length > 0)
    throw new Error(
      `Manifest ids whose prefix does not match their accounts: ${misprefixed.map(({ id }) => id).join(', ')}`,
    )
  return manifest
}

/** `u-` for a spec both accounts use, else `w-` or `m-`. */
const prefixOf = (accounts: ReadonlyArray<HouseAccount>) =>
  accounts.length > 1 ? 'u-' : accounts[0] === 'men' ? 'm-' : 'w-'
