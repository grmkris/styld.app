# Delivery status

Status as of 4 November 2026. Everything on `main` through `f7852a6f` is deployed to the isolated preview (deployed by
`styldappv2-51`; its full gate with the native suite ran after the deploy). Phone, live-provider and owner acceptance
listed below stays open. The history of 2 to 4 November (the cleanup's C8 fixes, Eva's review batches 01–05 and the
4 November tracks) is in `docs/archive/STATUS-2026-11-02-to-2026-11-04.md`; earlier milestones are in
`docs/archive/STATUS-2026-10-28-to-2026-11-02.md`. The Eva review tracker was retired on 4 November; what it still
held open is the section below.

## Pre-demo fixes from Eva's bug report #1 (4 November, live on styld.app since 74aa35d4)

Eva's screen recording of 4 November (`~/code/styldappv2-feedback/eva-bugs-1/`). Only what shows in the feature videos
went in before the demo.

- **The outfits sheet** (`6d68aa86`): on Boards › + › One piece, many outfits, the season and Make the outfits stay in
  view under the pieces instead of below the whole wardrobe.
- **What to wear today** (`b6d96e7b`, `ce0c6fd8`): a sparkle instead of the dice (owner's choice). The wheel turns in
  wedges of the four board paper tints; the spin is unchanged. Bundle budget 418,400.
- **Outfit boards centred** (`f5a5e245`): each outfit's cluster is centred in its place, so a lean outfit no longer
  leaves holes. This applies to new boards, Another layout and the house boards' grid.
- **Boards already made** (`e38e01fd`): `POST /api/operator/boards/relayout` and `tools/relayout-boards.ts <email>…`
  lay out each account's outfit boards again in their own layout. Outfits, looks and pins are kept, once per board.
  Outfit pieces moved by hand go back to their places (owner: accepted).
- **Evidence:** unit `OutfitLayout.test` (a lean outfit centred in every layout), `Api.test`; the native board-outfits
  journey (relayout, repeat, operator only) passed in a clean worktree. The full gate and the browser walk were not run.
- **Production** (deployed by `styldappv2-0f`, `/api/health` reads 74aa35d4): the relayout laid out Eva's 4 of 4
  outfit boards again, and Kris's and one imported account's 1 each; two accounts had none. A repeat skips them.
- **Open:**
  - Walk the three screens on a phone as Eva or Kris: the Make button in view, the sparkle and the tinted wheel, and
    boards without holes.
  - Check the blank beige tiles under Home › What's new in her recording.
  - `tools/relayout-boards.ts` with several emails answered 404 for the first; one email per run works. Not
    reproduced yet.
- **After the demo (from the same report):**
  - Clothing › Tops / Bottoms / … before the subcategories (#6).
  - A simpler Home (#5): Eva to name the sections.
  - The bad cut-out and the T-shirt typed as a bodysuit; automatic rotation (#7).
  - The crash after a mass upload (#8).

## The wardrobe opens on a shop's sections: Tops, Bottoms and the rest (5 November, live on styld.app at `c107a085`)

Eva (5 November): "ko odpres main omaro bova nardila tops in pol k kliknes na tops mas kratke majce/majce brez
rokavov/dolge majce/pullover/srajce… isto k kliknes na bottoms" ("bi bolj pregledno"). Clothing is split into the
sections a shop shows; Kris approved it the same night.

- **Groups** (`packages/protocol/src/Garment.ts`), in this order: Tops (the three sleeve types, shirts, bodysuits,
  knitwear, hoodies), Bottoms (jeans, trousers, shorts, skirts), Dresses & jumpsuits, Outerwear (blazers, jackets,
  coats, gilets), Sport (unchanged), Swim & lounge, Shoes, Accessories. In sl: Zgornji deli, Spodnji deli, Obleke in
  kombinezoni, Jakne in plašči, Šport, Kopalke in domača oblačila, Obutev, Dodatki. Derived from the type, so no
  migration; a stored `?group=clothing` link is left out as any bad param is, and opens the wardrobe's groups.
- **Kept coarse where a decision depends on it** (`familyOf`: everyday clothes, sport, shoes, accessories): how sure
  Clef is of a piece's kind (the sum over the chosen type's family, so preselection thresholds do not move), whether an
  import keeps its mapped type (`wardrobe/Work.ts`), and the house seed's "read as another kind" check. Outfit rules,
  the tombola and Analyze my wardrobe already asked only "is it Sport", which is unchanged.
- **Shown by group**: the wardrobe's cards (only groups that hold pieces, as before), the piece form's type headings,
  Analyze my wardrobe's counts, the assistants' views (one label map for every group) and `piece_search`'s `group`.
  The piece picker (photo and board sheets) shows a chip only for groups holding a ready piece, and the one it opened on.
- Tests: protocol `Garment.test.ts` (order, every type in exactly one group, the families), the wardrobe, select-mode,
  collage, stylist, assistant-view, photo, MCP and analysis tests; the two browser acceptance journeys' links.
- Open: Eva's look on her phone.

## Shop-style pictures on a gentle ghost mannequin, and free redraws that correct them (4 November, on main, not deployed)

Eva's pieces added on styld.app after 19:01 UTC came back "just stretched": 813559ff's "keep the garment's own shape
exactly as the reference shows" made Muse trace her crumpled bed-sheet snapshots. Her older pieces looked right because
310 of them came from v1, whose main picture was already a Gemini product shot.

- **Search (owner, 4 November):** about 900 drawings of 55 of Eva's pieces, the 20 hardest drawn three times per
  recipe, scored blind by two independent judges (agreement r = 0.83). Harness, sheets and scores:
  `~/code/meta-hackathon/out/styld-prompt-search/`. On her 10 bed-sheet snapshots:
  - Gentle ghost mannequin: 0% still crumpled, 10% bad, 6.9/10.
  - Best flat wording: 25% crumpled, 25% bad, 6.1/10.
  - v1's exact recipe (Gemini 3.1 Flash Lite Image, the whole photo, v1's prompt): 37% crumpled, 41% bad, 4.7/10. It
    also refused one tee and left 4 drawings that could not be keyed.
  - v1's prompt on Muse, from the photo or the cut-out: 100% crumpled.
  - The photo beside the cut-out raised crumpling from 27% to 47–57%.
- **Prompt (`CleanPrompt.ts`):** clothes are drawn as a ghost mannequin that keeps the garment's own cut. The
  snapshot's outline is named as an accident and never traced. Shoes and bags keep their angle. The refusal fallback
  is unchanged.
  - The trade: a crossed or Y-shaped back strap or a tie is sometimes drawn plain, and a back photo is drawn as a front.
- **The front drawing sends only the front** (`Pictures.ts`). The back added nothing to it and could carry a back print
  onto the front.
- **Redraws are free and correct the drawing** (`prices.redraw` is 0; the zero hold keeps the hold's lifecycle).
  - The person's words now come first in the prompt as a correction: "keep the crossed straps on the back".
  - The page asks "What should change?" and says the redraw is free (en, sl). The MCP tool says the same.
- **Evidence:** unit `CleanPicture.test` (the ghost-mannequin lines, the correction first, shoes keep their angle) and
  `piece.scene` (the free redraw form). Native `CleanPictureAcceptance` now expects a redraw to spend no credits; it
  was written for the coordinator's native round and not run here.
- **Open:**
  - Deploy to production.
  - Redraw Eva's account with `tools/backfill-pictures.ts <email> --redraw`, so every picture shares one style.
  - Eva's review of the comparison page, which is public on Kris's personal Cloudflare account
    (`sp-5693ef40dbde.kristjan-grm11775.workers.dev`). Take it down after her review.
  - Two input problems the search found:
    - Cut-outs stored upside down without a rotation get their print moved to the hem.
    - A bodysuit was typed "trousers" at 50% confidence.

## The API Worker's startup under Cloudflare's CPU limit (4 November, on a branch, not deployed)

On the night of 4 November, 4 of 7 production deploys failed with `ScriptStartupError: Script startup exceeded CPU
time limit` on `StyldWorker`. Unchanged retries sometimes passed. The Worker was built as Alchemy builds it (its
`WorkerBundle`, minified, `strictExecutionOrder`). The entry chunk was 3.36 MB, and its top level took 909 ms of CPU
(median of 9, node). There was no single hot spot: the whole static module graph was evaluated at startup. Yielded
Auth's persistence and drizzle took about 310 ms, `Modules.ts` 185 ms, the API 43 ms, and Alchemy's own bridge 80 ms.

- `StyldWorker.ts` now keeps the runtime, the bindings (`Bindings.ts`, with the pace table split into
  `kernel/Paces.ts`) and the deployment. It imports `Application.ts` (the kernel, the modules, the handlers) in the
  Worker's init, on the first event, and imports the live providers inside the application's per-request first build.
- After: the entry is 175 KB, with 650 KB of static shared chunks. Its top level takes 250 ms of CPU. The first event
  now pays the Application chunk's evaluation (640–780 ms of CPU) under the request's CPU limit, so a cold visitor
  waits about as long as before.
- The shared import only evaluates code. I/O setup (cb10b19's `sessionsReady`) stays in `onFirstUse`'s per-request
  build. A synthetic copy of the pattern in workerd answered 24 requests sent together at a cold isolate, with none
  hung.
- Open: deploy to the preview, then `cold.ts` and Workers Logs (no "hung", no startup errors), then production. No gate
  yet keeps the entry's static graph small.

## Photo imports no longer stall styld.app (4 November, `d6d6d239`, live on styld.app since about 21:59 UTC)

Eva (4 November, about 21:20 UTC): the app hung and lagged while about 80 photos were processing.

- **The cause.** Workers Logs for production showed several piece-queue invocations ending `exceededCpu` (32.5 s of
  CPU). One of them held 5 match messages, made 72 `Styld.Capture.sameGarment` calls and 79 R2 reads. Meanwhile,
  wardrobe thumbnails waited 3–8 s on little CPU, `/api/captures/review` took 12 s and was cancelled, and p99 rose to
  8 s, from under 1 s before the cutover.
  - Matching made every compared cut-out into the model's picture again: decode, shrink, flatten, encode, 0.4–0.9 s of
    CPU each at the working size. That is up to 17 per sighting.
  - One delivery compared every waiting sighting of the import.
  - The piece queue ran batches of 10, so one job past the CPU limit retried the nine beside it, spent their tries and
    repeated their paid Clef calls.
  - The queue consumer shares the API Worker's isolate, so every request waited behind it.
- **The fix.**
  - `capture/Comparable.ts`: the isolate keeps up to 48 comparable pictures, each with its R2 etag, and reads the
    object again only when the etag changed (`onlyIf.etagDoesNotMatch`). Only finished pictures are kept, never a read
    in progress.
  - `processMatch` compares one sighting a delivery and sends the queue on to the next.
  - The piece queue's batch size is 1.
- **Evidence.** `Comparable.test.ts` (unchanged, overwritten, deleted, not a picture, least recently used) and
  `Jobs.test.ts` (batch size); typecheck, lint, Knip, graph, patterns and unit. Production read back from 22:00 to
  22:24 UTC: no `exceededCpu`, but no import ran in that window, so the fix is unexercised until the next one.
- **Open.**
  - Moving piece processing into its own Worker would keep image work out of the API's isolate altogether.
  - A thumbnail answering 304 still spends about 300 ms of CPU.
  - Every deploy is felt as a hang. A fresh isolate's first requests wait about 6 s in Yielded Auth's session-store
    setup (catalog reads at 0.25–1.4 s each, Google's openid-configuration). On a thumbnail the Images transform then
    adds up to 7 s. About 60 thumbnails took 3–15 s at 22:22 UTC, right after `3f909345` went out.
  - MCP clients get 404 on `/api/auth/oauth2/token` and `/.well-known/openid-configuration`.

## Rotate turns the shop-style picture too (4 November, `0f29dcd4`, live on the preview and styld.app)

Eva (4 November): Rotate turned her photo and cut-out but never the shop-style picture, so a drawing Muse made from
an upside-down cut-out stayed upside down.

- **The cause.** The drawing was always served at 0. Since `4cb61c56`, Muse draws from the cut-out turned by the
  piece's rotation, but nothing recorded which rotation a drawing was made at.
- **The fix.**
  - `piece_pictures.drawn_rotation` (migration `20261104210909_drawn_rotation`, an in-place ALTER) records the
    rotation a claim draws at.
  - The drawing is served turned by `drawingTurn`, the piece's rotation minus the drawn one. This applies wherever it
    shows: piece page, wardrobe, boards, public pages, MCP and try-on.
  - In Edit, Rotate previews the turn on the shop-style slide. The spin, whose frames are served as made, turns by
    `PiecePicture.rotation`.
- **The backfill.** Drawings finished after 13:35 UTC on pieces last changed before them were drawn at the piece's
  rotation: one on the preview, one in production. Every other drawing was drawn at 0. Production read back after the
  deploy:
  - four drawings on rotated pieces are now served turned 180° or 270°;
  - one drawing made at 180 is served upright.
- **Evidence.**
  - Unit: `PieceImages` and `Wardrobe` cover `drawingTurn` and `pictureView`; `Drawing` checks that the rotation is
    recorded at the claim.
  - Scene: `piece.scene` covers Rotate on the shop-style slide and the spin's turn.
  - Deployed: the preview and styld.app both report release `0f29dcd4`, and the migration is applied on both.
- **Open:**
  - The full gate with native, run after the deploy.
  - Eva's look at her top on her phone.
  - From 900 px up, a 90° or 270° turn overflows the non-square picture box, as the photo and cut-out already do.

## Ask instead of guess: the review offers the type Clef was torn with (5 November, live on styld.app at `c107a085`)

Owner (5 November), after Eva's leggings, sports bras and skirts: an audit of her 393 pieces showed Clef right on
shape and torn on what a piece is for (sport or everyday, loungewear or everyday). Where it is torn, the review now
asks with one tap instead of picking silently.

- **Rule** (`capture/GarmentRules.ts` › `alternativeOf`, bars in `Policy.ts` › `alternative`): the runner-up type is
  offered when the first type's own share is under 0.75 and the runner-up's at least 0.25. `confidence` (the group's
  share) and every preselection bar are unchanged. Tested in `CaptureProviders.test.ts`.
- **Stored** on the detection: migration `20261104224356_suggested_alternative` adds `detections.suggested_alternative`
  in place (no CHECK, so adding a type never rebuilds for it); a delivery recorded before it decodes as none.
- **Tray**: `Suggestion.alternative` (optional in the protocol) reaches the review item (`Captures.ts` ›
  `suggestionOfRow`, `TornSuggestion.test.ts`). The found piece's card shows "Or Leggings & sport shorts?" (sl "Ali …?")
  as a 44px chip under its name; a tap sets the type as the type picker does and keeps the piece, and the chip then
  offers the first type back; a type chosen in the editor leaves no chip (`review.story.test.ts`).
- Photo garments (My Gallery) carry none: they are matched to pieces, not typed. Bundle budget 418,800 (418,727).
- **Open:** native run, deploy, and seeing a torn answer on a real capture.

## A piece is sorted beside the photo it was cut from (4 November, on main, not deployed)

Eva (4 November): leggings, sports bras, skirts and "a bit of everything" were sorted into the wrong type. Clef's
`suggest` read the cut-out alone, which cannot tell sport leggings from everyday ones. Owner: send the cut-out and the
original by default.

- `GarmentVision.suggest(picture, source)`: with a source, Clef gets the cut-out first and the photo second, and its
  `state` says the questions are about the piece in the first image. Without a source the request is unchanged.
- The tray, My Gallery and video stills pass the photo's small working copy (768 px JPEG, already made for `route`). A
  v1 import's `describe` reads the piece's original and shrinks it to 768 px with one Cloudflare Images transform; an
  original that cannot be read leaves the cut-out to be read alone. `tools/retype-pieces.ts` sends the stored original
  (at most 2048 px WebP from the browser) beside each cut-out. The seed gate's generated garments have no photo.
- Cost: each suggest carries a second image, roughly doubling its Clef input tokens (counted by `clefCost` in the
  provider metrics), plus one Images transform per imported piece.
- Not measured (owner: "just build it"). Open: whether the photo moves Eva's leggings, sports bras and skirts into the
  right types, read on the preview with her next captures, together with the four Sport types below.

## Sport by shape: four Sport types instead of Sportswear (4 November, on main, not deployed)

Eva: "Narobe mi kategorizira: vse sorte vecinoma leggings, sprtne modrce, krila, razicne stvari in cist vse po
malem" (it sorts everything wrong, mostly leggings, sports bras and skirts). The owner chose Sports bras,
Sports tops, Sports leggings & shorts and Tracksuits & ski wear in place of the one type `sportswear`.

- **Types** (`packages/protocol/src/Garment.ts`): `sportsBras` and `sportTops` sit in the outfit slot `top`,
  `sportBottoms` in `bottom`, `tracksuits` in `set`; the Sport group reads bras, tops, bottoms, tracksuits, then sports
  and outdoor shoes. Named in en and sl, with search words; plain "leggings" now search, and sort, as sport bottoms.
- **Clef** (`providers/Clef.ts`): each Sport type says what it is not (a sports bra is not a bikini top or a camisole),
  trousers no longer include leggings, shorts are everyday shorts (not cycling, running or swim), and a skirt includes
  a skort or a tennis skirt and is never a dress. Track A's two-picture `suggest` is separate.
- **Pictures** (`capture/CleanPrompt.ts`): the photo fallback named every sportswear piece "sports top" and every
  loungewear piece "loungewear top", so leggings and pyjama trousers were asked for as tops; each Sport type now has its
  own words, and loungewear is "loungewear".
- **Outfits** (`outfits/Rules.ts`, Proposer): everything in Sport (not only its shoes) is worn only for sport; a sports
  bra or top with sport bottoms is a whole outfit for it, or a tracksuit. A needed place with nothing suitable takes an
  everyday piece before a sport one. Analyze my wardrobe counts nothing made for sport among the everyday areas.
- **Migration** `20261104212538_sport_types`: rebuilds pieces, detections, photo_garments and piece_provenance (their
  type CHECKs) with the keep-aside pattern, now also keeping piece_back_pictures and try_on_pieces. Every stored
  `sportswear` becomes `sportTops`; the house seed's four sportswear garments (leggings, track trousers) become
  `sportBottoms`, and their manifest ids `-sportswear-` become `-sportBottoms-` so the seed finds them instead of drawing
  them again (catalogue and manifest renamed to match). MigrationSafety covers it; on a private copy of the preview's
  data (dump of 4 November 08:16, migrated forward) all 65 tables keep their row counts, no foreign key breaks, and its
  47 sportswear pieces became sport tops.
- **Re-sort** `tools/retype-sport.ts` (rule in `tools/Sport.ts`, tested): asks Clef which kind of sportswear each
  stored sport top is, from its cut-out with the photo it was cut from beside it (when that photo is at most 4 MB),
  and moves it to sports bras, sport bottoms or tracksuits on an answer of at least 0.7; "not sport" is reported, never
  written. Dry by default; `--apply` writes only while the piece is still a sport top.
- **Run on Eva's production account** (5 November, after production ran the migration): 40 sport tops read, each with
  its photo; the dry run's 25 moves (7 sports bras, 17 sport bottoms, 1 ski trousers to tracksuits) were checked by eye
  against the cut-outs, all right, and applied (the applied run gave the same answers). Of the 6 Clef was unsure of, 5
  were set by hand with the same guard: three zip-off hiking trousers and black seamless shorts to sport bottoms, a
  white pleated tennis skirt to skirts; a striped crop cami stays a sport top. Her Sport now holds 7 bras, 10 tops, 21
  bottoms, 1 tracksuit and 3 pairs of shoes. Reports and the picture sheets are private
  (`~/private/styld-research/sport-retype-2026-11-05/`).
- **Eva's whole wardrobe audited** (5 November, production, read-only first): all 393 ready pieces sorted again as a new
  piece is (both pictures, new descriptions). 337 agreed with the stored type (a random 35 checked by eye: all right).
  Of the 55 that differed, 21 clear errors in the stored types were fixed by hand with the same guard (T-shirts out of
  loungewear, fleece jackets out of hoodies, shirt dresses, a long skirt, leggings out of trousers, hiking shoes and snow
  boots to outdoor shoes, a headband); about 10 the sorter got wrong and about 23 judgement calls (gym or everyday,
  sleep shorts) were left as they are. Her pieces are v1 imports whose "original" is v1's own shop-style picture, so the
  second picture adds nothing for them; v1 holds no shelf she chose herself and no extra photos (read-only query of v1's
  database, 5 November), and its guessed "sport" shelf agrees with her Sport types. Her stored types are hers from here:
  no further re-sorting runs over her wardrobe unless she asks.
- **v1 importer**: names like "sports bra", "leggings", "cycling shorts", "running tee" and "ski pants" pick the Sport
  types.
- **Open:** Eva's check on her phone; leggings and sport pieces already stored under other types (trousers, shorts,
  tops, swimwear) are not re-read; `retype-sport` on the preview's copy; the Tops and Bottoms group navigation she asked
  for in the same message.

> > > > > > > worktree-agent-ad62803b3f2949ede

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

## The landing that replaces v1 at styld.app (live at 7810c475; the rail's player and Styld in ChatGPT and Claude on main, not deployed)

The signed-out Home is rebuilt from the landing-film prototypes and the owner's three phone reviews of 4 November
(DESIGN.md › Type, › Surfaces, › Motion). The prototype the owner approved is
`meta-hackathon/out/styld-landing-film/chapters/site` (tailnet page `styld-landing-chapters`).

- **Built:**
  - The hero: the wardrobe's film for everyone (no random heroes, no `styld_hero` cookie, no hero count since
    `2e821de5`), its statement in Anton at the top and Start free and Sign in at the bottom. Its poster shows first
    (tall on a phone held upright, wide elsewhere); the muted loop plays once the browser allows motion, with no
    control. Under reduced motion or Save-Data no video is requested, and a film the browser refuses (iOS Low Power)
    goes; the poster stays.
  - One full screen per feature, each with its title in Anton and one line at the bottom: Your wardrobe, as a shop (a
    heap that sorts itself, `pile-*`), One piece, many outfits (the coat's board: `coat-board-*` tall, one board on
    the oak table, and the wide `coat-*`), See it on you (the mirror, `mirror-*`), Every side of it (the rail) and Ask
    Styld. A film is fetched a screen and a half ahead and plays from the moment an eighth of it shows. The scanner
    and Try with my wardrobe screens were dropped by the owner as implied by the others.
  - The rail (owner, 5 November: the CSS rail of 74aa35d4 lost the prototype's behaviour, bring it back): five pieces
    (`landingRailPieces`) hang in profile from an oak rod; `RailPlayer.ts`, adapted from interactive-garment-starter
    (Amir Mušić, MIT) with its motion in `RailMotion.ts`, draws each piece's 30-frame sprite (`turn-<piece>.webp`) on a
    canvas. On a wide screen the piece under the pointer turns to its front while its neighbours slide aside; on a phone
    the row swipes with momentum and the piece that settles in the middle turns; a tap turns a piece again; while on
    screen it tours every 2.2 s, held two beats by a touch or a hover. The player loads as its own chunk only when the
    rail mounts (3,851 gzip bytes), and its sprites once the rail nears the screen.
  - Ask Styld: a question and Styld's answer with four pieces (`landingAnswerPieces`), rising in when a third of the
    chat shows and again each time it comes back; under reduced motion it is there at once.
  - In ChatGPT and Claude (owner, 5 November, until his screen recording): the visitor's question in a plain host
    window and Styld's card answering it with four pieces (`landingAssistantPieces`), rising in like Ask Styld's.
  - The ending: the plans' lead and the four plans as a `<dl>`, and the four questions in `<details>`; no second title
    (owner, 5 November). Start free rests at the bottom of the screen (bottom right on a wide one) from the first
    feature screen to the end, as a sticky element that rises from its resting point, so it never covers the hero or
    the footer. Plain scrolling.
  - `GET /cdn/landing/:name` serves the 24 allowlisted names in `@styld/protocol` › `Landing.ts` from the stage's
    media bucket (a year's immutable cache, ETag, 206 for Safari's ranges). Nothing is bundled.
  - Budgets: the first bundle does not grow (the player loads apart); all browser assets grow by 3,547 (716,352 to
    719,899 on main at 10730bc0), and their 700 KiB budget moves to 720,000.
- **Evidence:** `landing.scene` (the hero in en and sl with no control; reduced motion or a refused film leaving the
  poster; each feature screen's film and poster, no scanner or try-with screen; the rail turning its front piece when
  hung for its player; each chat playing when shown; the ending's plans and questions with no second title),
  `railMotion.test` (a turn that never overshoots and lands on the last frame, a reverse mid-turn with no jump, reduced
  motion at once, the rack moving neighbours aside, a phone's flick and slide), `legal.scene`, `LandingMedia.test`.
  Checked by hand on the dev server with production's media at 1440x900 (arrival turn, tour, hover on the fifth piece,
  tap) and 390x844 (arrival, tour, swipe, tap). Native, written and not
  run: `BrowserAcceptance` (the hero's words, no film requested under reduced motion, Start free on the first 360×740
  screen in sl, no sideways overflow at 360, 390, 768 and 1440).
- **Open:** the new media (`pile-*`, `coat-board-*`, `turn-*`) uploaded to the preview's and production's buckets
  (production already holds `wardrobe-*`, `coat-loop-wide`, `coat-poster-wide`, `mirror-*` and `shop-*`), the deploy,
  the full gate with native, and the walk on a phone. The card's pieces `shop-sweater-cream`, `shop-jeans-light` and `shop-boots-black` are in
  production's bucket from the first landing; the deploy's readback confirms them.

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

## Plans: Week, Month, Year, Lifetime, and 3 free cut-outs (4 November evening, on main, not deployed)

Owner decisions of 4 November (evening, the pricing track): four plans in USD, each 500 credits a day while active:
Week $4.99 once for 7 days, Monthly $20 and Yearly $200 subscriptions, Lifetime $349 once. No free daily allowance
any more: a new account has 3 free credits once (three photo cut-outs), then every paid action needs a plan. No credit
packs. Judges get Dodo's discount code STYLDJUDGE (100% off the Week): a $0 week is a week.

- **Built:** the Wallet's one-time free credits (`free` in its state, recorded by the first reservation that brings
  `freeCredits`; the day's allowance spent first, refunds return each part where it came from; old events replay as
  before; `Wallet.story`), a non-member's daily allowance 0 (`billing/Membership.ts` › `allowanceAt`), migration
  `20261104211843_plans_memberships` (`memberships` replaces `premium`, its rows carried over as weeks; `purchases`
  gains `plan` and drops `premium_until_after`), the webhook for every plan (`billing/Webhook.ts`, `Store.ts`: week and
  lifetime payments once per payment id, subscription active/renewed/plan_changed/cancelled/expired/failed/on_hold
  applied by Dodo's event time so a late one never undoes a newer one, refunds and lost disputes of a week or a
  lifetime, other brands' products and a subscription's own payments left alone; the account from the metadata, else
  the known subscription, else the customer's email), the checkout per plan with discount codes allowed, Dodo's
  customer portal (`POST /api/billing/portal`), the operator's lifetime grant (`POST /api/operator/memberships`,
  `tools/grant-membership.ts`), stage facts per plan (`Resources.ts`, `alchemy.run.ts`). LimitReached gained
  `credits` (no plan: "Your 3 free cut-outs are used. Choose a plan to keep going.", pointing assistants to
  https://styld.app/account); a member's spent day stays `dailyCredits`. Web: Account › Plans (`#plans`: the free
  cut-outs left or today's credits, the plan with its end, renewal date or Lifetime, the four plans as a `<dl>` with
  one Choose each, Manage subscription for anyone Dodo knows), every refusal for credits says "Your 3 free cut-outs
  are used." with "Choose a plan to keep going." linking to `/account#plans`, the landing's price block ("Try 3
  cut-outs free, then from $4.99 a week" and the four plans), the FAQ's cost answer, and the privacy and terms text.
  Unit `Billing.test` (deliveries read, allowance, Dodo's pages) and `Memberships.test` (free credits then refusal,
  week twice, $0 week, refunds, lifetime, subscription lifecycle and ordering, email fallback, portal, grant, a stage
  without payments); `account.story`/`account.scene`, `landing.scene`; native `BillingAcceptance` (a stage without
  payments, the operator's grant) written, not run. Seeded native accounts are lifetime members
  (`IdentityFixture.ts`; an id starting `native-free` is not).
- **Open:** deploy and run the migration; set the preview's and production's Dodo webhook endpoints to also send
  subscription.active, .renewed, .plan_changed, .cancelled, .expired, .failed and .on_hold; a test-card purchase of
  each plan on the preview (and STYLDJUDGE on the Week), the portal, a cancellation; the operator's grants (the owner
  confirms the list). A member who spends all 500 of a day sees the same "Your 3 free cut-outs are used" refusal on the
  website (its pages do not know the plan); the assistants get the right one (`dailyCredits`). A subscription
  payment's refund changes nothing by itself: the subscription's own ending event does. The batch's native run.

## Styld Premium Week: payments through Dodo (4 November, superseded by Plans above)

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

## Try on in the Lab (4 November, for the Meta hackathon)

A signed-in person picks one of their own My Gallery photos and a look or pieces of their wardrobe, says the photo
shows them, and Meta Muse Image redraws the photo with them wearing those pieces. This session built it as a track:
cheap checks only; the coordinator merges, deploys and runs native.

- **Spike (go, owner 4 November).** Kris's three full-body photos (a mirror selfie, standing in a room, outdoors with a
  hat, sunglasses and backpack) × three outfits from his wardrobe × three prompts: 30 of 30 edits came back, no
  refusals, $0.01 each, median 13 s, slowest 28 s; $0.49 spent of the $2 cap. Face, hair, body, pose, hands, phone,
  accessories, shadows and background stay; garments, layering and shoes come through. Muse takes at most 10 images
  (a request with 16 answers 400 `invalid_array_length`) and draws 3:4, 2:3, 9:16, square and landscape canvases.
  Separate piece pictures beat one flat-lay sheet; the prompt that names each image by colour and type only is best
  (a styling hint, "zipped halfway", made Muse invent an undershirt). WebP and RGBA PNG inputs both work. The private
  sheet and harness: `~/code/meta-hackathon/out/styld-tryon/` (`preview --name styld-tryon-spike`). Pruna's try-on
  model on Workers AI was not tried.
- **Owner decisions (4 November):** price 2 credits (`prices.tryOn`); results are shareable through a board and need no
  Generated mark of their own (a board picture from a try-on is marked Generated like a sticker); Kris's three photos
  were written into his preview My Gallery by the operator (R2 objects and rows, his account only, no credit, nothing
  found in them).
- **Privacy:** the one exception to "original photos never leave Styld" (ROADMAP › Privacy exception). Only the
  account's own My Gallery photo is sent, and only for a try-on the person started with `thisIsMe: true` (the contract
  refuses one without it; the row keeps `confirmed_at`). The queue checks the photo's account again before sending
  (`TryOnShared.sendable`). The photo goes as Cloudflare Images' re-encoded JPEG (no EXIF or location), each piece as
  its shown picture (drawing, else cut-out, turned as its owner turned it) at most 1024 px WebP. Spans carry the try-on
  id only; no prompt, image or signed address is logged.
- **Server (`generation/TryOn*.ts`):** migration `20261104182716_try_ons` only creates `try_ons` and
  `try_on_pieces` (owner: generation). `POST /api/try-ons` claims its operation id, paces like stickers, holds 2
  credits through the Wallet (`holdId('tryOn', id, 0)`), then the generation queue's `TakeTryOn` draws once: a claimed
  drawing (`started_at`) whose answer was lost is never drawn again; a refusal or a lost answer gives the credits back;
  a result is stored under the photo's prefix, so deleting the photo deletes it. `GET /api/try-ons`,
  `GET /api/try-ons/:id` (both send a stalled one again), `DELETE` (a try-on deleted before it ended is refunded) and
  `POST /api/try-ons/:id/board` (the result as a Generated picture on one of the person's boards, keyed by try-on and
  board). The `tryOns` sweep re-sends stalled try-ons every run. Muse's `tryOn` call is counted as kind `tryOn`.
- **Web (Lab › Try on, `/try-on`, `page/TryOn.ts`):** the person's try-ons; a new one from a Gallery photo, a look's
  pieces in one tap or up to nine pieces, a required "This is me" tick, the 2-credit cost; the page follows it by
  reading the list every 2 s; before and after side by side on a wide screen, a toggle on a phone; Delete after a
  question; Add to board through Save to board's `tryOn` target. A lost answer is retried under the same operation
  id. en and sl copy. Bundle budget 401,200: the page adds 5,773 gzip over the contract's 391,342 (clean worktree); the rebased build
  measures 401,187.
  Story and scene tests `tryOn.story/scene`; native `TryOnBrowserAcceptance` written, not run.
- **Evidence:** unit `TryOnPrompt.test` (words, numbering, canvas, Muse body order and model, the privacy rule, the
  `thisIsMe` and nine-piece contract) and `TryOn.test` over real SQLite and the in-memory Wallet (2 credits held and
  spent once the result is kept; refunded on a refusal and on a lost answer, never drawn twice; a repeat answers the
  same try-on, another under the same id conflicts; another account's photo or pieces are NotFound and nothing is sent;
  past the day's credits the try-on is undone; delete takes the result and refunds an unfinished one). Native
  `TryOnAcceptance` written, not run here. `test:unit` on the rebased result: 1,177 of 1,177 pass.
- **Review round (4 November evening, plan `okay-now-that-this-buzzing-clover`).**
  - Server: a try-on reads only its pieces (`piecesWithIds`, `pictureOf`) and sends its photo as one JPEG, sized by a
    pure `jpegSize`. `confirmed_at` is gone, and the migration was generated again on main's schema as
    `20261104193830_try_ons` (two CREATE TABLEs). A result drawn after the person deleted its try-on is removed.
  - Web: a try-on has its own address, `/try-on/:tryOn`. A lost start or delete is asked again under its operation id,
    so nothing is charged twice. A failed start is Spent, Refused or Lost. "This is me" belongs to one photo, and the
    Checkbox comes from @foldkit/ui. The spent refusal links to more credits (`spentWords`). Captions, piece states and
    the alertdialog delete are in.
  - Cut: the skeleton loader, and sharing the list helpers with Photos.
- **In ChatGPT and Claude.** `photo_list` and `tryon_start`/`get`/`list`/`delete`/`pin` (`mcp/TryOnTools.ts`) run the
  same operations as the website. `tryon_start` refuses anything but `thisIsMe: true`, and its words tell the assistant
  to ask first (owner).
- **Media views (`ui://styld/views-v3.html`).** `tryon_show` (before and after), `gallery_show` (numbered photos to
  pick from), `pieces_show`, `outfits_show` and `piece_show` (all of a piece's pictures) show inline.
  - Thumbnails come from `mcp/Thumbnails.ts`, with per-view limits and 1.5 MiB per result. The collector also keeps
    every grant of an entity.
  - Owner: the person's own Gallery photos, before photos and results may go to the host as these thumbnails
    (ARCHITECTURE).
  - The assistant-views bundle is 379,415 of 393,216 bytes.
- **Styld's chat.** It lists `photo_list` and `tryon_start`/`get`/`list`, its prompt says the price and that it asks
  first, and a try-on it started shows as a card (`ReplyPart.TryOn`, `page/StylistTryOns.ts`), read with the person's
  session.
- **Bundle:** 417,300, with the try-on page, its fixes, the chat card and the contract measured at 417,212.
- **Evidence:**
  - Unit: `McpTryOn`, `McpViews`, `assistantViews.story`, `Stylist`, `stylistTryOns.story/scene` and the try-on
    story/scene.
  - `test:unit` on the integrated tree: 1,254 of 1,254 pass.
  - Native (`TryOnAcceptance`, `TryOnBrowserAcceptance`, McpAcceptance's `views-v3` and its view calls) is written, not
    run: it waits for the final round.
- **Not ours, seen on main:** `format:check` fails on `tools/seed/catalogue.yaml`, and `unused:production` reports
  `packages/server/src/seed/Whole.ts`.
- **Open:**
  - The production promotion (0f) and the preview deploy (51).
  - A live try-on with Kris's photos; the ChatGPT/Claude walk (refresh the connector for the new tools and
    `views-v3`).
  - The final native round.
  - A remembered default photo; the later views (ROADMAP).

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
  says unsure. Production (styld.app): 173 garments imported and all 53 boards public on both house profiles; 50
  checks passed and 3 say unsure (`w-carry-on-7d`, `m-prep-3`, `w-updated-lady`). Its first pass waited on checks
  that failed until production's LiteLLM key gained the judge's model alias (0f, 4 November). The report with the
  board ids is private (`~/private/styld-research/house-boards-2026-11-04/report-production-2026-11-04.md`).
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
  - Production: the three unsure checks, for a person to look at.
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
  Signed out, Home is the landing: one of three hero films, three feature screens, the price and four questions;
  there is no Explore page.
- **Safety:** every public item is checked first (Clef for pictures, DeepSeek through the paid LiteLLM gateway for words); unsure stays out of
  discovery, failed is hidden with a notice; three reports hide; admin MCP tools hide, restore and feature.
- **ChatGPT and Claude (MCP):** OAuth (CIMD and DCR), consent and immediate revoke at `/mcp`; noun_verb tools over
  the same operations; MCP Apps views (the wardrobe and a board) inside the host.
- **Try on:** one of the person's own Gallery photos redrawn by Muse wearing their pieces (2 credits), in the Lab; the
  result can go on a board.
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
