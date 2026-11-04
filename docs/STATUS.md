# Delivery status

Status as of 4 November 2026. Everything on `main` through `f7852a6f` is deployed to the isolated preview (deployed by
`styldappv2-51`; its full gate with the native suite ran after the deploy). Phone, live-provider and owner acceptance
listed below stays open. The history of 2 to 4 November (the cleanup's C8 fixes, Eva's review batches 01–05 and the
4 November tracks) is in `docs/archive/STATUS-2026-11-02-to-2026-11-04.md`; earlier milestones are in
`docs/archive/STATUS-2026-10-28-to-2026-11-02.md`. The Eva review tracker was retired on 4 November; what it still
held open is the section below.

## Styld learns the person: taste, memory, first run (4 November, on main)

Kris's plan of 4 November (`~/.claude/plans/okay-so-please-look-sprightly-brook.md`), built as a track of its own
beside the house boards, after reviewing the Grokbot inspiration-boards research.

- **Taste** (`89f4a292`, migration `20261104174849_taste`, two new tables): the occasions a person dresses for, the
  first run's end and the notes they asked Styld to remember (at most 30); what Styld learned is read on demand (90
  days of worn days, kept looks, favourite Gallery photos, saved boards' aesthetics). `/api/me/taste*` and the MCP tools
  `taste_get`, `note_add`, `note_list`, `note_delete`, `occasions_set`. Deployed to the preview by styldappv2-51 and in
  production through `4361388e` (styldappv2-0f).
- **Styld** (`668fb7ee`): each reply is told what Styld knows, as data (Show me as which boards come first, never who
  the person is); it asks before remembering and calls `note_add` only after a yes; `saved_list` and the notes are in
  its catalogue.
- **Outfits** (`6e6e2e5d`): a day's outfits asked for no occasion take the day's (smart on weekdays for someone who
  dresses smart, else casual); Thinking hears what they wear most and their notes.
- **Account › What Styld knows about you** (`1c904c9f`): occasions as chips, the notes with Remove, the learned line.
- **What's new by taste** (`58969964`): on each page, inside Show me's bands, boards sharing the reader's saved boards'
  aesthetics come first; nothing is hidden and the cursor is unchanged.
- **Challenges** (`4361388e`): Eva's three cards open the seeded house boards (`u-30-days-red`, `w-witch-october`,
  `u-one-coat-6`) through `seeded_boards`; "Coming soon" until one exists.
- **First run** (`66f99166`): a modal over Home, once for every account (testers included): Show me (through the
  preferences the card writes), up to 12 house boards to save, the five occasions, then Done onto Home's first-piece
  card (Kris: one way into Add clothes). Each answer saves as given; reaching the last step or Skip all marks it done.
- **Add these** (`f4f96260`): Try with my wardrobe's answer names the kinds the wardrobe lacked, listed under the result
  with the way to Add clothes.
- **Evidence:** unit, story and scene tests for each (taste store on local D1 with cascade and CHECKs, `tasteOf` and
  the day rule's truth tables, the prompt paragraph and memory rule, the engine's occasion and Thinking lines over D1,
  `byTaste`, the Account section, the first run's steps and screen, Challenges' cards, Try's `missing`); the native
  stylist journey gains "Yes, remember: Never heels" → kept → listed → a new chat is told it (written, not run here).
  Cheap checks green on every commit; the initial bundle rose by measured amounts (403,152, budget 403,200).
- **Open:** the native suite and a preview walk of the first run, the Account section and Styld's memory in en and sl;
  Challenges and the first run's boards show real boards only after the seed's `--full` run; funnel metrics (Kris: not
  now); no type preset on Add clothes (the capture types each piece); aesthetics show as the catalogue's slugs
  (`city break`) in both languages; a Discovery test of `challenges` over D1.

## Addresses as the only copy: the wardrobe's filters, Ask's search, Styld's question (4 November, on main, not deployed)

The wardrobe's filters (T-06) were kept twice, in the page's Model and in the address, and one bad parameter made the
page Not found. Rebuilt the Foldkit way (query-sync; ARCHITECTURE › Website): commits `f67b6a92`, `ca2ce12f`, `37c3a735`.

- **Built:**
  - The wardrobe reads its group, type, category and filters from `/wardrobe?…`. A filter replaces the address (no Back
    step) and a step to another level pushes. Each type opens unfiltered, and Back returns to the filtered list.
  - A parameter that is not ours (`?group=nonsense`, `?rainproof=no`, a type renamed since) is left out instead of Not
    found; the address is not rewritten.
  - A category renamed or deleted after the person browsed elsewhere leaves the address alone.
  - Ask's field shows `?q` as typed, a trailing space included. Every key replaces the address; people and boards are
    searched once typing pauses, at once on Enter, and at once on Back to `/ask?q=…`.
  - Styld takes `?q` into its draft once and the address drops it, so a reload does not bring a sent message back.
- **Evidence:** `wardrobe.story` (the address printed and read back, the lenient reading, each filter's replace, the
  rename race), `wardrobeSelect.story`, `wardrobe.scene` and `navigation.scene` (the replace and its address change),
  `navigation.story` (Styld's hand-over, Back to an Ask search), `ask.story/scene` (a trailing space through the replace,
  the pause, Enter), `Rendering.test` (a bad wardrobe link renders the wardrobe). Native, written and not run:
  `NavigationBrowserAcceptance` (Winter in the address, reload, Clear, a bad link opens the groups) and
  `GalleryBrowserAcceptance` (Styld's address drops `?q`). The bundle grew by 444, 49 and 265 gzip bytes.
- **Open:** the preview deploy, the full gate with native, and the readback (`styldappv2-51`): filtering adds no Back
  step and survives a reload; `/wardrobe?group=nonsense` opens the groups; Ask keeps a trailing space and Back to a
  search searches; a reload on Styld after sending starts empty.

## Privacy policy and terms of use (4 November, on main, not deployed)

Google sign-in's consent screen and the app directories need both pages on styld.app.

- **Built:** `/privacy` and `/terms` (`AppRoute.Privacy`/`Terms`, `page/LegalView.ts`), readable signed out, linked
  from the footer beside Contact on every page (the sign-in page has no small print of its own; its footer carries
  them). The words are in the en/sl catalogs under `legal`. Each statement was checked against the code; Premium Week
  against `premiumWeek` in `Prices.ts` ($4.99, 500 credits a day for 7 days, buying again extends).
  The sections' words (`legal.privacy.*`, `legal.terms.*`) are their own catalog modules (`legal-en.ts`,
  `legal-sl.ts`) that the browser loads only on those two pages, so no other page carries them; the first load grows
  by about 1,100 gzip bytes (393,989 at d64d4d64; budget 394,100).
- **Evidence:** `apps/web/test/legal.scene.test.ts` (every section, the date and the contact address in en and sl; the
  footer links signed in and out), `legalRoutes.test.ts`, and the i18n test of the legal words' loading.
- **Open:**
  - Kris reviews the content. v1 names no operator, company, address or governing law, so neither page does; the
    minimum age of 16 is v1's, not enforced in v2. Docs' "original photos never leave Styld" is not true: a resized
    copy of each photo (and each video) goes to Meta SAM, so the policy says so.
  - The pages describe Dodo Payments and Premium Week (server on main at `eb92789e`). The policy says Dodo takes the payment; check that matches the checkout.
  - Deployed readback of both paths on the preview.

## Styld Premium Week: payments through Dodo (4 November, on main, not deployed)

Owner decisions of 4 November: $4.99 once (no subscription), 500 credits a day instead of 100 for 7 days from the
purchase, buying again extends from the current end, bought mid-day it tops today up at once; free stays 100 a day and
no card is ever asked for.

- **Built:** the Wallet records the allowance each day was granted and tops up a larger one the same day (old events
  replay as 100; `Wallet.story`); migration `20261104181042_premium_week_purchases` (plain CREATE TABLEs `purchases`,
  keyed by Dodo's payment id, and `premium`, the one record of an account's end); `server/src/billing/`:
  `GET /api/credits`, `POST /api/billing/checkout` (Dodo's `POST /checkouts`), the raw `POST /api/billing/dodo/webhook`
  (Standard Webhooks with WebCrypto, 5 minutes' tolerance; only the stage's product counts; one D1 batch per delivery,
  idempotent on the payment id; refunds and lost disputes take the week back once, never before now); holds reserve
  under premium's allowance through one function (`billing/Premium.ts` › `allowanceAt`, `usage/Holds.ts` › `balance`).
  Web: the account's Credits section (today's credits, Premium until, Premium week · $4.99 opening Dodo's page; back on
  `/account?premium=1` it says the payment arrived and reads the credits again every 3 s, 8 times); every refusal of
  the day's credits links to it. Unit `Billing.test` (the Standard Webhooks reference vector, product filter, a payment
  twice is one purchase and one week, refund and dispute once), `account.story`/`account.scene`; native
  `BillingAcceptance` (a stage without payments) written, not run.
- **Open:** deploy with `STYLD_DODO_API_KEY` and `STYLD_DODO_WEBHOOK_SECRET` (test mode on the preview), then a
  test-card purchase on the preview: the webhook's 200, the purchase row, 500 a day and the top-up, a refund taking the
  week back; then production's live readback after the cutover. A payment for an account deleted since its checkout is
  answered 200 and logged (`Styld.Billing a payment arrived for an account that is gone`) for a refund by hand. The
  initial bundle budget rose by 1,687 bytes to 394,600.

## Sign in with Google (4 November, on main, not deployed)

The owner chose Google sign-in with v1's OAuth client and v1's linking, from Grok's competitor onboarding report.

- **Built:** `94dc82d6` (server: the `google` strategy, migration `20261104172833_google_sign_in` with three plain
  CREATE TABLEs, `GoogleEntry.ts` linking by verified address, the callback at `/api/auth/callback/google`, deletion
  purge, a sweep for unfinished sign-ins) and `9b5e923a` (Continue with Google on the sign-in page, `next` noted for the
  tab, `/login?problem=google`).
- **Open:**
  - The preview needs `STYLD_GOOGLE_CLIENT_ID` and `STYLD_GOOGLE_CLIENT_SECRET` (v1's, from Railway) in
    `.env.preview.local`; `STYLD_AUTH_OAUTH_KEYS` is there. The preview's callback must be added to v1's client in
    Google Cloud.
  - Unit (`GoogleEntry.test`), the batch's native run, and a live sign-in on the preview.
  - The first Google sign-in of an existing account signs its other sessions out once (Yielded's import advances the
    security revision).

## Pictures that look like a shop's, and a piece turned to its back (4 November)

Eva saw her shop-style pictures as plain cut-outs, and found swiping through three pictures of the front pointless.

- **Pressed prompt (deployed, `ddc35b45`).** Muse really drew each picture, but the prompt asked for "this exact
  garment … its real fabric", so it copied every crease. The owner chose "pressed" from six prompts tried on 23
  testers' pieces. The comparison page is private, its harness in `~/code/meta-hackathon/out/styld-shop-picture/`.
  Text and logos stayed legible on all 12 printed pieces, and production's Clef check passed 22 of 23 drawings
  under every prompt; the boots always fail.
- **No drawing check and no face gate (worktree track, `fc84b7b0`, `3ee38946`, not merged or deployed).**
  - The owner's decision: Clef's compare rejected 24 of about 470 drawings on 4 November. Drawn again, 11 passed
    (noise), and only about 5 of the rest were really wrong. A person can always swipe to the photo.
  - Every drawing Muse returns that keys and frames cleanly is shown ('ready'), front and back. No compare call is
    made, and `gateFor`, the reject bar and `GarmentVision.compare` are gone.
  - A drawing left in 'checking' by an earlier release is shown when it is next processed.
  - Clef's judgement no longer asks about a face. A fragment still asks for a retake. A back is drawn without a
    judgement, and so is a paid redraw. The redraw's `face` refusal is gone from the API, the page and both catalogs.
  - The `face` columns stay without a migration and are no longer written.
  - Unchanged: Clef's reading of type, colours and sleeve; the whole-garment scrap bar; what Muse is given; the
    capture's person routing; the camera's holding question; Muse's own safety filter.
  - Evidence: unit `Drawing.test` (lifecycle over real SQLite: shown with no Clef call; a failed key stores nothing;
    a legacy 'checking' row is shown) and `CleanPicture.test` (no face question; a cut-out Clef sees a face in is
    drawn). Native `CleanPictureAcceptance` (Clef's stand-in sees a face everywhere and refuses compares) was
    written for this but not run.
  - Open: existing 'rejected' and face-kept 'kept-real' rows are not redrawn by this change. The operator's
    `--redraw` backfill covers 'rejected' rows but not 'kept-real' ones. The coordinator still has to merge,
    deploy and run native.
- **Redraw of existing drawings (deployed, `42911477`).** `tools/backfill-pictures.ts <email> --redraw` draws again
  every drawing made before its start, a minute's worth at a time. The coordinator started it for Eva, Andraž and Ivona.
- **Prompt fix, refusal fallback, redraw of ended pictures only (worktree track, `b4a41715`, `9fea0eab`,
  `7530026e`, not merged or deployed).** The owner's decisions after the spike on the 24 rejected drawings
  (`~/code/meta-hackathon/out/styld-rejected/`).
  - Prompt (`CleanPrompt.ts`): pressing smooths the fabric only and keeps the garment's own shape and every detail.
    The line "sleeves, sides and hem fall straight and symmetrically" is gone. Shoes and bags are drawn from the
    angle their cut-out shows, not "from the front".
  - Checked with 20 Muse calls in `~/code/meta-hackathon/out/styld-prompt-fix/`. The before/after page is the spike's
    Pages project at `/prompt/`. The hiking boot kept its side view, the slouchy bag its shape, and trainers their
    three-quarter view. Plain trousers, jeans, a tee and a bodysuit came back as before.
  - Not fixed: the lace-up knit, the cross-strap top and the printed tee still came back plain. Their cut-outs show
    the garment's back, and asked for the front, Muse draws a plain front. A wording that drew "the side the
    reference shows" kept all three, but it drew the back of front-facing trousers and jeans, so it was not shipped.
  - Refusal fallback (`Drawing.ts`): when Muse refuses a front cut-out, it is asked once more with the piece's photo
    first and the cut-out second. The photo is Styld's re-encoded working copy, turned as the cut-out is. The prompt
    names the garment by colour and type ("the grey sleeveless top"). The second ask belongs to the same drawing:
    one credit, at most. A second refusal, or a piece whose cut-out is its photo, fails as before. A back has no
    fallback. The bodysuit Muse refused was refused twice more when the prompt said "one garment" without naming it.
    Named, it was drawn.
  - Backfill: `--ended` (`ended: true` with `redrawBefore`) queues again only drawings that ended 'rejected' or
    'failed' before the moment, and leaves shown ones alone. `--before <ISO>` fixes the moment, so a resumed run
    never widens the set. A request that fails on the way, or gets a 5xx answer, is retried after a minute.
  - Evidence: unit tests. `Drawing.test` covers the fallback: drawn on the second ask, two refusals fail, no photo
    gives one ask. `CleanPicture.test` covers the prompt lines and the photo-first body. `Backfill.test` covers
    `ended` over SQLite: ready untouched, rejected and failed queued once, a repeat queues nothing. The native
    `CleanPictureAcceptance` step `ended` was written for the coordinator's run, not run here.
  - Open: merge, deploy, native. Then `--ended` for the testers. A wording for cut-outs of a back.
- **Backs free (deployed at f7852a6f, `b4e8e768`).** A camera back shot and "Add the back" hold no credits; a front
  with its back now costs 1 credit, not 2. Of 13 camera fronts on the preview, 10 backs had been skipped.
- **A pressed back from the real one (deployed at f7852a6f, `bc845983`).**
  - The owner's rule: a back is drawn only from a back the person photographed, never invented.
  - One drawing lifecycle (`capture/Drawing.ts`) serves the front (`Pictures.ts`) and the back (`BackPicture.ts`).
  - The back's rows are in `piece_back_pictures`, created by migration `20261104150713`, a plain CREATE TABLE.
  - `DrawBackPicture` brings the row in line with the piece's back: drawn, drawn again, or forgotten with its file.
  - The page signs `images.backClean`.
  - Gate fixes followed in `1aded4f5`: the patterns owner and `stuckRows`' `@internal` tag.
- **Angles first in the carousel (on main, `36a1c027`, not deployed).** The front, then its back (drawn, else the
  photo of it), then the person's own photo, cut-out and photo of the back.
- **Evidence:**
  - Unit: `BackPictureStore`, `PieceImages`, `CleanPicture` (the back prompt), `PieceCutout` (a back holds
    nothing); the server's unit suite passes.
  - Story and scene: `piece.story` and `piece.scene` cover the swipe order and the drawn back.
  - Native, written for the coordinator's run: `CleanPictureAcceptance` › `verifyBackPicture`;
    `CaptureAcceptance` (a front and its back cost 1); `WardrobeAcceptance` (PUT /back is free).
- **Open:**
  - The coordinator's native run on the deployed release.
  - `--backs` for the testers' 1–3 pieces with a back, which waits for the owner's go.
  - A phone walk of the carousel in light and dark.
  - The bundle budget: 36a1c027 measures 384,875 gzip against 384,600.
  - Out of scope: drawn side views, backs from video scans, a paid redraw of the back.

## Eva's Home: What to wear today, What's new, Challenges soon, and no Explore page (4 November, deployed at f7852a6f)

Built from `docs/archive/PLAN-home-2026-11-04.md` (owner-approved 4 November) after Eva's paper sketch and voice note. This
session ran as a track: cheap checks per commit; the native suite, the full gate and the deploy belong to the
coordinator (`styldappv2-51`).

- **Explore leaves the website** (dcef50cc): `/explore` opens Home and the address becomes `/`; the head's compass,
  the signed-out bar's Explore link and the landing's "See all" go, and a profile's Back goes Home. The landing reads
  its boards through its own `LandingBoards` state; `Visit` holds only a person and a piece again. The server's
  `/api/public/explore`, `explore_get` and curation stay; Ask still finds people and boards. Board moods' copy moved to
  `boards.moods` ("Moods, for search").
- **Ask's Start a board opens the new-board sheet** (44cfb2c7): the move to Boards was a full page load that forgot
  the request; both are tabs, so it is now an in-page move. Scene through to the open sheet; native
  `expectBoardStartFromAsk`.
- **What's new is everyone's** (fd3dbbc0, 0db5e5fe): `feedFor` reads every public board, pin added after its board
  went public, and shared look, gated as discovery is (owner's profile and the thing passed, no profile three people
  reported; blocks and unpublished profiles drop out through the public pages), with the followed people first on each
  page. No migration. `feed_get` says so. Local-D1 `Feed.test.ts`; native `verifyWhatsNew` in `SocialAcceptance`.
- **Home in Eva's order** (2cf49e46 refactor, then c62c23e9): the day, "What to wear today", What's new along a strip (eight
  newest, one card shape so the strip keeps its height), today's outfit as before, Challenges (her three examples,
  "Coming soon", nothing to tap), Pick up, then "What's new, earlier", which reads more as it nears the screen
  (IntersectionObserver per cursor) or on Show more. "From people you follow" is gone. Desktop: the day heads the page,
  the strip runs across it, the outfit stands beside the rest.
- **The tombola** (ad798779): a full-screen wheel of twelve of the person's pieces turns ≈2.5 s and stops on one (in
  season first; never sportswear, swimwear, loungewear, sport or outdoor shoes or socks; free, spin again at will;
  at once under reduced motion). From the piece: **Make outfits with it** (the "One piece, many outfits" board,
  5d70aad6), **Wear it today** (today's outfits around it as the engine's anchor, with "Back to today's outfits",
  7fa62f23), **Build my own** (a board with the piece on its table, 5d70aad6), Open the piece.
- **Bundle budget** 384,600 (dated notes in `tools/bundle-check.ts`): Explore's removal saved 4,495; What's new and
  the layout, the tombola (3,627), Wear it today (545) and the boards (888, measured in clean worktrees) add back.
- **Evidence:** unit and story/scene: `landing.*`, `whatsNew.*`, `tombola.*`, `wearIt.story`, `Feed.test.ts`,
  `today.scene`, `ask.scene`, `session.story`, `Rendering` (`/explore` answers 200). Native tests written, not run
  here: `SocialAcceptance` (What's new), `verifyHome` (strip, Challenges, the wheel, Wear it today, both boards),
  `expectBoardStartFromAsk`, the layout checks without `/explore`.
- **Open:** the readback on the preview and the native suite's result (`styldappv2-51`); a phone walk by Eva (her sketch was phone-only, so the
  desktop arrangement is a proposal); Challenges themselves (kept for later); re-publishing a board moves it to the top
  of What's new again (known); What's new pages by an instant, so items sharing the cursor's exact millisecond can be
  skipped at a page boundary.

## House inspiration boards, Show me and Try with my wardrobe (4 November)

Built from `docs/PLAN-house-boards-2026-11-04.md` (owner-approved 4 November). About 50 boards from day one on two
house accounts, `@styld.women` and `@styld.men`, made of garments generated with Meta Muse Image (one image per piece,
always marked Generated). Every board has an English original and a Slovenian translation, pending Eva's review. This
session builds; `styldappv2-51` deploys and runs the native suite after each deploy.

- **Tables** (1ddba67e): `board_tags`, `board_translations`, `profile_translations`, `viewer_preferences`,
  `piece_provenance` (with Clef's type and `whole`) and `seeded_boards`. The migration only creates tables.
- **Generation tooling** (24cf917f, 1ee905bb, 7c11e517, 6f5003f3): `tools/seed/` generates each garment with Muse
  Image and judges it with Muse Spark (Clef optional), with at most two retries and a $5 cap charged before each
  call. It imports the garments as house garments, then sets the profiles, then the boards in publish order. It
  waits for the checks and writes a report. The real test batch passed 10 of 10 first try for $0.16 (private page
  `styld-seed-test-batch`).
- **Seed endpoint** (162c6388, d67cdf22): `/operator/seed/*` works only for configured house emails
  (`STYLD_HOUSE_EMAILS`) and runs through the app's own services. A board's table is pinned and laid out before it
  goes public. The same entry twice changes nothing. Generated imports keep the catalogue's type and are never
  redrawn.
- **Slovenian reads** (3cdb7a61): the `styld_locale` cookie, then `Accept-Language`, picks the language. A translation
  is shown only while it still translates the current original. Checks judge the Slovenian texts too.
- **Generated** (bd63adbd, 92fd6953): public pieces, looks and boards carry `generated`. A board is generated when
  any piece on it has generated provenance. The mark has an accessible hint in en and sl.
- **Show me** (a94a8d01, d7110d69): `GET /me/preferences` and `PUT /me/preferences/show-me`. What's new reads in
  rank bands carried in its cursor (`band~instant~id`): followed people first, then the choice, then boards for
  everyone or untagged, then the other audience. It interleaves within a band and never hides anything. The house
  boards on the landing are ordered the same way. Home's card asks once; the Account page changes the choice.
  Sign-in with nowhere to return to lands on Home.
- **Try with my wardrobe** (42da42aa): `POST /boards/:boardId/try` works on a public board with generated pieces.
  It makes a private board of the caller's own ready pieces where the generated ones lay: same type, most shared
  colours, then the first colour, then most recently worn, then newest added, each used once. A piece with no match
  becomes a label: "No brown loafers yet" / "Še manjka: mokasini, rjava". The board keeps its paper and words, pins
  no house piece and writes nothing to the wardrobe. The whole try runs once per operation id, and the website
  retries under the same id. The button says "5 of 7 from your wardrobe" and links to the new board. Signed out, it
  leads to sign-in and back.
- **Content** (S4): `tools/seed/catalogue.yaml` is the brief's catalogue with the myinbox house emails and 18 featured
  picks, six per audience, published last; Kris can change them. `tools/seed/manifest.yaml` is the brief's manifest.
  `Content.test.ts` holds the brief's numbers: 166 garments (7 shared) for 173 pieces (106 women's, 67 men's) and 53
  boards (26 women's, 16 men's, 11 everyone's; 31 and 22 by account). It also checks that every garment is used and
  that the Slovenian addresses one person. The dry run expects $2.89 to generate the remaining 156 garments; the worst
  case is above the $5 cap, which stops the run there.
- **The look** (f7bb710e, 819c9ec4, after Eva's Pinterest references, owner 4 November): each outfit a dense stack
  filling its cell (layer over top, bottom beside, shoes at the hem), up to three across; packing lists and collages
  in rows at one scale (shoes and small things larger than life); the board's name as its headline (not on one-piece
  boards, whose table is the app's template). A board's paper stays light in dark mode, for every board.
- **Clef reports, never blocks** (c7b6e51d): every house garment passed the seed's own judge (Muse Spark: one whole
  garment of its type and colour), and the owner chose the catalogue's type, so Clef's reading is listed in the
  report and only a garment not ready or not cut out holds a board back. The judge takes any shape for sportswear
  and loungewear (3bdd9308).
- **Seeded (4 November evening):** all 166 garments generated and judged, $3.44 of the $5 cap with cut-outs (pages
  `styld-house-garments`, `styld-boards-live`). Preview: 53 boards, 52 public and passed; `w-witch-october`'s check
  says unsure. Production (styld.app): 173 garments imported and 37 boards created on the first pass; the other 16
  followed once c7b6e51d was live; checks pending at the time of writing (see Open).
- **Runbook:** `docs/DEPLOYMENT.md` › House inspiration boards.
- **Bundle budget** 388,200: Show me +2,284, Try +808 and the card's first paint +203, each measured in a clean
  worktree.
- **Evidence:**
  - Unit: `HouseSeedTables`, `SeedPlans`, `Translated`, `Checks`, `PublicGenerated`, `Feed`, `ShowMe`, `TryBoard`,
    and the `tools/seed` tests.
  - Story and scene: `showMe.story/scene`, `tryBoard.scene`, `whatsNew.scene`.
  - Native: `SeedAcceptance` (operator only, house only, once, sl, Generated, What's new once, Try) and
    `IdentityBrowserAcceptance` (a new account lands on Home and sees the card).
  - Preview: the fixture run of two boards passed its checks and read back in en and sl, a rerun changed nothing,
    and the boards were pruned.
- **Open:**
  - Production: the boards' content checks were still pending after ten minutes; they show on styld.app once passed.
  - The admin calls on production: `curation_house` for both handles and the report's `curation_feature` calls.
  - `w-witch-october`'s unsure check, for a person to look at (a Challenges card opens it).
  - Eva's review of the Slovenian copy, and her call on the sl chip ("Ustvarjeno" or "Ustvarjeno z UI").
  - On the preview: a readback of Show me's order and of a try with a test account.

## Open from Eva's 2 November review

The tracker's tickets T-01 to T-21 are built and deployed except where a gap is named here. Each still needs Eva's
check on her phone (Samsung, Android Chrome, dark mode), which is the acceptance the tracker was waiting for.

- **Guided camera (T-01, T-05):** full foreground extraction, a Front/Back preview on the review card,
  garment-contour detection, and face/no-garment recognition with the real providers.
- **Navigation (T-06):** the physical Android Back button on the wardrobe filters and the Gallery.
- **Categories (T-12):** custom categories under a built-in type, suggested by Styld in the review tray and made on
  keep.
- **Ask Styld (T-14):** Eva's check only. The live readback on the preview through the real LiteLLM route passed on
  4 November after LiteLLM moved to v1.108.0 (release 784e201, test account): English, Slovenian and a saved look were
  answered in 5–14 s, every piece shown was the person's own, one credit a message, and a repeated operation id
  reused its chat. Deleting the readback's look answered 400, so a "Readback autumn" look is left on the test account.
- **Android (T-20):** the share sheet and the gallery picker on a phone; the Chrome tab-restore black screen was
  never reproduced.
- **Signed media (T-21, F-43):** signed-in media loading under load, Workers Logs, and the addresses refreshing after
  they expire.

## The preview

- Runs on the `styld` Cloudflare account's isolated workers.dev URL (noindex, no custom domain); stages, the account
  and the deploy procedure are in `docs/DEPLOYMENT.md`. `/api/health` names the running release.
- **Release:** `f7852a6f` (4 November): Eva's Home, the backs track and the house boards' first tables, on top of the
  4 November tracks (pictures, tops by sleeve, boards, Gallery, grid delete).

## Gates

`heavy --wait bun run check` runs, in order:

- `format:check` (oxfmt).
- `agents:check` (repoagents): the vendored skills in `.agents/skills` and the harness links and MCP files.
- `vendor:check` (`tools/vendored.ts`): the `repos/` snapshots, the `FOLDKIT.md` copy and the anti-slop lint rules'
  file hashes. It is the one vendored-hash gate; `provenance:check` is gone.
- `icons:check`, `assistant-views:check` (generated files match their sources).
- `translations:check` (x18n): key parity between en and sl, missing translations, unused keys (errors), hard-coded
  strings.
- `i18n:check`: ICU syntax, argument and plural parity, approved rich tags, the generated catalog modules.
- `graph:check` (package boundaries), `patterns:check` (`tools/patterns-check.ts`, ARCHITECTURE › Patterns),
  `style-tokens:check`, `suppressions:check` (the census of reviewed suppressions only), `canaries:check`.
- `typecheck`: effect-tsrs (TypeScript and Effect diagnostics) over the one root `tsconfig.json`; the planned web/workers
  split is not done (Open items).
- `lint`: type-aware Oxlint (backend: the `tsrs` package's `tsrs-lint`) with anti-slop; no explicit `any`, no non-null assertions, cyclomatic complexity ≤ 20,
  cognitive 15, function and file size limits.
- `unused:check`, `unused:production` (Knip; the gates are entries through `package.json`, the operator scripts are
  listed one by one in `knip.config.ts`, so a script nothing runs is reported).
- `duplicates:check` (jscpd).
- `build`, then `bundle:check` (reads that build), `test:unit`, `test:native:built` (workerd + Chromium through the
  real edge, on the same build).

## What is built

Each line is a kept feature; `docs/DELIVERY.md` maps it to the tests and readbacks that prove it.

- **Sign-in:** one six-digit email code for sign-in and sign-up; logout; account deletion (recorded as access ends,
  public content hidden at once, every store purged by the queue or the account sweep, a last prefix purge a day
  later); admins by sign-in email (`STYLD_ADMIN_EMAILS`).
- **Adding clothes:** photos from the picker; the "hold it up" and "lay it out" cameras (Clef fires the
  shutter, front then back); videos up to 15 minutes cut into parts on the phone; add from a shop's page.
- **Cut-outs:** one garment pipeline (`capture/Garments.ts`): Clef routes, Cloudflare Images cuts out one garment, SAM
  splits several; a pair of shoes is one piece; a garment seen across a video is one card.
- **Review tray:** keep, drop or keep the original photo; "Already in your wardrobe?" matching; only a person turns a
  detection into a piece (assistant adds skip the tray).
- **Clean pictures and the turn:** Muse draws a clean picture from each kept cut-out (free), redraw with a hint
  (1 credit), the real photo one tap away; the quarter-turn on a hanger (Veo, 5 credits).
- **Wardrobe:** 29 shop-style types in three groups, season, occasions, pattern, brand and shop link (Clef suggests);
  group tabs, type chips, a dense grid and a filter sheet.
- **A piece's page:** front and back (add or replace the back), facts, edit, delete, "In your photos" and "In your
  looks".
- **Today (Home):** today's outfit from the outfit engine with Spin and Wear this (worn days), Pick up where you left
  off, From people you follow.
- **Outfit engine:** Fast (rules propose, Clef ranks) and Thinking (a text model proposes, rules check, Clef ranks),
  Thinking at most 50 a day; measured per mode in Analytics Engine (`tools/ai-usage-report.ts`).
- **Looks:** made by the assistants, by Styld or from a photo; listed, opened, shared one at a time and deleted.
- **Boards:** a grid of pins (pieces, looks, pictures, others' public pieces, credited) with a hand-edited collage
  (move, pinch, turn, layer, label, undo, save as a look); Save to board from pieces, looks and photos.
- **Stickers and mood boards:** a sticker drawn from words (1 credit, marked Generated); a mood board of the person's
  own pieces from one sentence, pinned and laid out (1 credit).
- **My Gallery:** the person's own outfit photos (1 credit to find the clothes), matched to pieces, favourites, Wear
  it again, Add to board (held back from visitors), Cut out the outfit, a missing garment offered to the tray.
- **Styld, the stylist:** a chat at `/ask/stylist` over the person's own pieces and looks (DeepSeek V4.1 Flash through
  the paid LiteLLM gateway), 1 credit a message, back when no reply comes.
- **Public profile and social:** `/@handle` with Boards and Looks; public boards, looks and pieces with share links
  and link previews; Save, one-way private Follow, Block, Report; readable signed out.
- **Home, What's new and search:** the day, What to wear today (the tombola), What's new from everyone (followed
  people first), today's outfit, Challenges (coming soon) and Pick up; Ask searches the wardrobe, people and boards.
  Signed out, Home is the landing with Edits from Styld or the newest boards; there is no Explore page.
- **Safety:** every public item is checked first (Clef for pictures, DeepSeek through the paid LiteLLM gateway for words); unsure stays out of
  discovery, failed is hidden with a notice; three reports hide; admin MCP tools hide, restore and feature.
- **ChatGPT and Claude (MCP):** OAuth (CIMD and DCR), consent and immediate revoke at `/mcp`; noun_verb tools over
  the same operations; MCP Apps views (the wardrobe and a board) inside the host.
- **Credits:** 100 a day per account (`protocol/Prices.ts`), held before paid work and settled once; a lost provider
  answer refunds.
- **Languages and telemetry:** English and Slovenian everywhere; browser telemetry only after consent.
- **Operator tools:** the v1 importer (`tools/import-v1/`, operator-token `POST|GET /api/operator/imports/:id`), the AI usage
  report, the live provider probe.

## Open items

From C8's browser review: read back F1 (a Slovenian then English chat on the preview) and F7 (POST
`/api/outfits` timing on a cold visit).

From C8's review fixes:

- The Wallet's Durable Object (its state and command receipts) is not purged with the account: Alchemy Domain beta.85
  exposes no way to erase an aggregate's storage, so it needs a dependency patch or an upstream API.
- A video Meta accepted whose response loses its file ID cannot be reconciled without provider support. If the ID
  is returned but both durable recording (after retries) and immediate deletion fail, cleanup is still best effort.

From the cleanup's milestones, still open after the later ones:

- No tool lists pending Wallet holds; `pending_settlements` holds every one the Wallet has not confirmed settled (a
  D1 query reads them), and the `settlements` sweep logs how many it settled.
- C8's credit and durability fixes and migrations are deployed. A live authenticated readback of a redraw, a turn,
  a capture retry, a gallery photo and a cut-out under concurrent requests remains pending; native acceptance with
  fake providers passed.
- A refused upload path is worded on its own (4 November): uploads waiting unused (`LimitReached` `uploads`) and a
  paced send (`SlowDown`, worth trying again) no longer read as spent credits on the add page.
- The native suite's shared local D1 answers `SQLITE_BUSY` under load; the gallery browser journey ("sideways
  scroll") flakes under box load (rerun alone with `-t "lays out today"`).
- `AccountLifecycle` still takes its bindings as a record (`makeAccountLifecycle`, its tests' seam over a listing
  bucket).
- `mcp/Sdk.ts` still answers the MCP SDK's older protocol era (`answerLegacy`) for external assistant hosts.
- The auth storage tables stay exported from `@styld/db` for Drizzle Kit.
- Styld's unit turn tests include recorded DeepSeek Chat Completions; live paid-gateway behavior and moderation quality
  remain unverified until the dedicated Railway route is configured.
- A Thinking call that times out is retried while busy (up to three more times) inside a synchronous request.
- `capture/Providers.ts` and the stylist's and language model's `(parts) =>` records remain beside the services.
- The garment pipeline's 512 px model input and the pair rule need the fixture comparison and one real photo per
  intent read back on the preview (C4a).
- C7's web/workers tsconfig split is not done: the native suite is one program that imports the server's source and
  runs Playwright callbacks that need the DOM lib, and tsrs has no build mode or project references, so the server's
  stream casts (`CloudflareImages.ts`, `Meta.ts`, `Wardrobe.ts`) stay needed there. Without the DOM lib the server
  source compiles without the `Meta.ts` and `Wardrobe.ts` casts, after small fixes (`crypto`, `import.meta.url`,
  `URL` in `fetch`, a nullable `Response.body`).

From the product (carried from 31 October – 1 November):

- Home waits 4–6 s for its first table while Clef ranks twelve candidates; Thinking takes about 15 s.
- A paid text call can still consume up to its 45-second stylist deadline; ambiguous gateway outcomes are retained as
  unknown and are not retried automatically.
- Cloudflare Images answers 9529 ("too busy") in bursts of about 90 cut-outs a minute; the queue absorbs it.
- The runtime's own `r2_get` span reports a judging-picture cache miss as an error, crowding Workers Logs queries.
- My Gallery has no readback on a real worn photo (finding and cutting out a person); favourites are not yet clues
  for the engine or Styld.
- The piece page lacks "Create board" (it comes with M4's templates); link import does not read the brand.
- Not built yet: a composed link-preview image, follows and blocked lists on the website, the "people I follow"
  search filter.

## Owner decisions pending

- **Gate 1:** rate the ~60 calibration outfits (Fast against Thinking) on the rating page; feeds M4.
- **Try-on test (M8):** 2–3 full-body photos of the owner; then go or no-go, provider and price.
- **My Gallery readback:** a worn outfit photo.
- **Labels:** Flats against heels (the owner's Derby shoes are typed heels).
- **Styld:** the model and the price per message.
- **Order of M4–M9** after the testers' findings.
- **Screen review topics:** where Styld lives, what Home is for, credits and settings on Account, Mine/Saved on
  boards, the landing's lead.
- **Production:** billing's planning round, legal pages and the cutover to styld.app, each on the owner's go.

## Next

Eva's phone walk of the preview (Home, the wardrobe, boards, Gallery, the camera), then the gaps under "Open from Eva's
2 November review" and the open items above, each outstanding `docs/DELIVERY.md` row, and signed-in walks in en and sl
on phone and desktop. Use `docs/TESTING-GUIDE.md` for the testers.
