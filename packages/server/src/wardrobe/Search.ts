import { languages } from '@styld/i18n'
import { CurrentAccount, type PieceFilter, pieceMatches, Searchable } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import { stored, toPiece, type WardrobeServices } from './Shared.ts'
import { WardrobeStore } from './Store.ts'

// The one search of the person's own pieces (`@styld/protocol` `PieceSearch.ts`), as the assistants' `piece_search`
// and `wardrobe_show` and Styld's chat ask it: the same pieces the website finds for the same words, in either
// language. The store keeps to ready pieces of the type and pattern asked for; the words, group and attributes are
// matched on what each row says, and only the page found is built into pieces.

/** A page of the search: where it starts among the matches, and how many it holds. */
export interface PieceSearchPage {
  readonly filter: PieceFilter
  readonly offset: number
  readonly limit: number
}

const decodeSearchable = Schema.decodeUnknownOption(Searchable)

export const searching = Effect.map(Effect.context<WardrobeServices>(), (context) => ({
  /** The person's ready pieces that pass the filter, newest first: one page of them, how many match in all, and where
   * the next page starts (none on the last). */
  searchPieces: Effect.fn('Styld.Wardrobe.searchPieces')(function* (page: PieceSearchPage) {
    const { accountId } = yield* CurrentAccount
    const store = yield* WardrobeStore
    const only = {
      ...(page.filter.type === undefined ? {} : { type: page.filter.type }),
      ...(page.filter.pattern === undefined ? {} : { pattern: page.filter.pattern }),
    }
    const found = (yield* stored(store.readyPieces(accountId, only))).filter((row) =>
      Option.exists(decodeSearchable(row), (piece) => pieceMatches(piece, page.filter, languages)),
    )
    const end = page.offset + page.limit
    const shown = found.slice(page.offset, end)
    const pictures = new Map((yield* stored(store.picturesOf(accountId))).map((row) => [row.pieceId, row]))
    const turns = new Map((yield* stored(store.turnsOf(accountId))).map((row) => [row.pieceId, row]))
    return {
      pieces: yield* Effect.forEach(shown, (row) => toPiece(row, pictures.get(row.id), turns.get(row.id))),
      total: found.length,
      nextOffset: end < found.length ? Option.some(end) : Option.none<number>(),
    }
  }, Effect.provide(context)),
}))
