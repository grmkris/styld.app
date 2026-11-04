import { Schema } from 'effect'

/** The longest text each field takes, in characters. The server refuses longer; the website's inputs stop there. */
export const textLength = {
  /** A piece's, a capture's or a look's name. */
  name: 80,
  /** A person's own category of pieces, such as Ski pants. */
  category: 40,
  notes: 500,
  /** The owner's words about a piece for its next drawing. */
  hint: 80,
  boardName: 60,
  /** A label on a board's table, and the words of an outfit's brief. */
  label: 140,
  brand: 60,
  handle: 30,
  profileName: 60,
  city: 60,
  bio: 160,
  /** What a person asks a sticker or a mood board for. */
  prompt: 280,
  chat: 2000,
  search: 80,
  reportNote: 500,
  url: 2048,
} as const

/** Words of at most `maximum` characters, without surrounding spaces, never empty. */
export const trimmedText = (maximum: number) =>
  Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(maximum))

/** A piece's, a capture's or a look's name. */
export const Name = trimmedText(textLength.name)

/** A category of the person's own under a garment type (owner, 2026-11-03, T-12): Ski pants under Sportswear. */
export const CategoryName = trimmedText(textLength.category)

export const Notes = Schema.String.check(Schema.isMaxLength(textLength.notes))

/** The owner's own words about a piece for its next drawing, such as "keep the crossed straps on the back". */
export const Hint = trimmedText(textLength.hint)

/** A web address as given: what it points at is checked where it is read. */
export const Url = Schema.String.check(Schema.isMaxLength(textLength.url))
