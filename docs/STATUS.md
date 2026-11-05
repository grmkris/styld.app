# Delivery status

The current state, 5 November 2026: where each release runs, the gates, what is built, and everything still open.
How each piece got here, with its evidence, is in the archive: `docs/archive/STATUS-2026-11-05.md` (4 and 5 November:
Eva's bug report, the board's Add sheet, the shop sections, the ghost-mannequin pictures, the API Worker's startup,
photo imports, Sport types, taste, the landing, plans, Google, try-on, house boards),
`docs/archive/STATUS-2026-11-02-to-2026-11-04.md` and `docs/archive/STATUS-2026-10-28-to-2026-11-02.md`.
`docs/DELIVERY.md` maps each kept feature to its acceptance. Deployed-or-not below is checked against each stage's
`/api/health` release with `git merge-base --is-ancestor`.

## Where each release runs

- **Production, https://styld.app:** release `e7e9989d` (5 November, 02:57). Frozen while the Meta hackathon is
  judged: the repository's default branch `hackathon` is locked at `e7e9989d`, and nothing is promoted until the
  owner says so. Everything recorded in the archived STATUS files is in this release, including the work whose
  archived heading still says "on main, not deployed" or "on a branch": the ghost-mannequin pictures and free redraws,
  the API Worker importing its application on the first event (`e9521988`), the cut-out sorted beside its photo, the
  four Sport types, taste and the first run, the landing with the rail's player and the assistants' screen, addresses
  as the only copy, the privacy and terms pages, the four plans, Sign in with Google, try-on, the board's Add sheet
  and the shop sections. v1 no longer serves styld.app (cutover of 4 November).
- **Preview, https://dev.styld.app:** release `a2742483` (5 November, 19:45): production plus the whole 5 November
  fix round below. Read back 3/3 (`tools/preview.native.test.ts`). Stages, accounts and the deploy are in
  `docs/DEPLOYMENT.md`.
- **On main, not deployed:** nothing beyond the preview's release.

## The 5 November fix round

A review against Rat Stack and Foldkit's conventions after the hackathon rush, fixed on main in tracks, deployed to
the preview and measured before and after (`tools/measure/`, results under `~/private/styld-research/measure/`).

- **Data:** no whole raw SQL statement is left; `patterns:check` refuses new ones in server, auth and tools. The auth
  tables have typed mirrors (`packages/db/src/authMirror.ts`, drift-tested). Store errors keep their operation and
  cause (`kernel/Db.ts`); a constraint failure outside a `fenced` write is a defect. The feed reads its boards and
  looks in one batch.
- **Server:** each text call names its provider; R2 deletes are durable (`media_deletions`, swept); erasing a chat
  answers before the Object ends and the caller confirms it; one piece search for Ask, MCP and Styld
  (`@styld/protocol` `PieceSearch.ts`); the assistants' tools live in `tools/`, not `mcp/`; module direction is gated
  in `graph:check` with a cycle allowlist that can only shrink.
- **Lifecycles:** pictures, captures, detections, turns, try-ons and generation jobs each have one `*Lifecycle.ts`,
  the only writer of their moves; the legacy picture states are backfilled (UPDATE only, no rebuild).
- **Web:** the board's Add sheet, chrome and editor are Submodels (its Message 101 → 18 variants); the camera is a
  ManagedResource; boards take signed-in state from the app (a stale-cookie retry bug fixed); colours in zyzz.
- **Text is Meta-only:** the public-words check, mood-board plans and Thinking answer with Muse Spark 1.3 like the
  chat; Styld no longer uses LiteLLM (owner, 5 November). Probed first (`tools/text-live.ts`): every answer decoded,
  the check agreed on every clear case; about twice DeepSeek's latency and ten times its price per call. Read back on
  the preview: a words check counted as `meta-spark`, 1.9 s, $0.0012.
- **Fence:** lefthook pre-commit (format, graph, patterns, suppressions, debt; about 2 s); `--no-verify` denied to
  agents; `debt:check` ratchet (`tools/quality/debt.json`); size budgets in `tools/budgets.json`, raised only in their
  own commit.
- **Measured (M0 `6329b6f3` → M3 `820e2509`, same account and journeys):** feed p50 1,371 → 689 ms; MCP search about
  18% faster; simple API reads within network noise (pieces 142 → 146 ms); page LCP close to M0; API CPU p99 169 →
  92–357 ms depending on the run. Census: raw SQL 30 → 0, errors without a cause 54 → 16, status literals 108 → 66,
  module cycles 22 → 18, largest Message 101 → 46, colour literals 21 → 2. An apparent SSR CPU doubling was runtime
  noise (the deployed bytes render alike in workerd; `~/private/styld-research/ssr-cpu-2026-11-05/`); the harness now
  loads each page fifteen times.
- **v1 is off:** its Railway services are down (Postgres and Redis kept), its domains, Dodo endpoints and DNS records
  removed, SPF trimmed (mail still passes SPF, DKIM and DMARC). Archived and verified first: both databases (all 66
  prod tables' counts match a restore) and both Tigris buckets, in `~/private/styld-v1/archive/`.

## Gates

`heavy --wait bun run check` runs, in order:

- `format:check` (oxfmt).
- `agents:check` (repoagents): the vendored skills in `.agents/skills` and the harness links and MCP files.
- `vendor:check` (`tools/vendored.ts`): the `repos/` snapshots, the `FOLDKIT.md` copy and the anti-slop lint rules'
  file hashes; the one vendored-hash gate.
- `icons:check`, `assistant-views:check` (generated files match their sources).
- `translations:check` (x18n): key parity between en and sl, missing translations, unused keys (errors), hard-coded
  strings.
- `i18n:check`: ICU syntax, argument and plural parity, approved rich tags, the generated catalog modules.
- `graph:check` (package boundaries), `patterns:check` (`tools/patterns-check.ts`, ARCHITECTURE › Patterns),
  `style-tokens:check`, `suppressions:check` (the census of reviewed suppressions), `canaries:check`.
- `typecheck`: effect-tsrs (TypeScript and Effect diagnostics) over the one root `tsconfig.json`; the planned
  web/workers split is not done (Open › Engineering).
- `lint`: type-aware Oxlint (backend: the `tsrs` package's `tsrs-lint`) with anti-slop; no explicit `any`, no non-null
  assertions, cyclomatic complexity ≤ 20, cognitive 15, function and file size limits.
- `unused:check`, `unused:production` (Knip; the gates are entries through `package.json`, the ongoing operator scripts
  are listed one by one in `knip.config.ts`, the one-off ones in `tools/once/` by one glob and its README).
- `duplicates:check` (jscpd).
- `build`, then `bundle:check` (the budgets in `tools/budgets.json`: the first browser load and all browser assets in
  gzip bytes, the SSR Worker, and the API and edge Workers' startup code as Alchemy bundles them), `test:unit`,
  `test:native:built` (workerd + Chromium through the real edge, on the same build).

The pre-commit hook (`lefthook.yml`, installed once with `bunx lefthook install`) runs the staged files' format,
`graph:check`, `patterns:check`, `suppressions:check` and `debt:check` in about two seconds.

## What is built

Each line is a kept feature; `docs/DELIVERY.md` maps it to the tests and readbacks that prove it. All of it is live on
styld.app.

- **Sign-in:** one six-digit email code for sign-in and sign-up, and Continue with Google (v1's OAuth client, linked by
  verified address); logout; account deletion (recorded as access ends, public content hidden at once, every store
  purged by the queue or the account sweep, a last prefix purge a day later); admins by sign-in email
  (`STYLD_ADMIN_EMAILS`). A first run over Home (Show me, house boards to save, occasions) once per account.
- **Adding clothes:** photos from the picker (JPEG where Safari cannot write WebP); the "hold it up" and "lay it out"
  cameras (Clef fires the shutter, front then back); videos up to 15 minutes cut into parts on the phone; add from a
  shop's page.
- **Cut-outs:** one garment pipeline (`capture/Garments.ts`): Clef routes, Cloudflare Images cuts out one garment, SAM
  splits several; a pair of shoes is one piece; a garment seen across a video is one card. Clef sorts the cut-out
  beside the photo it was cut from.
- **Review tray:** keep, drop or keep the original photo; "Already in your wardrobe?" matching; where Clef is torn, a
  one-tap chip offers the runner-up type; only a person turns a detection into a piece (assistant adds skip the tray).
- **Shop-style pictures and the turn:** Muse draws each kept cut-out as a gentle ghost mannequin (free) and a back only
  from a back the person photographed; a redraw is free and the person's words correct it; if Muse refuses the
  cut-out it is asked once more from the photo; Rotate turns the drawing too; the real photo is one swipe away; the
  quarter-turn on a hanger (Veo, 5 credits).
- **Wardrobe:** the shop's sections (Tops, Bottoms, Dresses & jumpsuits, Outerwear, Sport, Swim & lounge, Shoes,
  Accessories) over the types, with tops by sleeve and four Sport types; the person's own categories; season,
  occasions, pattern, brand and shop link (Clef suggests); filters held only by the address; select several to delete.
- **A piece's page:** the carousel (front, its back, then the person's photos), facts, edit, delete, "In your photos"
  and "In your looks".
- **Home:** the day, What to wear today (the wheel; Make outfits with it, Wear it today, Build my own), What's new from
  everyone (followed people first, Show me's choice next, by taste within), today's outfit, Challenges opening house
  boards, Pick up. Signed out, Home is the landing: the wardrobe's film, one screen per feature (the turning rail, Ask
  Styld, Styld in ChatGPT and Claude), the plans and four questions. No Explore page.
- **Outfit engine:** Fast (rules propose, Clef ranks) and Thinking (a text model proposes, rules check, Clef ranks),
  Thinking at most 50 a day; a day's occasion from the person's taste; measured per mode in Analytics Engine
  (`tools/ai-usage-report.ts`).
- **Looks:** made by the assistants, by Styld or from a photo; listed, opened, shared one at a time and deleted.
- **Boards:** a grid of pins with a hand-edited collage (move, pinch, turn, layer, label, undo, Save as a look); one Add
  sheet for pieces, looks, Gallery photos and try-ons; edited in place (title, Public switch, ⋯ options); outfit boards
  in centred layouts with Another layout; Save to board from pieces, looks, photos and try-ons.
- **House boards:** 53 boards on `@styld.women` and `@styld.men` from 173 generated pieces (always marked Generated),
  en with sl translations; Try with my wardrobe builds a private board from the person's own pieces.
- **Stickers and mood boards:** a sticker drawn from words (1 credit, marked Generated); a mood board of the person's
  own pieces from one sentence, pinned and laid out (1 credit).
- **My Gallery:** the person's own outfit photos (1 credit to find the clothes), matched to pieces (any piece of the
  wardrobe, or added by hand), favourites, Wear it again, Add to board, Cut out the outfit, a missing garment offered
  to the tray.
- **Try on:** one of the person's own Gallery photos redrawn by Muse wearing their pieces or a look (2 credits, "This is
  me" required), in the Lab and from Styld's chat and the assistants; the result can go on a board.
- **Styld, the stylist:** a chat at `/ask/stylist` over the person's own pieces and looks (Meta Muse Spark 1.3,
  Standard, on Meta's API), 1 credit a message; it remembers notes only after a yes. Account › What Styld knows about
  you shows and removes them.
- **Public profile and social:** `/@handle` with Boards and Looks; public boards, looks and pieces with share links and
  link previews; Save, one-way private Follow, Block, Report; readable signed out.
- **Safety:** every public item is checked first (Clef for pictures, DeepSeek through the paid LiteLLM gateway for
  words); unsure stays out of discovery, failed is hidden with a notice; three reports hide; admin MCP tools hide,
  restore and feature.
- **ChatGPT and Claude (MCP):** OAuth (CIMD and DCR), Styld's own consent page and immediate revoke at `/mcp`;
  noun_verb tools over the same operations; MCP Apps views (`views-v3`: wardrobe, board, pieces, outfits, Gallery,
  try-on) inside the host.
- **Credits and plans:** 3 free credits once, then Week ($4.99), Monthly ($20), Yearly ($200) or Lifetime ($349), each
  500 credits a day, through Dodo Payments with its customer portal; held before paid work and settled once by the
  Domain Wallet; a lost provider answer refunds.
- **Languages, legal and telemetry:** English and Slovenian everywhere; `/privacy` and `/terms`; browser telemetry only
  after consent.
- **Operator tools:** the v1 importer (`tools/import-v1/`), the lifetime grant (`tools/grant-membership.ts`), the house
  seed (`tools/seed/`), the AI usage report, the live provider probe, the preview capture, and the one-off backfills
  and re-sorts in `tools/once/`.

## Open

Nothing below is done until its acceptance is recorded in `docs/DELIVERY.md`.

### Acceptance walks (phone and desktop, en and sl)

- Eva's phone (Samsung, Android Chrome, dark mode) on everything from her 2 November review and after: Home, the
  wardrobe's sections, boards, Gallery, the camera, Rotate on her top, the carousel in light and dark, the torn-type
  chip on a real capture, her Sport types.
- From Eva's bug report #1: the outfits sheet's Make button in view, the sparkle and tinted wheel, outfit boards
  without holes; the blank beige tiles under Home › What's new in her recording.
- The board page on a phone and a desktop: each Add kind, rename, the Public switch, ⋯; placing a photo from its own
  page (a table key per picture) is not walked in a browser.
- The first run, Account › What Styld knows about you and Styld's memory in en and sl.
- The landing on a phone; Home's desktop arrangement is a proposal (Eva's sketch was phone-only).
- A live try-on with Kris's photos; the ChatGPT and Claude walk with the new tools and `views-v3` (refresh the
  connector).
- Show me's order and Try with my wardrobe with a test account on the preview.
- A live Google sign-in on the preview: `STYLD_GOOGLE_CLIENT_ID` and `STYLD_GOOGLE_CLIENT_SECRET` (v1's, from Railway)
  in `.env.preview.local`, and the preview's callback added to v1's client in Google Cloud.
- Payments: Dodo's webhook endpoints (preview and production) also sending subscription.active, .renewed,
  .plan_changed, .cancelled, .expired, .failed and .on_hold; a test-card purchase of each plan on the preview (and
  STYLDJUDGE on the Week), the portal, a cancellation.
- Deployed readback of `/privacy` and `/terms` on the preview.
- Signed-in walks in en and sl on phone and desktop (`docs/TESTING-GUIDE.md` for the testers).

### Gates and native runs not recorded

- The full gate with the native suite on production's `e7e9989d`. Written and not recorded as run there:
  `CleanPictureAcceptance` (free redraw, back picture, `ended`), `CaptureAcceptance` (a front and its back cost 1),
  `WardrobeAcceptance`, `BillingAcceptance`, `TryOnAcceptance` and `TryOnBrowserAcceptance`, McpAcceptance's `views-v3`,
  `SeedAcceptance`, `IdentityBrowserAcceptance`, `SocialAcceptance` (What's new), `verifyHome`,
  `NavigationBrowserAcceptance`, `GalleryBrowserAcceptance`, `BrowserAcceptance` (the landing), the stylist journey's
  memory, `GoogleEntry`.
- The native suite's shared local D1 answers `SQLITE_BUSY` under load; the gallery browser journey ("sideways scroll")
  flakes under box load (rerun alone with `-t "lays out today"`).
- A live authenticated readback of a redraw, a turn, a capture retry, a Gallery photo and a cut-out under concurrent
  requests (native acceptance with fake providers passed).
- C8's browser review: F1 (a Slovenian then English chat on the preview) and F7 (`POST /api/outfits` timing on a cold
  visit).

### Operator runs and content

- Redraw Eva's account with `tools/once/backfill-pictures.ts <email> --redraw`, so every picture shares the
  ghost-mannequin style; `--ended` for the testers; `--backs` for the testers' 1–3 pieces with a back (waits for the
  owner's go). Face-kept 'kept-real' rows are not covered by `--redraw`.
- `tools/once/retype.ts sleeves` is not recorded as run on any database; `retype.ts sport` on the preview's copy;
  `retype-pieces.ts --apply` on the preview. Eva's production types are hers now: no further re-sorting of her
  wardrobe unless she asks.
- House boards: the three unsure checks on production (`w-carry-on-7d`, `m-prep-3`, `w-updated-lady`) and
  `w-witch-october` on the preview, for a person to look at; production's `curation_house` for both handles and the
  report's `curation_feature` calls; Eva's review of the Slovenian copy and the sl chip ("Ustvarjeno" or "Ustvarjeno z
  UI").
- The landing's media (`pile-*`, `coat-board-*`, `turn-*`, and the card's `shop-*`) in each stage's bucket: no
  readback recorded.
- The prompt comparison page is public on Kris's personal Cloudflare account
  (`sp-5693ef40dbde.kristjan-grm11775.workers.dev`): take it down after Eva's review.
- The operator's lifetime grants: the owner confirms the list.
- The Ask Styld readback left a "Readback autumn" look on the test account (deleting it answered 400).

### Product gaps

- Guided camera (T-01, T-05): full foreground extraction, a Front/Back preview on the review card, garment-contour
  detection, and face/no-garment recognition with the real providers.
- Navigation (T-06): the physical Android Back button on the wardrobe filters and the Gallery.
- Categories (T-12): custom categories under a built-in type, suggested in the review tray and made on keep.
- Android (T-20): the share sheet and the gallery picker on a phone; the Chrome tab-restore black screen was never
  reproduced.
- Signed media (T-21, F-43): loading under load, Workers Logs, and the addresses refreshing after they expire.
- From Eva's bug report #1, after the demo: a simpler Home (Eva to name the sections); the bad cut-out and the T-shirt
  typed as a bodysuit; automatic rotation; the crash after a mass upload.
- Pictures: cut-outs stored upside down without a rotation get their print moved to the hem; a bodysuit was typed
  "trousers" at 50%; a crossed or Y-shaped back strap or a tie is sometimes drawn plain, and a back photo drawn as a
  front; the lace-up knit, the cross-strap top and the printed tee (cut-outs of the back) come back plain; a wording
  for cut-outs of a back. Out of scope: drawn side views, backs from video scans, a paid redraw of the back.
- From 900 px up, a 90° or 270° turn overflows the non-square picture box (as the photo and cut-out already do).
- Leggings and sport pieces stored under other types (trousers, shorts, tops, swimwear) are not re-read; whether the
  photo beside the cut-out moves new captures into the right types is unmeasured.
- Taste: Challenges themselves (cards open house boards until then); funnel metrics (Kris: not now); no type preset on
  Add clothes; aesthetics show as the catalogue's slugs in both languages; a Discovery test of `challenges` over D1.
- What's new: re-publishing a board moves it to the top again; items sharing the cursor's exact millisecond can be
  skipped at a page boundary.
- Plans: a member who spends all 500 of a day sees the "3 free cut-outs are used" refusal on the website (its pages do
  not know the plan; the assistants get `dailyCredits`); a subscription payment's refund changes nothing by itself. A
  payment for an account deleted since its checkout is answered 200 and logged for a refund by hand.
- Google: the first Google sign-in of an existing account signs its other sessions out once.
- Legal: Kris reviews the content (no operator, company, address or governing law named, as in v1; the minimum age of
  16 is v1's and not enforced); check that the policy's Dodo wording matches the checkout.
- Try-on: a remembered default photo; the later views (ROADMAP).
- My Gallery has no readback on a real worn photo; favourites are not yet clues for the engine or Styld; why 2 of
  Eva's photos still find nothing after the re-find.
- The piece page lacks "Create board"; link import does not read the brand.
- Not built: a composed link-preview image, follows and blocked lists on the website, the "people I follow" search
  filter.
- `tools/once/relayout-boards.ts` with several emails answered 404 for the first; one email per run works. Not
  reproduced.

### Engineering

- Startup: the API Worker's entry is 174,609 bytes with 650,846 of static shared chunks (825,455 together, gated in
  `tools/budgets.json`); the first event pays the Application chunk's 640–780 ms of CPU, so a cold visitor waits about
  as long as before. Not yet read back with `cold.ts` and Workers Logs (no "hung", no startup errors) on a deploy.
- Every deploy is felt as a hang: a fresh isolate's first requests wait about 6 s in Yielded Auth's session-store setup
  (catalog reads, Google's openid-configuration), and a thumbnail's Images transform adds up to 7 s.
- Image work shares the API's isolate: moving piece processing into its own Worker would keep it out. The capture
  matching fix (`Comparable.ts`, batch size 1) is unexercised by a real import since. A thumbnail answering 304 still
  spends about 300 ms of CPU.
- MCP clients get 404 on `/api/auth/oauth2/token` and `/.well-known/openid-configuration`.
- Home waits 4–6 s for its first table while Clef ranks twelve candidates; Thinking takes about 15 s. A Thinking call
  that times out is retried while busy (up to three more times) inside a synchronous request.
- A paid text call can consume up to its 45-second stylist deadline; ambiguous gateway outcomes are kept as unknown and
  not retried. Cloudflare Images answers 9529 ("too busy") in bursts of about 90 cut-outs a minute; the queue absorbs
  it. The runtime's own `r2_get` span reports a judging-picture cache miss as an error.
- The Wallet's Durable Object (state and command receipts) is not purged with the account: Alchemy Domain beta.85
  exposes no way to erase an aggregate's storage.
- No tool lists pending Wallet holds; `pending_settlements` holds every one the Wallet has not confirmed settled (a D1
  query reads them), and the `settlements` sweep logs how many it settled.
- A video Meta accepted whose response loses its file ID cannot be reconciled without provider support; if the ID comes
  back but durable recording and immediate deletion both fail, cleanup is best effort.
- `AccountLifecycle` takes its bindings as a record; `mcp/Sdk.ts` still answers the MCP SDK's older protocol era
  (`answerLegacy`); the auth storage tables stay exported from `@styld/db` for Drizzle Kit; `capture/Providers.ts` and
  the stylist's and language model's `(parts) =>` records remain beside the services.
- Production still calls DeepSeek through Railway's LiteLLM until it is promoted; promoting it needs its env file's
  `STYLD_LITELLM_*` removed (no new secret: `META_MUSE_API_KEY` already feeds the chat).
- Bisect the API's ~10 ms per read seen in M1's spans (session lookup 19 → 22 ms) once more runs separate it from noise.
- The camera as a ManagedResource is not yet read back on an iPhone.
- The garment pipeline's 512 px model input and the pair rule need the fixture comparison and one real photo per intent
  read back on the preview (C4a).
- C7's web/workers tsconfig split is not done: the native suite imports the server's source and runs Playwright
  callbacks that need the DOM lib, and tsrs has no build mode or project references, so the server's stream casts
  (`CloudflareImages.ts`, `Meta.ts`, `Wardrobe.ts`) stay.

## Owner decisions pending

- **Production:** when the hackathon freeze ends and what is promoted first.
- **v1 deletion (irreversible, after judging and a 7-day grace):** the Railway `stylelab` project with its databases
  and volumes, the Tigris buckets and keys, LiteLLM's `styld-dev`/`styld-prod` keys, the `stylelab` CI runners, v1's
  PostHog, Sentry and Inbound keys, archiving `grmkris/stylelab`; and in Google Cloud Console, the dev.styld.app
  redirect on the shared OAuth client (keep the client).
- **Gate 1:** rate the ~60 calibration outfits (Fast against Thinking) on the rating page; feeds M4.
- **My Gallery readback:** a worn outfit photo.
- **Labels:** Flats against heels (the owner's Derby shoes are typed heels).
- **Boards:** the declutter (the merged Save as a look and the trimmed toolbar), proposed and not confirmed.
- **House boards:** the sl chip's wording; the featured picks (`tools/seed/catalogue.yaml`).
- **Backs:** the go for `--backs` on the testers' pieces.
- **Order of M4–M9** after the testers' findings (`docs/ROADMAP.md`).
- **Screen review topics:** where Styld lives, what Home is for, credits and settings on Account, Mine/Saved on boards,
  the landing's lead.

## Next

The full gate with native passed on `a2742483` (unit 1,385, native 38/38, 5 November). Then Eva's phone walk of the preview and the acceptance walks above, each outstanding `docs/DELIVERY.md` row, and the
production promotion on the owner's go once judging ends.
