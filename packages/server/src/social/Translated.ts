import { boardTranslations, profileTranslations } from '@styld/db'
import type { Language } from '@styld/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import { Array, Context, Effect, Order } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import { type Database, inChunks } from '../kernel/Db.ts'
import { digestOf } from '../kernel/Ids.ts'

// The same board or profile in another language (owner, 4 November 2026). A translation keeps the digest of the
// original text it translated; it is shown only while the original is unchanged, so an owner's edit never leaves a
// translation of words that are gone. Every public read picks it here, by the reader's language, so the wire keeps one
// name and nothing in the website changes.

/** The reader's language for this request; English when nothing says otherwise. */
export const ReaderLocale = Context.Reference<Language>('@styld/server/social/ReaderLocale', {
  defaultValue: () => 'en',
})

const chosenLocale = /(?:^|;\s*)styld_locale=(en|sl)(?:;|$)/u

/** The reader's language from their request: the website's own choice (the `styld_locale` cookie the language picker
 * sets), then whether the browser asks for Slovenian first, else English. */
export const readerLocaleOf = (headers: Readonly<Record<string, string | undefined>>): Language => {
  const chosen = chosenLocale.exec(headers['cookie'] ?? '')?.[1]
  if (chosen === 'en' || chosen === 'sl') return chosen
  return (headers['accept-language'] ?? '').trim().toLowerCase().startsWith('sl') ? 'sl' : 'en'
}

/** Read as this request's reader: its language for every public read inside. */
export const asReader = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(HttpServerRequest, (request) =>
    Effect.provideService(effect, ReaderLocale, readerLocaleOf(request.headers)),
  )

/** What a board's translation translates: its name and its table's labels by item, as one digest. */
export const boardSourceDigest = (
  name: string,
  labels: ReadonlyArray<{ readonly id: string; readonly text: string }>,
) =>
  digestOf(
    JSON.stringify([
      name,
      Array.sort(
        labels.map(({ id, text }) => [id, text] as const),
        Order.mapInput(Order.String, ([id]: readonly [string, string]) => id),
      ),
    ]),
  )

/** What a profile's translation translates: its name and bio, as one digest. */
export const profileSourceDigest = (name: string, bio: string | null) => digestOf(JSON.stringify([name, bio ?? '']))

/** A board's original words: its name, and its table's labels by item. */
export interface BoardWords {
  readonly id: string
  readonly name: string
  readonly labels: ReadonlyArray<{ readonly id: string; readonly text: string }>
}

/** A board's words in the reader's language. */
export interface TranslatedBoard {
  readonly name: string
  readonly labels: Readonly<Record<string, string>>
}

/** The translations of these boards into `locale` that still translate their originals, by board. */
export const boardTranslationsIn = (db: Database['Service'], locale: Language, boards: ReadonlyArray<BoardWords>) =>
  Effect.gen(function* () {
    const fresh = new Map<string, TranslatedBoard>()
    if (locale === 'en' || boards.length === 0) return fresh
    const rows = yield* inChunks(
      boards.map(({ id }) => id),
      (chunk) =>
        db
          .select()
          .from(boardTranslations)
          .where(and(inArray(boardTranslations.boardId, chunk), eq(boardTranslations.locale, locale))),
    )
    const originals = new Map(boards.map((board) => [board.id, board]))
    for (const row of rows) {
      const original = originals.get(row.boardId)
      if (original !== undefined && (yield* boardSourceDigest(original.name, original.labels)) === row.sourceDigest)
        fresh.set(row.boardId, { name: row.name, labels: row.labels })
    }
    return fresh
  })

/** A profile's original words. */
export interface ProfileWords {
  readonly accountId: string
  readonly name: string
  readonly bio: string | null
}

/** A profile's words in the reader's language. */
export interface TranslatedProfile {
  readonly name: string
  readonly bio: string | null
}

/** The translations of these profiles into `locale` that still translate their originals, by account. */
export const profileTranslationsIn = (
  db: Database['Service'],
  locale: Language,
  profiles: ReadonlyArray<ProfileWords>,
) =>
  Effect.gen(function* () {
    const fresh = new Map<string, TranslatedProfile>()
    if (locale === 'en' || profiles.length === 0) return fresh
    const rows = yield* inChunks(
      profiles.map(({ accountId }) => accountId),
      (chunk) =>
        db
          .select()
          .from(profileTranslations)
          .where(and(inArray(profileTranslations.accountId, chunk), eq(profileTranslations.locale, locale))),
    )
    const originals = new Map(profiles.map((profile) => [profile.accountId, profile]))
    for (const row of rows) {
      const original = originals.get(row.accountId)
      if (original !== undefined && (yield* profileSourceDigest(original.name, original.bio)) === row.sourceDigest)
        fresh.set(row.accountId, { name: row.name, bio: row.bio })
    }
    return fresh
  })

/** The translation of this profile into `locale`, while it still translates its original. */
export const profileTranslationIn = (db: Database['Service'], locale: Language, profile: ProfileWords) =>
  Effect.map(profileTranslationsIn(db, locale, [profile]), (fresh) => fresh.get(profile.accountId))

/** A table's items with its labels in the reader's language, where the translation has them (it holds only labels,
 * by their items). */
export const translatedItems = <I extends { readonly id: string }>(
  items: ReadonlyArray<I>,
  labels: Readonly<Record<string, string>> | undefined,
): ReadonlyArray<I> =>
  labels === undefined
    ? items
    : items.map((item) => {
        const text = labels[item.id]
        return text === undefined ? item : { ...item, text }
      })
