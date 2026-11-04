/**
 * The website's size budgets, read from the build `bun run build` writes to `apps/web/dist` (`bun run check` runs
 * the build, then this, then the tests; the native suite serves the same build).
 */
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { Schema } from 'effect'

const Chunk = Schema.Struct({
  file: Schema.String,
  isEntry: Schema.optional(Schema.Boolean),
  imports: Schema.optional(Schema.Array(Schema.String)),
  css: Schema.optional(Schema.Array(Schema.String)),
})
const Manifest = Schema.Record(Schema.String, Chunk)
const client = 'apps/web/dist/client'
const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
  await readFile('apps/web/dist/client/.vite/manifest.json', 'utf8'),
)
const gzipOf = async (file: string) => gzipSync(await readFile(`${client}/${file}`)).byteLength

// Initial assets: the entry chunk, everything it imports statically, and their stylesheets.
// Dynamic imports (such as the telemetry SDK's never-enabled replay recorder) load on demand.
const initial = new Set<string>()
const visit = (key: string) => {
  const chunk = manifest[key]
  if (chunk === undefined || initial.has(chunk.file)) return
  initial.add(chunk.file)
  for (const css of chunk.css ?? []) initial.add(css)
  for (const imported of chunk.imports ?? []) visit(imported)
}
const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry === true)
if (entries.length === 0) throw new Error('No browser entry in the client manifest; build before checking budgets')
for (const [key] of entries) visit(key)
const all = new Set(Object.values(manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]))

let initialGzip = 0
for (const file of initial) initialGzip += await gzipOf(file)
// Every page loads one language's messages before it hydrates; count the largest one.
const catalogs = Object.entries(manifest).filter(([key]) => /packages\/i18n\/src\/catalog-[a-z]+\.ts$/.test(key))
if (catalogs.length === 0) throw new Error('No language catalog chunk in the client manifest')
initialGzip += Math.max(...(await Promise.all(catalogs.map(([, chunk]) => gzipOf(chunk.file)))))
let totalGzip = 0
for (const file of all) totalGzip += await gzipOf(file)
const server = await readFile('apps/web/dist/server/fetch.js')
// Raised from 256 and 512 KiB by the owner on 2026-10-30 for Gallery 2 and boards (docs/STATUS.md › Overnight run),
// and the initial budget once more, to 360 KiB, for boards, profiles and social, because Foldkit ships every page in
// the first load (owner, 2026-10-30; docs/STATUS.md › Plan: boards, profiles and social). Ratcheted on 2026-11-01 (C6)
// to the measured 347,259 bytes plus 3%, once the telemetry SDK loaded only after consent. Raised to 359,000 on
// 2026-11-03 for Ask Styld's live replies: main measured 357,238; following a reply's LiveText adds 963 (the page's
// subscription and settling, 570; Schema and Stream shared with the lazy decoder chunk, 399), the decoder itself
// loading only while a reply is written. Styld's own dark theme (T-18, 3 November 2026) adds 1,475: every colour a
// light/dark token pair in the first stylesheet. With main's Gallery photo work (T-17, 6e5c21d alone measures 358,117)
// the three measure 361,785, so 362,500. Raised to 363,500 on 2026-11-04: main measured 362,480 before the person's
// own categories (T-12, b210567), which add 782 (the category field, its chips and their cards), and the add page's
// own words for a refused upload (3ba3213) add 98, for 363,360. Raised to 364,500 on 2026-11-04 for T-16: keeping a
// look on a board (6885ee4) adds 23 (its endpoint in the client's API), the collage editor's Select mode 1,090 (its
// Messages and tick state, the ticked outline, Select/Done and the counted Save, and their words), for 364,473.
// Raised to 367,700 the same day for T-10: the board's outfits, the two outfit-board endpoints and the complete flag in
// the client's contract add 279 (364,752 on main at ac0e345), and the outfit cards 2,926 (their submodel with its card
// states and two Commands, the cards' view and styles, and their words in both catalogs), for 367,678.
// Raised to 370,300 the same day for F-26 and T-10's chooser: main measured 367,690 at 0eedb27; the new-board sheet
// adds 2,594 (its submodel with the outfit board's Command, the templates, the piece and season steps, and their words),
// for 370,284.
// Raised to 371,970 on 4 November for T-12's category rename and delete: main measured 370,289 at 5e46306; the
// category page's edit (its state, two Commands, the rename form and the delete question, and their words) adds 1,665,
// for 371,954.
// Raised to 372,150 on 4 November for P4's tops by sleeve: main measured 371,987 at 4b35623; the three types that
// replace Tops & T-shirts (their names, singular names and search words in both catalogs) add 140, for 372,127.
// Raised to 373,500 on 4 November for a photo's garment chosen from the whole wardrobe (Eva): main measured 372,127 at
// f999c7c; the shared piece sheet on the Gallery photo page (its state and folds, the search field and its words, each
// piece's caption, and the photo's sheet Messages) adds 1,330, for 373,457. Raised to 374,000 the same day for a piece
// added to a photo by hand: its endpoint in the client's contract, the sheet's two purposes, the add button, the empty
// photo's words and Remove add 458, for 373,915.
// Raised to 376,000 the same day for Eva's board layouts (B2/B3): the layouts and their arrows in the shared contract,
// the arrows on the table, Another layout (its state, Command and control, and their words) add 2,004; measured
// together at 375,823.
// Raised to 378,000 the same day for deleting several pieces from the wardrobe grid (T-24): main measured 375,823 at
// c2a1d5f; the batch delete's endpoint in the client's contract and the grid's Select mode (its submodel with the
// selection, the delete Command and its retry under the same id, the ticks, the bar and the question, their styles and
// their words in both catalogs) add 2,164, for 377,987.
// Raised to 379,600 the same day for the piece's picture carousel (P3): its slides, the swipe, the dots and "Use as
// the main picture", and their words, add 1,583; with the seated-person fallback beside it main measured 379,609.
// Raised to 383,200 the same day for Eva's Home (docs/archive/PLAN-home-2026-11-04.md): taking Explore's page out saved 4,495
// (379,609 to 375,114 at dcef50c); What's new, Challenges and the Home layout brought it to 379,531 (M5); the tombola
// (its submodel, the wheel, the screen and its Mounts, the dice and their words) adds 3,627, for 383,158.
// Raised to 383,700 the same day for Wear it today (M7): the anchor through Today's outfit run, the swap around it,
// the "Outfits around" line with its way back, and their words add 545, for 383,691.
// Raised to 384,600 the same day for the tombola's boards (M8): Make outfits with it and Build my own (their state,
// the two mapped requests, the board opening, the actions and their words) add 888: HEAD measured 383,692 in a clean
// worktree at 7fa62f2 and 384,580 with them.
// Raised to 384,900 the same day for the backs track's carousel (M3, 36a1c027): angles first, the back's drawn slide
// and its words add 291 over f7852a6f's 384,584, for 384,875.
// Raised to 385,000 the same day for the house boards' Generated mark (docs/PLAN-house-boards-2026-11-04.md, S2d):
// `generated` on public pieces, looks and boards in the client's contract, the mark with its hint on board cards,
// look tiles, the public board, the piece page and What's new, and the hint's words add 175: HEAD measured 384,772 in
// a clean worktree at 3cdb7a61 and 384,947 with them.
// Raised to 387,300 the same day for Show me (the house boards' plan, S3): Home's card above What's new, the Account
// page's choice, their shared program (the preferences read, the answer and its save), their styles and the en/sl
// words add 2,284: HEAD measured 384,947 in a clean worktree at 376edb41 and 387,231 with them.
// Raised to 388,000 the same day for Try with my wardrobe (the house boards' plan, S3): the button on a public board
// that shows generated pieces, its request and retry under the same operation, the count and the way to the new board,
// and their words add 808: HEAD measured 387,150 in a clean worktree at d377d399 and 387,958 with them.
// Raised to 388,200 the same day so Show me's card never moves Home: the browser's cookie that it saw an answer, read
// into the page's flags, and the Account page's choices standing from the first paint add 203 over 42da42aa's 387,958.
// Raised to 391,400 the same day for Sign in with Google: the auth contract's two OAuth actions (Yielded's sign-in input,
// authorization and completion schemas reach the browser client), Continue with Google with its mark, the start and
// the noted return, and their words add 3,154 over 42da42aa (387,958 to 391,112).
// Raised to 392,300 on 4 November for the first-run polish (Track W): a whole code sending itself and the resend
// countdown (its Subscription and seconds), the diagnostics prompt waiting for sign-in, Home's first piece, cutting and
// how-many-more lines with the tray's allowance, the add page's cost line with its allowance read, and their words
// add 887: main measured 391,351 in a clean worktree at 9b5e923a and 392,238 with them.
// Raised to 392,400 on 4 November for what Styld knows about the person (taste, L1): the client's contract gains the
// taste group (its read, the occasions, notes and first-run writes, their schemas and the notes' limit) and adds 87:
// main measured 392,238 at 03299488 and 392,325 with it.
// Raised to 392,900 the same day for the wardrobe's address as its only copy (Foldkit's query-sync): the lenient
// per-parameter codecs, the browse's normalising and ReplaceBrowse add 444 (main 392,390 at 89f4a29 and 392,834 with
// it, each measured in a clean worktree).
// Raised to 393,000 the same day for Styld taking Ask's question once (addressInPlace and samePageArrival): 49 more,
// 392,864 to 392,913 on main.
// Raised to 394,600 on 4 November for Styld Premium Week (payments): the account's Credits section (its read, the
// return poll, the checkout's Command and states), the way to more credits beside every refusal of the day's credits,
// and their words add 1,687 (main 392,913 at d64d4d64 and 394,600 with it).
if (initialGzip > 394600) throw new Error(`Initial browser assets exceed the 394,600-byte gzip budget: ${initialGzip}`)
if (totalGzip > 716800) throw new Error(`All browser assets exceed the 700 KiB gzip budget: ${totalGzip}`)
if (server.byteLength > 3145728) throw new Error(`SSR Worker exceeds the 3 MiB source budget: ${server.byteLength}`)
console.log(
  `Bundle budgets: initial browser ${initialGzip} gzip bytes; all browser ${totalGzip}; SSR ${server.byteLength} source bytes`,
)
