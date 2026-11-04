import {
  Aesthetic,
  Audience,
  Bio,
  BoardBuild,
  BoardName,
  Colour,
  Handle,
  LabelText,
  Mood,
  Occasion,
  OutfitLayout,
  outfitsIn,
  Paper,
  PieceType,
  ProfileName,
  reservedHandles,
  ReviewState,
  Season,
  SeedId,
} from '@styld/protocol'
import { Schema } from 'effect'
import type { HouseAccount, Manifest } from './Manifest.ts'

// The house boards as the owner wrote them (owner, 4 November 2026; `tools/seed/catalogue.yaml`): the two house
// accounts and each board, its garments as `type:colour[:colour][×n]` slots that resolve to manifest specs, and its
// Slovenian. Decoded strictly; a catalogue that breaks a rule stops the run before anything is sent.

const Account = Schema.Literals(['women', 'men'])

const Translation = <F extends Schema.Struct.Fields>(fields: F) => Schema.Struct({ ...fields, review: ReviewState })

export const CatalogueAccount = Schema.Struct({
  id: Account,
  email: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(320)),
  handle: Handle,
  displayName: ProfileName,
  bio: Bio,
  translations: Schema.Struct({ sl: Translation({ displayName: ProfileName, bio: Bio }) }),
})
export type CatalogueAccount = typeof CatalogueAccount.Type

/** A garment slot: a type, one or more colours, and how many (`×2`). */
const Slot = Schema.String.check(Schema.isPattern(/^[a-zA-Z]+(?::[a-z]+)+(?:×[1-9])?$/u))

export const CatalogueBoard = Schema.Struct({
  id: SeedId,
  owner: Account,
  name: BoardName,
  label: Schema.optionalKey(LabelText),
  credit: Schema.optionalKey(LabelText),
  template: BoardBuild,
  pairsWith: Schema.optionalKey(SeedId),
  piecesFrom: Schema.optionalKey(SeedId),
  outfits: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }))),
  layout: Schema.optionalKey(OutfitLayout),
  anchor: Schema.optionalKey(Slot),
  featured: Schema.optionalKey(Schema.Boolean),
  tags: Schema.Struct({
    audience: Audience,
    season: Schema.Array(Season),
    template: BoardBuild,
    occasion: Schema.Array(Occasion),
    aesthetic: Schema.Array(Aesthetic),
  }),
  moods: Schema.Array(Mood).check(Schema.isMaxLength(3)),
  paper: Schema.optionalKey(Paper),
  note: Schema.optionalKey(Schema.String),
  pieces: Schema.optionalKey(Schema.Array(Slot)),
  translations: Schema.Struct({
    sl: Translation({
      name: BoardName,
      label: Schema.optionalKey(LabelText),
      credit: Schema.optionalKey(LabelText),
    }),
  }),
})
export type CatalogueBoard = typeof CatalogueBoard.Type

export const Catalogue = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  accounts: Schema.Array(CatalogueAccount),
  boards: Schema.Array(CatalogueBoard),
})
export type Catalogue = typeof Catalogue.Type

/** A garment slot, read. */
export interface GarmentSlot {
  readonly type: PieceType
  readonly colours: ReadonlyArray<Colour>
  readonly count: number
}

const isType = Schema.is(PieceType)
const isColour = Schema.is(Colour)

/** A slot's type, colours and count, or why it is not one. */
export const slotOf = (text: string): GarmentSlot => {
  const [body = '', count = '1'] = text.split('×')
  const [type = '', ...colours] = body.split(':')
  if (!isType(type)) throw new Error(`Not a garment type: ${text}`)
  const read = colours.flatMap((colour) => (isColour(colour) ? [colour] : []))
  if (read.length !== colours.length) throw new Error(`Not a colour: ${text}`)
  return { type, colours: read, count: Number(count) }
}

/** A slot's key: its type and colours, as the manifest's ids spell them. */
const keyOf = (slot: Pick<GarmentSlot, 'type' | 'colours'>) => [slot.type, ...slot.colours].join('-')

/** The board's garments: its own, or those of the board it takes them from. */
export const piecesOf = (board: CatalogueBoard, boards: ReadonlyMap<string, CatalogueBoard>): ReadonlyArray<string> =>
  board.pieces ?? (board.piecesFrom === undefined ? [] : (boards.get(board.piecesFrom)?.pieces ?? []))

/** The types both accounts can share one picture of: no gendered cut. */
const shareable: ReadonlySet<PieceType> = new Set([
  'trainers',
  'sportShoes',
  'outdoorShoes',
  'eyewear',
  'hats',
  'gloves',
  'socks',
  'hoodies',
  'scarves',
])

/** How many of each key an account's boards need at most: one board asking for two white tees needs two. */
export const needsOf = (catalogue: Catalogue): Readonly<Record<HouseAccount, ReadonlyMap<string, number>>> => {
  const byId = new Map(catalogue.boards.map((board) => [board.id, board]))
  const needs = { women: new Map<string, number>(), men: new Map<string, number>() }
  for (const board of catalogue.boards)
    for (const text of [...piecesOf(board, byId), ...(board.anchor === undefined ? [] : [board.anchor])]) {
      const slot = slotOf(text)
      const key = keyOf(slot)
      needs[board.owner].set(key, Math.max(needs[board.owner].get(key) ?? 0, slot.count))
    }
  return needs
}

/** The manifest id of the `k`-th (from 1) piece of a slot on a board of `account`: shared when its type has no
 * gendered cut and the other account needs that key at least `k` times too, the account's own otherwise. The second
 * and later of a kind get `-k`. */
export const manifestIdFor = (
  account: HouseAccount,
  slot: Pick<GarmentSlot, 'type' | 'colours'>,
  k: number,
  needs: Readonly<Record<HouseAccount, ReadonlyMap<string, number>>>,
) => {
  const key = keyOf(slot)
  const other: HouseAccount = account === 'women' ? 'men' : 'women'
  const shared = shareable.has(slot.type) && (needs[other].get(key) ?? 0) >= k
  const prefix = shared ? 'u' : account === 'women' ? 'w' : 'm'
  return `${prefix}-${key}${k >= 2 ? `-${String(k)}` : ''}`
}

/** A board's slots as manifest ids, `×n` spread into `n`. */
export const resolvedSlots = (
  account: HouseAccount,
  slots: ReadonlyArray<string>,
  needs: Readonly<Record<HouseAccount, ReadonlyMap<string, number>>>,
) =>
  slots.flatMap((text) => {
    const slot = slotOf(text)
    return Array.from({ length: slot.count }, (_, index) => manifestIdFor(account, slot, index + 1, needs))
  })

/** Every way the catalogue breaks a rule, as lines; none when it keeps them all. */
export const catalogueFaults = (catalogue: Catalogue, manifest: Manifest): ReadonlyArray<string> => {
  const byId = new Map(catalogue.boards.map((board) => [board.id, board]))
  const specs = new Map(manifest.specs.map((spec) => [spec.id, spec]))
  const needs = needsOf(catalogue)
  const ids = catalogue.boards.map(({ id }) => id)
  return [
    ...ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `${id}: id used twice`),
    ...catalogue.accounts.flatMap((account) =>
      reservedHandles.has(account.handle) ? [`${account.id}: handle ${account.handle} is reserved`] : [],
    ),
    ...catalogue.boards.flatMap((board) => boardFaults(board, byId, specs, needs)),
  ]
}

const boardFaults = (
  board: CatalogueBoard,
  byId: ReadonlyMap<string, CatalogueBoard>,
  specs: ReadonlyMap<string, Manifest['specs'][number]>,
  needs: Readonly<Record<HouseAccount, ReadonlyMap<string, number>>>,
): ReadonlyArray<string> => {
  const source = board.piecesFrom === undefined ? undefined : byId.get(board.piecesFrom)
  const slots = [...piecesOf(board, byId), ...(board.anchor === undefined ? [] : [board.anchor])]
  const resolved = resolvedSlots(board.owner, slots, needs)
  return [
    ...(slots.length === 0 ? [`${board.id}: no pieces`] : []),
    ...(board.piecesFrom !== undefined && source?.owner !== board.owner
      ? [`${board.id}: piecesFrom ${board.piecesFrom} is not the same account's board`]
      : []),
    ...(board.template === 'onePiece' &&
    (board.anchor === undefined || board.layout === undefined || board.outfits !== outfitsIn(board.layout))
      ? [`${board.id}: a one-piece board needs an anchor and a layout holding its outfits`]
      : []),
    ...((board.template === 'outfits' || board.template === 'challenge') && board.outfits === undefined
      ? [`${board.id}: says no number of outfits`]
      : []),
    ...(board.template === 'look' && resolved.length > 12 ? [`${board.id}: a look holds at most 12 pieces`] : []),
    ...resolved.flatMap((id) => {
      const spec = specs.get(id)
      if (spec === undefined) return [`${board.id}: ${id} is not in the manifest`]
      return spec.accounts.includes(board.owner) ? [] : [`${board.id}: ${id} is not for ${board.owner}`]
    }),
  ]
}
