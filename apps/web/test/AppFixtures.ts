import { catalogVersion } from '@styld/i18n'
import type { BoardSummary, Piece } from '@styld/protocol'
import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { fromString } from 'foldkit/url'
import { type Flags, init, type Model, Session } from '../src/App.ts'
import type { PageLens } from '../src/Page.ts'
import { BoardsData, PiecesData } from '../src/ServerData.ts'

/** Ana, signed in with a verified address. */
export const claims = { accountId: 'acc_1', displayName: 'Ana', email: 'ana@example.com', emailVerified: true }

/** What the server hands an English visitor's page. */
export const flags = (signedIn: boolean): Flags => ({
  locale: 'en',
  catalogVersion,
  timeZone: 'UTC',
  referenceTime: 0,
  origin: 'https://styld.test',
  telemetryConsent: 'denied',
  ...(signedIn ? { hasSessionCookie: true } : {}),
})

/** The address of a path on the test origin. */
export const urlOf = (path: string) => Option.getOrThrow(fromString(`https://styld.test${path}`))

/** The app opened at a path, in English unless `locale` says otherwise, as the server starts it: signed in, the
 * request came with Ana's session cookie and her session has been read; signed out, it came with none and the
 * session is still being read. */
export const at = (path: string, options: { readonly signedIn: boolean; readonly locale?: 'en' | 'sl' }): Model => {
  const opened = init({ ...flags(options.signedIn), locale: options.locale ?? 'en' }, urlOf(path)).model
  return options.signedIn ? modifyFields(opened, { session: () => Session.SignedIn({ claims }) }) : opened
}

/** The open page's Model, through its lens; a test that reads a page that is not open fails. */
export const pageOf = <Child>(model: Model, lens: PageLens<Child, never>): Child =>
  Option.getOrThrowWith(lens.read(model.page), () => new Error(`The ${lens.slot} page is not open`))

/** The open page changed through its lens. */
export const withPage = <Child>(model: Model, lens: PageLens<Child, never>, change: (child: Child) => Child): Model =>
  modifyFields(model, { page: (page) => lens.write(page, change(pageOf(model, lens))) })

/** The app with the person's pieces read. */
export const withPieces = (model: Model, pieces: ReadonlyArray<Piece>): Model =>
  modifyFields(model, { data: (data) => modifyFields(data, { pieces: () => PiecesData.Success({ data: pieces }) }) })

/** The app with the person's boards read. */
export const withBoards = (model: Model, boards: ReadonlyArray<BoardSummary>): Model =>
  modifyFields(model, { data: (data) => modifyFields(data, { boards: () => BoardsData.Success({ data: boards }) }) })
