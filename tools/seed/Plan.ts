import { createHash } from 'node:crypto'
import {
  type BoardTag,
  type ImportPiece,
  OperationId,
  type SeedBoardRequest,
  type SeedLabel,
  type SeedProfile,
} from '@styld/protocol'
import {
  type Catalogue,
  type CatalogueAccount,
  type CatalogueBoard,
  needsOf,
  piecesOf,
  resolvedSlots,
} from './Catalogue.ts'
import type { HouseAccount, Manifest, Spec } from './Manifest.ts'

// What the seed sends, worked out before anything is sent (owner, 4 November 2026): each house account's garments to
// import, its profile, and every board's request in the order the boards go public. Pure, so the same catalogue and
// manifest give byte-identical requests, and a dry run can print them.

/** An operation id from what it is of: the same step of the same entry is the same operation. */
const operationOf = (...parts: ReadonlyArray<string>) =>
  OperationId.make(`seed-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 40)}`)

/** A board's request, with what the run needs to know of it. */
export interface PlannedBoard {
  readonly seedId: string
  readonly owner: HouseAccount
  readonly audience: CatalogueBoard['tags']['audience']
  readonly featured: boolean
  readonly request: SeedBoardRequest
}

/** An account's part: its catalogue entry, its profile's request, and the manifest ids of its garments. */
export interface PlannedAccount {
  readonly account: CatalogueAccount
  readonly profile: SeedProfile
  readonly garments: ReadonlyArray<string>
}

const unique = (ids: ReadonlyArray<string>) => [...new Set(ids)]

const tagsOf = (board: CatalogueBoard): ReadonlyArray<BoardTag> => [
  { kind: 'audience', value: board.tags.audience },
  ...board.tags.season.map((value) => ({ kind: 'season' as const, value })),
  { kind: 'template', value: board.tags.template },
  ...board.tags.occasion.map((value) => ({ kind: 'occasion' as const, value })),
  ...board.tags.aesthetic.map((value) => ({ kind: 'aesthetic' as const, value })),
]

const labelsOf = (board: CatalogueBoard): ReadonlyArray<SeedLabel> => {
  const sl = board.translations.sl
  return [
    ...(board.label === undefined ? [] : [{ text: board.label, style: 'label' as const, sl: sl.label ?? board.label }]),
    ...(board.credit === undefined
      ? []
      : [{ text: board.credit, style: 'label' as const, sl: sl.credit ?? board.credit }]),
  ]
}

/** The interleaved order boards go public in: women's, men's, everyone's in turn, so no first screen is of one
 * audience; the featured last, so they are the newest. */
export const publishOrder = <B extends Pick<PlannedBoard, 'audience' | 'featured'>>(
  boards: ReadonlyArray<B>,
): ReadonlyArray<B> => {
  const dealt = (group: ReadonlyArray<B>) => {
    const queues = (['women', 'men', 'all'] as const).map((audience) =>
      group.filter((board) => board.audience === audience),
    )
    const longest = Math.max(0, ...queues.map((queue) => queue.length))
    return Array.from({ length: longest }, (_, index) =>
      queues.flatMap((queue) => queue.slice(index, index + 1)),
    ).flat()
  }
  return [...dealt(boards.filter(({ featured }) => !featured)), ...dealt(boards.filter(({ featured }) => featured))]
}

/** The whole seed: each account's part, and the boards in publish order. */
export const planOf = (catalogue: Catalogue, manifest: Manifest) => {
  const needs = needsOf(catalogue)
  const byId = new Map(catalogue.boards.map((board) => [board.id, board]))
  const emailOf = (owner: HouseAccount) => catalogue.accounts.find(({ id }) => id === owner)?.email ?? ''
  const boards = catalogue.boards.map((board): PlannedBoard => {
    const anchor = board.anchor === undefined ? undefined : resolvedSlots(board.owner, [board.anchor], needs)[0]
    const pieces = unique(resolvedSlots(board.owner, piecesOf(board, byId), needs)).filter((id) => id !== anchor)
    const season = board.tags.season[0]
    return {
      seedId: board.id,
      owner: board.owner,
      audience: board.tags.audience,
      featured: board.featured ?? false,
      request: {
        operationId: operationOf(board.id, 'board', String(catalogue.version)),
        email: emailOf(board.owner),
        version: catalogue.version,
        board: {
          name: board.name,
          build: board.template,
          paper: board.paper ?? 'sand',
          moods: board.moods,
          labels: labelsOf(board),
          pieces,
          ...(anchor === undefined ? {} : { anchor }),
          ...(board.layout === undefined ? {} : { layout: board.layout }),
          ...(board.outfits === undefined ? {} : { outfits: board.outfits }),
          ...(season === undefined ? {} : { season }),
          tags: tagsOf(board),
          sl: { name: board.translations.sl.name, review: board.translations.sl.review },
        },
      },
    }
  })
  const accounts = catalogue.accounts.map((account): PlannedAccount => ({
    account,
    profile: {
      operationId: operationOf(account.id, 'profile', String(catalogue.version)),
      email: account.email,
      handle: account.handle,
      name: account.displayName,
      bio: account.bio,
      sl: {
        name: account.translations.sl.displayName,
        bio: account.translations.sl.bio,
        review: account.translations.sl.review,
      },
    },
    garments: unique(
      boards
        .filter(({ owner }) => owner === account.id)
        .flatMap(({ request }) => [
          ...request.board.pieces,
          ...(request.board.anchor === undefined ? [] : [request.board.anchor]),
        ]),
    ).filter((id) => manifest.specs.some((spec) => spec.id === id)),
  }))
  return { accounts, boards: publishOrder(boards) }
}

export type SeedPlan = ReturnType<typeof planOf>

/** A garment as the import takes it: `seed:<id>`, its picture `pictures/<id>`, marked as the seed generated it. */
export const importPieceOf = (spec: Spec, promptDigest: string): ImportPiece => ({
  v1Id: `seed:${spec.id}`,
  name: spec.name,
  type: spec.type,
  colours: spec.colours,
  picture: `pictures/${spec.id}`,
  contentType: 'image/png',
  generated: { manifestId: spec.id, model: 'muse-image-1.0', promptDigest },
})
