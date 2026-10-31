# Delivery status

Status: active. Sign-in, the wardrobe, capture with real cut-outs (photos, video import, a held-up camera), the review tray, the daily allowance, looks and the assistant's wardrobe view are deployed to the isolated workers.dev preview (release `789a7f2`, with clean pictures, turns on a hanger, scan anything, and the boards' pins, profiles, checks, link import and wishes). Videos of up to 15 minutes are cut into parts on the device. Scope follows `docs/ROADMAP.md`: v2 ports only the v1 behaviour worth keeping.

## Scan anything — 2026-10-31

Replaces clean pictures' milestone C, as the owner widened it on 31 October. It folds in the capture brainstorm of
30 October. The plan's decisions:

- one scan for any scene, with two prescribed ways: laid out on a bed or table, or held up;
- every piece drawn;
- duplicates checked against the whole wardrobe;
- no flat-lay spike.

- **Every piece drawn** (`9573813`): a cut-out Clef judges ready is drawn too. A face keeps the photo and a fragment
  asks for a retake. The backfill queues again pieces kept as clean by the earlier rule.
- **Scenes** (`a843255`): the route asks how the clothes are shown (held, flat, hanging, worn, other), from even
  odds. Pieces laid out are all preselected, even with a hand at the edge or from the camera. On the person-routing
  spike's 44 labelled photos, all 10 laid out came back flat at 0.91 or more; of the rest, only two drawers did
  (`meta-hackathon/out/styld-scan-anything/scene.ts`, about $0.002).
- **More than clothing** (`08a6025`): a photo of several pieces or a laid-out scene also asks SAM for shoes, bag and
  hat, one call each and in parallel. A mask more than half covered by a kept one is dropped. A failed extra prompt
  leaves its pieces out, not the photo.
- **Migration** `20261030235953_capture_imports_and_matches` (`4d30e73`): `captures.import_id`, and on detections
  `whole`, `group_of`, `duplicate_of` (set null with its piece), `matching` and `match_claimed_at`.
- **One card per garment** (`5af0301`, `652cf00`):
  - A later video part, or another photo picked at the same time, names the import's first capture (`importOf`).
  - A queue step compares an import's whole detections oldest first, one at a time, each claimed first. It uses
    Clef's same-garment question against up to 10 sightings of the category, and joins at 0.8. The fuller sighting
    shows.
  - The tray shows one card with its number of sightings. Keeping or discarding the card does the same to its other
    sightings, and a photo's other sighting becomes the piece's back. "Not the same piece? Show them apart" splits it
    (`POST /api/captures/detections/:id/split`).
- **Already in your wardrobe** (`5c2323f`): a sighting that joins nothing is compared with up to 6 of the
  wardrobe's cut-out pieces of its category, same colour first. At 0.8 it comes unticked as "Already in your
  wardrobe?", beside the piece.
- **Guidance and the camera** (`8959b72`):
  - The add page names the two ways before the ways in: lay them out, not touching, in daylight, on a contrasting
    surface; or hold each one up.
  - The camera gains "Lay pieces out": back camera, the flat check, taken when nobody's hands are on the garment.
  - Part of a garment says "Needs a better look".
- **Evidence:**
  - Unit: plan rule, scene answers (one real recording), SAM prompts and overlap on the recorded rail stream, queue
    dispatch, Story and Scene for the add page, camera and tray.
  - Native (`18d8d45`): two seeded imports compared by the real queue job, four parts at once, with the Clef stand-in.
    It proves the merge, the wardrobe match, a fragment, a split, and keeping a card keeping its other sighting.
  - Full gate green: unit 400, native 24/24.
- **Preview, release `789a7f2`** (deployed 31 October with the boards session's link import, wishes, five-tab nav and
  landing). Health reports it and `tools/preview.native.test.ts` passes 3/3. Real providers on the preview test
  account, with synthetic pictures only (`meta-hackathon/out/styld-scan-anything/readback.ts`, run twice, both
  read back the same):
  - A "bed" of the three drawn fixture garments laid apart came back as 3 whole cards, all ticked, in 15 s.
  - The red tee sent twice as photos picked together came back as one card for both captures, seen twice. It was
    unticked as "Already in your wardrobe?" against the account's red tee.
  - The red top on the bed was not taken for that piece. Clef compared it with up to 6 of the account's tops and
    none reached 0.8.
  - Analytics Engine over both runs: 8 SAM calls (clothing, shoes, bag and hat for each bed), 21 Clef match calls,
    6 routes, 7 suggestions.
  - All cards were discarded afterwards.
- **Open:**
  - A two-part video on the preview (the native suite proves parts with seeded sightings).
  - The owner's phone test: a hand-held scan of about 10 pieces and one photo of the bed.
  - Clef's same-garment calls are not yet measured on real wardrobes, nor the extra SAM prompts on real beds.
  - Camera shots join no import.
  - A link capture (the boards session's M6) will go through the same tray and match step.

## The turn on a hanger, milestone B — 2026-10-30

A piece's clean picture turns on a wooden hanger, made on request for 5 credits. The owner chose to use the existing
Vercel AI Gateway key until Styld has its own; `STYLD_AI_GATEWAY_API_KEY` takes over once set.

- **Providers** (`9d6eafc`): Veo 3.1 Lite through the gateway's video protocol, called directly, without the AI SDK.
  Muse draws a strict side view. The prompts come from the MIT interactive-garment starter.
- **Anchors** (`a576368`): the clean picture is top-centred on 720 × 1280, under the keyed Muse hanger from the
  hanger-rail proof. The side view is fitted to its length and apex (`@styld/imaging`).
- **The job** (`a20914d`, `66d4749`):
  - It claims the turn, lays both frames on the key colour and draws the side view once (kept for retries).
  - It starts Veo with JPEG frames and keeps the job id before polling. Delayed messages poll every 15 s, for up to
    15 minutes, and the MP4 is stored.
  - Refusals, lost answers and timeouts refund the credits; a start whose answer was lost is never resent.
- **Frames on the phone** (`4fb99f2`, `4801e3f`): Workers cannot decode video, so the piece page cuts the turn into 30
  frames with Mediabunny.
  - It finds where the turn stops (97% of the final width), keys each frame without the single-picture checks, cuts
    the hook and packs a sheet about the hanger's apex.
  - Clef checks 5 frames against the clean picture: colour ≥ 0.8 on every one, and print ≥ 0.6 only for a garment
    that shows one (`281ba6c`).
  - A kept turn consumes its credits; a dropped one refunds them.
- **Page** (`7c4ba4a`, `662f342`): "Make it turn" with its price, progress notes, and a picture that turns to its side
  and back on each tap. The starter's reversible playhead (MIT) drives it; reduced motion jumps instead.
- **Evidence:**
  - Unit: the gateway adapter, the side view, the anchors, the sheet, the gate.
  - Native (`1052813`, 23 pass): the request, the queue, a stand-in gateway answering with a recorded Veo take,
    Chromium cutting the frames, play on tap, and credits consumed once.
- **Preview, release `281ba6c`**, with real providers on the test account's navy trousers from the rail photo:
  - Veo answered in about 2 minutes; the phone-size Chromium cut the frames in 10 s.
  - Kept: colour 0.947, print 0.028 (plain), sameness 0.695. It plays on tap.
  - 5 credits consumed once.
  - Two earlier tries found two faults:
    - the gateway answered 413 to PNG frames, hence JPEG (`66d4749`); the refusal's status is now logged (`efbf0dd`);
    - the print floor dropped the plain trousers, hence the `printed` question.
  - Spend: 3 Veo takes ($0.36, one of them a probe from the box) and 2 Muse calls ($0.02), on the shared key.
- **Open:**
  - The player's canvas is blank until its code and the 2 MB sheet load; show the still meanwhile.
  - Styld's own gateway key.
  - The owner's phone test of a turn.
  - A gateway that refuses a start shows only its status, not its message.

## Clean pictures, milestone A — 2026-10-30

The owner's decisions are in `docs/ROADMAP.md` (Clean pictures, the turn and video scans). The real photo stays the
source; a clean picture is a marked drawing beside it.

- **The job** (`fb4db12`): a review that keeps cut-outs queues a picture for each in the same batch. A replayed
  review sends the waiting ones again. Clef judges the 512 px cut-out:
  - ready, or a face (≥ 0.3), keeps the photo;
  - a fragment asks for a retake;
  - anything else is drawn.
- **Drawing** (same commit): the drawing is claimed first. Muse draws it on green, or on magenta for a green garment.
  The result is keyed, cropped and stored as `clean-<version>.png`.
- **The check:** Clef compares the drawing with the cut-out. The weaker of same and faithful decides:
  - from 0.8 the drawing is shown;
  - from 0.5 it is offered;
  - below that it is dropped and its file deleted.
- **Failures:** every write is a conditional move. Muse refusing ends the picture; Muse busy hands it back to the
  queue; an answer lost on the way, or a claim older than 3 minutes, ends as unknown and is never drawn again.
- **Serving** (`e64c258`): `Piece.picture` is `{ state, shows, version }`.
  - `shownImage` is the one rule for which image a piece shows, shared with the boards session.
  - `/cdn/pieces/:id/photo|clean/:size` serves either picture.
  - `PUT /api/pieces/:id/picture` chooses between them.
  - Deleting a piece deletes its drawings.
- **Redraw and backfill** (`84a41bb`):
  - A redraw holds 1 credit, with the owner's words in the prompt (at most 80 characters, never logged). It is
    drawn whatever Clef's verdict unless a face may show. The credit is consumed for a drawing the owner can see,
    refunded otherwise.
  - Backfill: `GET`/`POST /api/pictures` counts and queues every kept cut-out without a picture, free.
  - Assistants get the same redraw as `picture_redraw`.
- **Web** (`56012a3`):
  - The piece page shows the "AI-cleaned picture" label and lets the owner switch between drawing and photo.
  - A proposed drawing appears beside the photo, to take.
  - The redraw form asks for a description and states the price.
  - Retakes and failed drawings say why the photo stays.
  - The wardrobe shows a "Make clean pictures" line.
  - Image addresses carry the version.
  - The initial bundle went from 300,692 to 303,338 gzip bytes.
- **Measuring** (`11e175f`): `picture.<state>` points in Analytics Engine, listed by `tools/ai-usage-report.ts`, so
  Muse's share of shown drawings can decide the default.
- **Evidence:**
  - Unit: the keyer, Muse's request, retries and unknown outcomes, Clef judge/compare on recorded answers, the
    gates, and the shown-image rule.
  - Native (`cdd1a78`): the job, D1, R2, the queue and the Wallet with stand-ins for Clef and Muse, which answer
    by colour (`PictureFixture.ts`). `CLEF_API_BASE` exists for that run only.
- **Simplifications to know:**
  - A redraw replaces the last drawing: if it fails, the photo shows.
  - Pieces added outside a review (upload, assistant) are queued by backfill, not when added.
  - A credit held for a piece deleted before its drawing ends stays held for that day.
  - Pictures share the capture queue: a large backfill delays captures by minutes. The plan's remedy is a
    separate queue.
- **Preview** (release `4f6815f`, deployed after a full gate: unit 324, native 21, initial bundle 311,187 gzip):
  `/api/health` reports the release and the deployed acceptance passes (3 tests). On the preview test account,
  with real providers:
  - **The first keep:** a kept tee was judged ready (Clef 0.73, face 0.012) and stayed as its photo after 7.7 s.
  - **A redraw with a hint:** Muse drew in 9.8 s ($0.01). The drawing was keyed on green and checked: same 0.26,
    faithful 0.34, so it was dropped, its file deleted and the credit refunded (allowance unchanged at 36). That
    is the right call for this fixture, a flat illustration of a tee that Muse draws as a photographed one; the
    spike recorded the same pair at 0.28.
  - **Analytics Engine** has `call.meta-muse.draw`, `call.clef.judge`/`compare`, `picture.kept-real` and
    `picture.rejected`.
  - **Workers Logs** for the hour show `Styld.Picture` spans and no `data:image`, `b64_json` or hint text.
- **Open:**
  - A drawing shown or offered on a real photographed garment: the owner's backfill (about $0.21 for 21 pieces,
    the owner's tap).
  - The owner's phone test.
  - Whether a paid redraw scored under 0.5 should be offered instead of dropped. The spike found Clef scores
    repaired garments low even when they look right.
  - Milestone B, the 5-credit turn, waits for Styld's own Vercel AI Gateway key.
  - Milestone C, scanning by video with one card per garment.

## Plan: boards, profiles and social — 2026-10-30

The owner un-parked social and planned the next iteration in a grilling session; `docs/ROADMAP.md` (Boards, profiles
and social) holds the decisions, `docs/ARCHITECTURE.md` the recorded deviations, and `DESIGN.md` the new screens. The
design is the Gallery 2 prototype (`docs/design/gallery-2/`).

- **Order:** pins and the collage, MCP for boards, profiles with model checks, public pages and link previews, saves,
  follows, blocks and the feed, Explore, curation and search, the wishlist and Add from a link, generated pictures and
  mood boards, then review rounds. Each step is deployed to the preview and read back.
- **Built so far (M1, on main, not yet deployed):**
  - The table's placement rules live in `@styld/protocol` (`fb7b2c9`), shared by the editor and, next, the server and
    the assistants.
  - Pins (`a774956`): the new `board_pins` table pins pieces, looks and pictures, newest first. Placing a piece on the
    table pins it in the same batch; pinning leaves the table's version alone; taking a pin off clears it from the
    table, deletes a picture with its bytes, and moves the version on. Pins, unpins and table saves replay by
    operation id; a save's receipt lands only at the loaded version. Lists carry summaries (table, four newest pins,
    count). Evidence: a `node:sqlite` migration test and native API acceptance.
  - The board page: `/boards/:id` shows the collage as a card above the grid of pins, with Add (a sheet of the
    wardrobe's pieces and the person's looks), taking a pin off, and the board's settings (rename, delete after a
    second ask). The editor moved to `/boards/:id/collage`; its tray offers the board's pins first, pictures taken
    off the table included. A board reloads when its page comes back into view, unless a change of its own is
    waiting. Copy reuses v1's reviewed `studio.*`; new `board.*` keys are in both languages (Slovenian awaits review).
    Evidence: Story tests and the native browser walk (new board, collage, pins, unpin, rename, desktop, Slovenian).
  - **Bundle:** the owner's one raise for this iteration lifts the first-load budget from 307,200 to 368,640 gzip
    bytes (`tools/bundle-check.ts`). Measured with the board page: 309,017 first load, 568,360 all assets, 1,582,534 SSR
    source bytes.
  - "Save to board" from a piece's page and a look's page (`2012c66`): the person's boards with their pin counts, or a
    new one by name; v1's reviewed `saveToBoard.*` copy.
  - **Preview:** deployed by the capture session at `4f6815f` after a green full gate (native 21/21, the board walk
    included); `/api/health` reports that release; D1 holds `board_pins`.
- **M2, assistants make boards (built, not yet deployed):**
  - Tools: `board_list`, `board_get`, `board_create`, `board_update`, `board_delete`, `pin_add`, `pin_remove`,
    `picture_pin` (a picture from a public https address, through the same guarded import as `piece_add`),
    `collage_arrange` (things added where they land, then `keep`, `tidy` or `outfit`) and `collage_set` (an exact
    table from the version read). Every change replays by operation id.
  - The Boards service gains `arrangeBoard` (it reads the board as it is, once more if an editor saved meanwhile) and
    `setTable`; the table's save is one core shared with the editor's save. Placement for things an assistant adds
    (`landed`, `arranged`) lives in `@styld/protocol` beside the editor's.
  - `board_show` draws the board inside ChatGPT and Claude: the collage as a still table, then the pins, pictures as
    data URLs in `_meta` (at most 24, the collage's first). The view's resource is now `ui://styld/views-v2.html`;
    its HTML is 350,358 of 393,216 bytes.
  - The instructions say how to make a board for a request.
  - Evidence: unit tests for the tools, their refusals and `board_show`; protocol tests for landing and layouts;
    view stories; native MCP acceptance creates, pins, arranges, replays, sets exactly (a stale version is refused),
    shows and lists a board through both protocol eras.
- **M3a, profiles (`0003c47`, on main, not yet deployed):**
  - The migration `profiles_and_checks` adds `profiles`, `content_checks`, a board's visibility, moods, publish,
    feature and search columns, and `looks.shared_at`.
  - `/profile` edits the handle (v1's rule, the reserved list), name, city, bio (160), avatar tone (initials on one of
    eight tones) and whether the wardrobe shows. A profile is published only with a handle; a handle someone else took,
    even between the check and the write, is refused.
  - Account links to it. Tools `profile_get`, `profile_update` and `profile_publish`.
  - Evidence: Story tests, MCP unit tests, native API acceptance (handles taken, reserved and invalid; publishing).
    Full gate green before landing, native 22/22, bundle 315,309 first load.
- **M3b, checks of what goes public (`f92575f`, on main, not yet deployed):**
  - `safety/Judge.ts`:
    - Clef-flash scores up to three pictures (a minor at 0.3 fails; another harm at 0.85 fails, at 0.5 is unsure;
      words addressed to an assistant are unsure).
    - Llama Guard 3 reads the words. S1, S3, S4 and S9–S12 fail; other hazards are unsure.
    - A model gets 20 seconds. Pictures go as WebP thumbnails delivered with `fallback: 'none'`, so a stored original
      never reaches a model.
    - Native acceptance names a stand-in judge (`CHECKS=stand-in`). The preview runs `CHECKS=live`.
  - `safety/Checks.ts` checks profiles, boards, looks and pieces, but only while their owner has made them public.
    - A piece is public while its owner's published profile reaches it: through the shown wardrobe, one of their
      public boards or a shared look. Someone else's board never publishes it.
    - Each check records the digest of what the model read. An answer lands only on that digest, and unchanged content
      is not judged again.
    - Publishing, a board going public and a look being shared are checked at once. A board's pieces and a shown
      wardrobe go through the new `StyldV2Checks` queue (five attempts, 30 s apart).
    - An edit of a public board (rename, table, pins, picture) or of a published profile is checked again.
  - Web:
    - The board's settings and a look's page have a Public switch, which needs a published profile.
    - The owner sees "being checked", "kept out of Explore and search" or "hidden from others" with the reason, on
      the board, the look and the profile. The copy reuses v1's `share.*`, plus new `share.check.*` keys.
  - Tools `board_publish` and `look_share` return the check state.
  - Evidence:
    - Story tests for the switch and sharing; MCP unit tests.
    - Native API acceptance: a board refused before the profile is published; checks passing at once; an edit failing
      through the queue; the verdict staying after the board goes private; an unsure bio; sharing a look and taking
      it back.
  - Open:
    - The check is marked pending right after the content's write, not in its batch (ARCHITECTURE › deviations).
    - There is no sweep yet for checks still pending after the queue's five attempts.
    - The thresholds are uncalibrated (the spike on fixtures in en and sl is still to run).
    - Calls are not yet metered in Analytics Engine.
  - Full gate before landing: unit 352, native 23/23, first load 319,032 bytes.
- **A public piece's picture is checked again (`0c1843f`):** processing finishing, review making pieces, a clean
  picture moving state, a redraw and the owner's choice of picture call `PieceChanged`. While others can see the
  piece, its check goes back to pending and the queue checks it again. A check it cannot mark is logged and never
  fails the work.
- **M3c, public reads (`e74c043`):**
  - `PublicApi` serves `/api/public/{profiles/:handle,boards/:id,looks/:id,pieces/:id}` signed out, limited to 300
    reads a minute per network (`PUBLIC_READ_RATE_LIMIT`).
  - A thing shows while its owner's profile is published, the thing is public, and its check and the profile's passed
    or were unsure and were not hidden. Anything else reads as not there.
  - A piece shows only its cut-out or clean drawing, never the photo it came from, and only through its owner's
    shown wardrobe, public boards or shared looks.
  - Pictures come from `/cdn/public/{pieces,pictures}/:id/:size` as Images-binding WebP, with `fallback: 'none'`,
    `public, no-cache` and an ETag, so going private takes them down on the next view.
  - Evidence: native API acceptance covers:
    - a picture pin shown and its WebP served;
    - a piece's photo refused until it has a cut-out, then shown with a 304 on revalidation;
    - a piece added after publishing checked and shown;
    - no notes on a public piece;
    - private, hidden-wardrobe and unpublished states each taking everything down.
- **M3d, visitor pages (`1f87e14`):**
  - `/@handle` shows a published profile: avatar, name, handle and city, bio, then Boards, Looks and Pieces (Pieces
    only when the owner shows the wardrobe). `/pieces/:id` shows a public piece.
  - `/boards/:id` and `/looks/:id` show their owner their own page; a visitor, signed in or not, sees the public view,
    read only, with a byline to the profile.
  - The copy is v1's `profile.public.*` and `share.byline`.
  - Evidence: scene tests (profile tabs, hidden wardrobe, missing profile, piece page, visitor board and look) and a
    native Chromium walk signed out (profile, its public board, a private board's address reading as gone, no CSP
    violations).
  - Open: link previews and `X-Robots-Tag` (M3e), follow and share buttons (M4), and the owner's own way to their
    `/@handle` from the profile editor.
- **M3e, link previews:**
  - The edge reads a public page's preview from `/api/public/meta` while the page renders, waiting at most 1.5 s.
    It then sets the title and adds the description, Open Graph tags, Twitter's card and the canonical link with an
    `HTMLRewriter`.
  - A private, unpublished or held-back page gets no preview, and a slow or failed read sends the page unchanged.
  - The copy is v1's `profile.public.meta*` and `share.board.meta*`, plus new `share.look`/`share.piece` lines, in
    the reader's language.
  - The picture is the page's first public cut-out or picture.
  - `/share/board/:id` answers 301 to the board.
  - The preview's edge sends `X-Robots-Tag: noindex`; nothing uses `robots.txt Disallow`.
  - Evidence: unit tests for escaping, the tags, the redirect and the read; native acceptance of a board's and a
    profile's tags as a crawler sees them, a private board without them, and the redirect.
  - Open:
    - A composed card at `/cdn/og` (up to four cut-outs, drawn with the Images binding) replaces the single picture
      later.
    - The owner checks a real preview in a messaging app once deployed.
- **Preview (M3):** deployed from `abe4a2f` on 30 October.
  - `/api/health` reports release `abe4a2fa6c40fdd648b3115470eeb42fe79bbf7b`.
  - The plan updated 3 Workers and created the edge's `ROBOTS` and the API's `PUBLIC_READ_RATE_LIMIT` bindings. It
    deleted nothing, and there was no migration.
  - `tools/preview.native.test.ts` passed 3/3.
  - Signed out, pages carry `x-robots-tag: noindex`, `/share/board/:id` answers 301 to the board, and a public miss
    answers 404 (`PublicNotFound`).
  - Live readback on the preview test account (`@kris.preview`, left published for the owner to try):
    - publishing the profile and making a board public both passed the live judge at once;
    - of three pinned pieces, two passed Clef through the queue within about 10 s and show publicly. The third, a
      shoe, stays hidden: it shows its photo, or its check held it back. The admin tools (M5) will show which;
    - the board's link preview, read as a crawler, has its title, line, address and a cut-out as `og:image` (a
      29 KB WebP from `/cdn/public`).
    - Board: `/boards/bd_xAA4SsaoKuzQ1yDiVVI-Qg`; profile: `/@kris.preview`.
  - Still open: the owner's check of a real preview in a messaging app.
- **M4, people (server and assistants; web next):**
  - The migration `saves_follows_blocks_reports` adds `saves`, `follows`, `blocks` and `reports`, each cascading from
    accounts; the tables live in `packages/db/src/social.ts`.
  - `/api/saved`, `/api/people/:handle{,/following,/blocked}`, `/api/following`, `/api/blocked`, `/api/reports` and
    `/api/feed`, and the tools `saved_list`, `save_set`, `follow_set`, `following_list`, `block_set`,
    `report_create` and `feed_get`.
  - **Saves** are bookmarks of others' public pieces, looks and boards, shown while still public to the saver.
  - **Follows** are private and one-way.
  - **Blocks:** a block hides each person from the other on every public read, ends follows both ways and is never
    told. Pictures are not gated by blocks (recorded deviation).
  - **Reports** use v1's reasons and limits (10 an hour, 500-character note). A report re-judges the target in place,
    keeping its verdict until the new one lands; three reporters hide a board, look or piece. Profiles only leave
    discovery, which M5 applies.
  - **The feed** is a query over follows: boards that went public, pins on public boards, shared looks and pieces in
    shown wardrobes. Each is gated as discovery is, on a passed check, then merged by time and interleaved at most two
    of one person in a row.
  - Evidence: MCP unit tests, and native API acceptance of a save, own-save refused, follow, the feed, a block both
    ways (follow ended, save hidden, signed-out still shown), unblock, and three reports hiding a board.
- **M4, people on the website:**
  - On `/@handle`, a signed-in visitor gets Follow (pressed while following), Report profile and Block. A block asks
    once more, with v1's copy; signed out, there is a way to sign in instead.
  - A public piece's page has Save and Report piece.
  - The report form uses v1's reasons, note, sending, sent, failed and too-many copy.
  - Home shows "From people you follow" once the feed has something; Boards shows "Saved from others".
  - Evidence: story tests for follow, block, save and the report flow; scene tests for the visitor's actions and the
    sign-in link.
  - Open:
    - the Save motion into Boards;
    - lists of who one follows and blocked on the website (the API and the tools have them);
    - a browser walk of following and the feed.
- **Preview (M4):** deployed from `f470631`; `/api/health` reports release
  `f4706316fa3d0958d5c1b71f027b0f5e3821103c`.
  - The plan updated the database (the `saves_follows_blocks_reports` migration) and the three Workers. It created
    and deleted nothing.
  - `tools/preview.native.test.ts` passed 3/3.
  - Signed out, `/api/feed` answers 401. Signed in, `/api/saved`, `/api/following`, `/api/blocked` and `/api/feed`
    answer 200 on the migrated D1, and following oneself answers 422 `NotWithYourself`.
  - Still to read back: a follow, save and block between two real accounts (the preview has one test account).
- **M5a, discovery (server and assistants):**
  - Signed out or in, `/api/public/explore?mood=` serves Edits from Styld (house accounts' public boards), featured
    boards, people to follow (featured first) and the newest public boards, in one of the six moods if asked.
  - `/api/public/search?q=` finds people by name and handle (an exact handle first) and public boards by name or a
    mood word in English or Slovenian. It uses the same fold as the on-device search, matched with `LIKE` on
    `search_text`.
  - Discovery shows only what passed its check: never unsure, never hidden, never a profile three people reported,
    and never across a block.
  - Tools `explore_get` and `search_public`.
  - Evidence: MCP unit tests, and native API acceptance of search by accented name and by board name, Explore's
    newest, and an unsure board leaving search while its link still works.
- **M5b, curation for admins:**
  - Tools `curation_feature` (a board or person in Explore), `curation_house` (the house account, which may take the
    reserved `styld`), `curation_hide` (hide or restore whatever the check said), `report_list`, `check_list` and
    `check_rerun`.
  - They are listed only to accounts whose sign-in email is in `STYLD_ADMIN_EMAILS`, read in the same D1 read as
    the enabled check. Anyone else gets them refused as unknown tools.
  - The preview reads the setting from the owner's `.env.preview.local` and has no admins while it is unset.
  - Evidence: unit tests that the curation tools stay out of the members' list, keep noun_verb names, and that admins
    are known by email in any case.
  - Open: the owner adds `STYLD_ADMIN_EMAILS`, then marks `@styld` and features boards from an assistant.
- **M5c, Explore on the website:**
  - `/explore`, readable signed out, shows Edits from Styld, featured boards, people to follow, mood chips (All and
    the six moods, in en and sl) and the newest public boards in the chosen mood.
  - Home links to it under the feed, or in its place.
  - Evidence: a scene test of the sections, a person's link, and choosing a mood, which reloads.
  - Open:
    - the five-tab navigation (Home, Explore, Ask, Wardrobe, Boards), with You moving out of the tabs;
    - the landing's inspiration from Edits from Styld.
- **Board moods:**
  - A board carries up to three of the six moods. The owner picks them in the board's settings, each saved as it is
    picked, and assistants set them through `board_update`.
  - Explore's mood chips and search's mood words find boards by them.
  - Evidence: a story of picking with a fourth refused, and native acceptance of Explore filtering by mood.
- **People and boards in Ask:** once typing pauses (or on a suggestion), Ask also searches people and public
  boards on the server and shows them under "In your wardrobe" as People and Boards. An answer for a query since
  changed is dropped. Evidence: Ask stories for the search and a stale answer.
- **Save and Report on others' boards and looks:** a visitor's board and look pages carry Save (into Saved from
  others) and Report board or Report look, through the same actions as a piece's page. Evidence: the visitor scenes.
- **Preview (M5):** deployed from `d9506df`; `/api/health` reports release
  `d9506dfebf1407d96121cc4a3af8d36696c6953a`.
  - The plan updated the three Workers. There was no migration, and nothing was created or deleted.
  - `tools/preview.native.test.ts` passed 3/3.
  - Signed out, `/api/public/explore` lists `@kris.preview` among people and its public board among the newest,
    `/api/public/search?q=kris` finds the profile, and `/explore` serves.
  - Edits from Styld and Featured are empty until an admin, listed in `STYLD_ADMIN_EMAILS`, marks the house account
    and features boards.
- **Preview (five tabs, the landing, `link_import`, wishes):** the capture session deployed main at `789a7f2`, with
  `/api/health` reporting release `789a7f2894195278a8fe45ea6968c6e99eb61aac`.
  - The plan was four updates, including the wishes migration; nothing was replaced. `tools/preview.native.test.ts`
    passed 3/3.
  - Chromium at 390×844, signed out: the landing's A place to begin shows the newest public board and a way to
    Explore, and `/explore` lists people.
  - Signed in as `@kris.preview`: the navigation reads Home, Explore, Ask, Wardrobe, Boards; the Explore tab arrives
    with its title focused; `/api/wishes` answers 200. No page error or console error.
  - The Wishlist tab (`acbd463`) is not deployed yet.
- **Five tabs:**
  - The navigation is the design's Home, Explore, Ask, Wardrobe and Boards. You (the account) is the initial in the
    masthead.
  - Explore is a tab: it keeps its place and mood between tabs, and is asked for again behind.
  - Evidence: the native instant-tabs walk taps Explore, and Explore loads steady.
- **The landing's inspiration:** signed out, Home's "A place to begin" shows Edits from Styld (or the newest public
  boards before there are any), with a way to Explore. The section keeps its room while they load. Evidence: a
  scene test.
- **Next:**
  - M7: generated pictures and Make a mood board.
- **Preview (M6):** deployed from `419f3d2`; `/api/health` reports release
  `419f3d2fd705367a3d956fa4e4dc17acf6afee40`. The plan created `LINK_IMPORT_RATE_LIMIT` and updated the three
  Workers. `tools/preview.native.test.ts` passed 3/3.
  - Signed in as `@kris.preview`, `/api/links/picture` read a real product page (Allbirds, a Shopify shop) into an
    upload with the product's name. Zara answered `blocked`, which asks for a photo. Everlane and Gymshark were
    `notReached`, and a Patagonia page had no picture.
  - The first deploy (`25d6986`) showed Shopify's `og:image` over plain http and that shops turn away fetches with
    no User-Agent. `419f3d2` prefers `og:image:secure_url`, asks for http pictures over https, and names Styld.
  - The capture from a link was not made on the preview, so no provider was paid; native acceptance covers it.
  - Many large shops refuse requests from Cloudflare's network, whatever the User-Agent. Add from a link works
    where a shop lets it, and asks for a photo where it doesn't.
- **M6d, Add from a link on the website:**
  - The Add pieces page has a fourth way in, From a shop's page, and Ask's + sheet has Add from a link
    (`/wardrobe/add#link`).
  - `POST /api/links/picture` reads the page with `link_import`'s guard and takes its picture into a received
    upload of the person's (`LINK_IMPORT_RATE_LIMIT`, ten a minute per account). The page then sends it like a
    picked photo, with the capture source `link`, so receipts, credits and "Already in your wardrobe?" are the
    capture path's.
  - A link row is named by the page's name once read, else its address. Trying again keeps the operation and the
    picture already read. A shop that keeps Styld out, or a page without a picture, asks for a photo or a
    screenshot instead.
  - Evidence:
    - unit: the picture read into an upload with the page's name, and a picture Styld cannot take counting as none;
    - stories: an empty address, and the retry keeping its operation and upload;
    - scenes: the row, a blocked shop, a retry handing over to the tray, and the + sheet's options;
    - native: signed out answers 401, http is refused, and a capture from a link goes to the tray as one.
- **Signed out on public pages:** a visitor without a session sees Sign in to save (or Sign in to follow, on a
  profile) where Save, Save to wishlist, Follow and Report would be, instead of actions that fail. Signed in, a
  profile shows no Sign in while the visitor's standing is read, and none on one's own. Evidence: the visitor
  scenes, signed in and out.
- **M6c, the wishlist on the website:**
  - Wishlist is the Wardrobe's third tab (`/wardrobe/wishlist`), beside Pieces and Looks. Each wish shows the piece
    and whose it is while it stays public, else its name and "No longer shown". Remove takes it off at once.
  - A public piece's page has Save to wishlist; once saved, it links to the wishlist.
  - Got it on a wish takes it off the list and opens the ways to add the piece (`/wardrobe/add`).
  - Evidence: scene tests (the tab, a gone piece, Remove, a failed load and its retry, saving from a piece page), a
    People story, and the native instant-tabs, title and steady-load walks including the tab.
- **M6b, the wishlist (server and assistants):**
  - The migration `wishes` adds a private `wishes` table. Its source piece is set to null when the piece goes, and
    the wish keeps its name and category.
  - `/api/wishes` (list, add by public piece, remove) and the tools `wish_list`, `wish_add` and `wish_remove`.
  - A wish shows the piece while it is still public to the person, and nothing of it after. One's own pieces cannot
    be wished for, and wishing again keeps the first wish.
  - Evidence: native API acceptance of a wish, own refused, the repeat kept, the piece deleted with the wish left
    by its category, and removal. The schema test lists the table.
- **M6a, adding a piece from a link (assistants):**
  - `link_import` reads a shop's product page: its JSON-LD `Product` (name, first picture), else Open Graph or
    Twitter tags. Relative addresses are made absolute and entities read.
  - The picture goes through the same guarded import as `piece_add` and is added straight to the wardrobe (the
    roadmap's "assistant adds skip the tray").
  - Only public https pages are read, with redirects followed by hand (at most three), a timeout and a 1 MB cap. A
    shop that answers 401, 403, 429 or 503 is `blocked`, and the assistant asks for a photo instead.
  - Evidence: unit tests on fixture HTML (JSON-LD graph, Open Graph in either attribute order, broken JSON-LD, no
    picture) and on a fake HttpClient (redirect, blocked, not https, not a page).
- **Shared with the capture session:** migrations are generated one at a time; public delivery reuses its rule for a
  piece's shown picture; generated pictures reuse its Muse provider.
- **Still to settle in spikes:** Clef and Llama Guard thresholds on fixtures in English and Slovenian, drawing text
  with the Images binding for link previews, and Muse for prompts without a garment.

## Camera test fixes and person routing — 2026-10-30

The owner's afternoon test on the preview: 9 camera shots, 5 pieces kept, judged "quite ugly". Diagnosis and the
owner's decisions are in this session's notes; the decisions are a flat-lay capture mode as the main way in and a
capped test of image models before any generated product photo.

- **Back step** (`5131e9f`): the camera checked a turned printed tee about ten times but never took its back. The
  check called the plain back a front of the same garment, which the camera read as not turned yet. At the back
  step a garment is now taken as the back unless the check sees another garment's front (Story).
- **Only what a person holds** (`5131e9f`): 3 of 9 shots were the empty room while the owner fetched the next
  piece, with clothes on the bed as the main subject. The check also asks whether a person holds the garment up
  (Clef `holding`), and a held-up shot needs it (Story). The check request names its layout, `held` or `flat`.
- **Pairing** (`5131e9f`): a back joins its front's best cut-out even when that one came out unticked; before, it
  stood alone. Covered natively only where the front is ticked (providers off always tick it).
- **Photos with a person go to SAM** (`42baae7`, item 1 of the research brief): Clef's route also asks whether
  any part of a person shows; background removal takes only one garment with nobody in the picture, such as a
  piece laid flat. With a person, the held or shown piece is preselected. The assistant's photo import follows the
  same rule. Unit tests with the spike's recorded answer for a held-up garment.
- **Preview** release `42baae7`: `/api/health` reports it, deployed acceptance 3 tests.
- **Open**: the flat-lay camera mode; the image-model test; the turning hanger rail proof (research handoff
  `styld-hanger-rail-handoff.md`, Stage A outside v2); the owner's wardrobe still holds the broken fragments from
  the try-on video.

## Instant tabs and steady pages — 2026-10-30

The owner tapped through Home, Wardrobe, Boards and Ask on a phone and saw the layout jump, and found Ask's search
broken. Measured on the preview (375×812, every layout-shift entry with its sources):

| Page     | CLS before |
| -------- | ---------- |
| Home     | 0.37       |
| Boards   | 0.16       |
| Ask      | 0.10       |
| Wardrobe | 0.0001     |

The causes:

- Every tap reloaded the whole document.
- The nav and Home only drew after the session read.
- Loading states didn't have the loaded pages' shape.
- Titles started at four different heights.
- Static files revalidated on every load, and fonts swapped late.

The owner chose **instant tabs**: Home, Wardrobe, Looks, Boards, Ask and You switch inside the page with Foldkit's
routing, following Foldkit's own website. Other pages keep full loads.

- **Static files and fonts** (`37c7635`):
  - `public/_headers` serves `/assets/*` and `/fonts/*` as `immutable`.
  - The Anton files carry their content hash; `tools/public-fonts.test.ts` checks it.
  - The document preloads Hanken (latin-ext only for Slovenian).
  - Until Hanken lands, text draws in Arial resized to Hanken's measured metrics:
    - weight 400: size-adjust 100.44%, ascent 99.57%, descent 29.87%;
    - Arial Bold for 600: size-adjust 93.83%.

    On an English and Slovenian sample at 335px, this breaks every block exactly as Hanken does (476px against
    476px; plain Arial gives 498px).
- **One page head:**
  - `page/PageHead.ts`: 8px under the top bar, then one row at least 44px tall. The title sits at its start; the
    round action, or an empty slot of the same size, sits at its end.
  - Every tab page uses it, including Home's Anton day.
  - Looks gets the same + as Wardrobe, so the Pieces/Looks tabs stay put.
  - The Slovenian nav label "Omara" becomes "Garderoba", like the page title (awaits owner review).
  - The browser journey checks that every tab page's title starts at the same height.
- **One list of pieces, kept on screen while refreshed:**
  - The tab pages' lists are Foldkit `AsyncData`: the pieces, the looks, the boards, and Home's last board and tray.
  - Each page has a `revisit` built on `Update.refresh` with `AsyncData.revalidateOrLoad`:
    - a first visit loads;
    - data already here stays on screen (`Refreshing`) while it is asked for again;
    - a request on its way isn't repeated;
    - a failed refresh keeps the data (`Stale`).
  - The app's wardrobe list is the only one. Home and Ask read it; their retry buttons hand off to it.
  - The 2-second refresh while a piece is processing is now a Subscription. The board editor has its own copy of
    the list, which refreshes under its own key.
- **Each page drawn in its final shape before its data:**
  - **The nav doesn't blink.** While the session is read for a request that came with a session cookie, the nav
    shows with a blank avatar of the same size.
  - **Home starts at once.** With that cookie, Home draws today's table:
    - the headline's line kept with "Today" for screen readers;
    - the 4:5 paper;
    - the outline of Wear this and Spin.

    It starts loading at init rather than after the session read. The page's title is "Today".

  - **Pick-up arrives in one piece,** once the table and its answers are in.
  - **Spin only.** The drop-in plays only after Spin, not on every load.
  - **The footer stays below the fold.** Tab pages' `main` reaches the bottom of the screen without stretching its
    rows.
  - **Skeletons in the shape of what is coming:**
    - Wardrobe: the 44px category row and captioned squares.
    - Looks: the hint and cards.
    - Boards: tiles with their paper.
    - Account: the identity box.

    They use `Skeleton.styles.ts` (quiet paper-2, no shimmer) and are `aria-hidden` beside a hidden status line.

  - **Tests:**
    - SSR tests check that a cookie draws the nav and the skeleton, and that no tab page carries an inline style.
    - The browser journey adds up every layout shift (taps included) and holds each full load of Home, Wardrobe,
      Looks, Boards and Account under 0.02.
- **Tabs switch inside the page.**
  - Home, Wardrobe, Looks, Ask, Boards and You are routed in the browser with Foldkit's `routing` and
    `Runtime.hydrate`, after Foldkit's own website. The server renders by URL.
  - `Navigation.followLink`:
    - between tab pages, for someone signed in, pushes the address;
    - on the current tab, scrolls back up;
    - for a section of the page, pushes and scrolls there;
    - for everything else, including the board editor, pieces, looks, capture and sign-in, loads whole.
  - On `ChangedUrl` the tab's page opens with what the app already has, through the pages' `revisit`, refreshed
    behind it. Ask closes its + sheet, and the new page starts at the top with its title focused (`Dom.focus`).
  - Tab changes cross-fade through `viewTransition`, with the navigation named so it stays put. The runtime catches
    aborted transitions and skips them under reduced motion.
  - The telemetry route names include the tab pages.
  - Story tests cover the link rules and opening a seen, cold or in-flight page.
  - The browser journey walks Home → Wardrobe → Looks → Ask → Boards → Account → Home, then Back, Back, Forward, and
    quick taps. It checks:
    - the document is never reloaded;
    - nothing moves (under 0.02);
    - each page starts at the top with its title focused;
    - a page seen before shows no skeleton;
    - a board still loads whole.
- **Ask's search forgives the way people type** (`page/AskSearch.ts`):
  - It ignores case, accents (č, š, ž, đ) and punctuation, so commas work.
  - Every typed word must match the start of a word the piece answers to, or the same word with another
    Slovenian or English ending: "črne" finds black, "jakna" jackets, "obleka" dresses, "modro" navy and blue.
  - It reads the piece's name and notes, and its category, shelf and colours in both languages. Opening Ask loads
    the other language's catalog once.
  - `ask.searchWords.*` adds the everyday words a category's name misses, such as "čevlji" and "obutev" for shoes,
    and "hlače" for bottoms.
  - Only ready pieces match.
  - Opening a tab page moved out of App.ts into `PageEntries.ts`.
- **Ask rebuilt:**
  - **The field:** `form role=search`, so Enter shows what was found and closes the keyboard.
    - Phone hints: `enterkeyhint=search`, no autocapitalise or autocorrect.
    - The placeholder says what it searches ("Search your wardrobe" / "Išči po garderobi") and ends in an ellipsis
      if it is cut.
    - The browser's own clear button is hidden. A quiet 44px clear refocuses the field.
    - The search stays in the address (`/ask?q=…`, written 300ms after typing pauses with `replaceUrl`), so coming
      back to Ask brings it back.
  - **The +:** the black 52px circle is gone. A quiet + inside the pill opens a `@foldkit/ui` Dialog as a sheet
    rising from the bottom:
    - a scrim, a grab bar, "Add", a close button and the two ways to add;
    - Escape and the scrim close it, and focus goes in and back;
    - it is drawn only while open, because the dialog lays itself out with inline styles the CSP refuses in server
      HTML.
  - **The states:**
    - Suggestions sit in one fixed 44px row, built from ready pieces: their kinds, then their three commonest
      colours. There is no heading.
    - An empty wardrobe says what belongs here and offers "Add clothes".
    - Loading draws the chip row's shape.
    - Results sit under "In your wardrobe" with the count.
    - Nothing found says so once and offers Clear and the suggestions.
  - **The stylist** is a secondary pill with its icon, linking to the account's assistants section
    (`/account#assistants`).
  - **Captions** are shared with the Wardrobe (`pieceLabel` in `WardrobeWords.ts`).
  - **Tests:**
    - Story and scene tests cover these states.
    - The browser journey searches in Slovenian (čevlji, cevlji, obutev, "črne, čevlji", "modra, čevlji"), opens
      the sheet, closes it with Escape and checks focus returns to the +.
    - Ask's full load is held under 0.02.
  - **Bundle:** the first load is now 300,211 of 307,200 gzip bytes, and the Dialog is most of this commit's growth.
    About 7 KB of headroom is left; the next large addition needs a lazy chunk or a budget decision.
- **Preview release `1e15f12` and the walk on it:**
  - **Deploys.** All three Workers updated, nothing else in the plan:
    - worker `3f6c0900-b480-43dd-b921-821f185c05b5` (version `11d879ac-5c89-4aa1-a8b3-d902b216bc57`);
    - website `94fa13e0-c5fa-48ca-adcd-c455bc7d8888` (version `56961a02-5825-4f57-ae26-9ea8765b7bbe`);
    - edge `450859cb-8be2-46c7-8084-b6f927e43e97` (version `1454b02f-6275-4b00-8534-9082de72f741`).
  - **Readback.** Health reports release `1e15f127…`. `tools/preview.native.test.ts` passes 3/3, including the new
    check that the preloaded font, the entry script and the Anton file are served `public, max-age=31536000,
    immutable`.
  - **The walk.** The same walk as the first measurement: headless Chromium, 375×812, Slovenian, a real emailed
    code. It ran on a normal connection, then on Slow 4G with 4× CPU.
    - Every tab tap stays in the page, with 0 layout shift, settling in 53–335ms.
    - The title is always at 72px, and focus is on it.
    - Full loads of Home, Ask and Wardrobe shift 0 on both connections.
    - Before: Home 0.37, Boards 0.16, Ask 0.10 (all full reloads).
    - Typing a search moves the stylist card down under the results (0.11). That is a direct response to typing;
      left as is.
  - **Thumbnails.**
    - One Cable knit thumbnail failed once after an in-page tap; a probe right after found every `/cdn` image
      answering 200.
    - Thumbnails are `private, no-cache`, so a full load revalidates each one, and Home's table fills in after it
      settles. Serving versioned thumbnails as immutable is the follow-up.
  - **`Referer`.** The app's logs never record it. Whether Cloudflare's invocation logs keep it (it now carries
    `?q=` for requests from Ask) is unverified. If they do, documents should send `strict-origin`.
- **A flaky native test, not ours:** twice tonight the MCP OAuth acceptance answered 500 from
  `/test/identity/disable-mcp` with `D1_ERROR: database is locked: SQLITE_BUSY` in local workerd. Each time it passed
  on a rerun with no change.
- **The app's Message union has its own module** (`apps/web/src/Message.ts`, re-exported from `App.ts`), so the
  navigation can build Messages without importing the app. The capture session confirmed no conflict.

## Overnight run: Gallery 2 and the table — 2026-10-30

The owner chose Gallery 2 ("your clothes are the interface") and moved boards up from Later. This run builds both for
the person's own wardrobe, from the plan approved that evening. It works in its own worktree
(`~/code/styldappv2.wt/redesign`) and lands each green slice on main with `--ff-only`. It owns the night's migrations;
the capture session agreed.

Owner decisions (2026-10-30):

- **Scope:** your own wardrobe only. Feed, Explore, people, Try with mine, fit badges and wishlist stay parked.
- **Canvas:** the table is built in Foldkit itself, with no library and nothing mounted. Its features are text labels,
  your own pictures, a piece menu with animated exits and Undo, and saving a board as a look.
- **Bundle budget:** raised once and recorded here.

Choices made on common sense:

- **Navigation:** Home, Wardrobe, Ask in the middle, Boards; You through the avatar. Looks become a Wardrobe tab.
- **No weather tonight:** the table's headline is the day and date in Anton.
- **Glass** only on the floating nav and the Ask panel, as `DESIGN.md` now says.

- **S0, design source and docs:**
  - `docs/design/gallery-2/` holds the built prototype, its sources and a README saying what v2 takes now.
  - `docs/design/canvas-spike/` holds the table's proof of concept.
  - `DESIGN.md` is rewritten for Gallery 2: Anton in two places, the navigation, glass, the table, springs and page
    transitions.
  - `docs/ROADMAP.md` moves boards up and replaces the canvas-library line.
  - `docs/DELIVERY.md` gains a design row, and studio is now in progress.
- **Contract** (`d96f8b8`): boards, worn days and a website `createLook` (`packages/protocol/src/{Board,Worn}.ts`).
- **Server** (`75ba8ad`…`0f6669e`, built in a parallel worktree and cherry-picked):
  - One migration, `20261030082446_gallery_boards`. It only creates `boards`, `board_images`, `board_items`,
    `worn_pieces` and their indexes; nothing existing is altered.
  - **Board saves** are whole and versioned. A stale or racing save answers `BoardVersionConflict`, checked inside
    the D1 batch itself.
  - **Items:** a foreign piece, another board's picture or a repeated id is refused (`BoardItemRefused`).
  - **Pictures:** a picture claims a received photo upload atomically. It is served owner-only at
    `/cdn/boards/images/:id/:size` through the shared Images transform (`wardrobe/Delivery.ts`).
  - **Worn days** replace a day's pieces, and a range reads at most 62 days.
  - **Looks:** `createLook` is open to the website.
  - **Account deletion** still removes everything: the tables cascade, and the pictures' files sit under the
    account's prefix.
  - `GalleryAcceptance.ts` is the native API evidence.
- **S1, budget** (`c732020`):
  - The first load goes from 256 to 300 KiB gzip and all assets from 512 to 700 KiB.
  - Measured after the night's work: first load 288,379 bytes, all assets 546,804, SSR 1,415,393 source bytes.
- **S1–S5, the website** (`06cc30b`):
  - **Navigation:** a floating glass pill on the phone (Home, Wardrobe, Ask in the middle, Boards, you) and a left
    rail on the desktop. The language picker is in the footer.
  - **Home:**
    - the day in Anton, which is self-hosted and fetched only when drawn;
    - today's outfit as cut-outs on paper, with Spin (plain rules, at most one loud colour, repeatable per day and
      Spin) and Wear this (worn days, kept across reloads);
    - "Pick up where you left off": pieces waiting in the tray, and the last board.
  - **Boards:** the list shows each table as its preview. The editor is Foldkit-native:
    - drag, a two-finger pinch, the corner handle, keys, Escape and undo;
    - text labels in a plain or headline style;
    - pictures by choosing, dropping anywhere on the page, ⌘V or a Paste button, shrunk to 2048 px and re-encoded
      as WebP in the browser, which drops their metadata;
    - flip, duplicate, layer order, and take off with an exit and "Undo";
    - the paper's colour;
    - saving behind the editing, with a newer save elsewhere or a deleted piece reloading the board;
    - save as a look.
  - **Ask:** search your wardrobe by name, category and colour in your language; the stylist's hand-off to the
    assistants; the + sheet into capture and boards.
  - **Wardrobe:** Pieces and Looks tabs.
  - **Copy:** English and Slovenian throughout. **The Slovenian awaits the owner's review**, in the `board`,
    `boards`, `ask` and `today` namespaces, plus `nav.ask`, `nav.boards` and `wardrobe.tabPieces`. Boards are
    "Zbirke", matching v1.
- **Tests:**
  - Story tests cover the gestures as Message sequences, saving, take off and Undo, the outfit rules, the
    headline in both languages, Wear this, board creation and search.
  - **Browser acceptance** (`2beccc8`, `GalleryBrowserAcceptance.ts`): workerd and Chromium with four real
    cut-outs run Home (Spin, Wear this, reload), a board by hand (drag, pinch, keyboard, label, upload, take off
    and Undo, reload with all five things kept, save as a look and open it), Ask, the Wardrobe's tabs, and the
    same pages in Slovenian on a desktop. It finished with no page error and no CSP violation.
  - `heavy --wait bun run check` is green on `2beccc8`: 248 unit tests, 21 native, 0 clones.

**Deviations, with reasons:**

- **Piece actions:** a selection toolbar instead of a Foldkit UI Menu. One tap beats two on a phone, and the
  buttons are as accessible.
- **"Removed. Undo":** a small status region rather than Foldkit UI's Toast; one toast and one timer.
- **Exits:** a CSS exit with a timed removal rather than the Animation Submodel; the item plays out and leaves.
- **The board's tray** sits under the table on a phone, so a tapped piece lands in view. On a desktop it takes
  the side column.
- **Page transitions are off.** Chromium rejected aborted cross-document transitions on pages that navigate by
  script (creating a board, signing in). The page reports this before its module script runs, and the CSP
  allows no inline script, so it can't be caught. The fix is an early script served from `public/`.
- **Text labels** land across the middle and their frame fits the words; other items land in an outfit's
  places, so tapped pieces never pile up.

**Left open:**

- A picture taken off a board stays in R2 until its board is deleted.
- `saveBoardItems` has no operation id: a save whose answer is lost and then retried answers
  `BoardVersionConflict`, and the editor reloads the board.
- Boards have no MCP tools and no sharing.
- No weather on the table.
- Real devices are unchecked: iPhone Safari's pinch and paste were only exercised in Chromium.
- **A label near the 90% wrap cap** can wrap in a smaller preview and not in the editor. Measured on the preview: its
  width was 88.6% of the paper. Font and paper scaled exactly together, but headless Chromium on Linux rounds glyph
  widths, which pushed the smaller copy over the cap. macOS and iOS use fractional widths. Wrapping only at typed line
  breaks would make it exact, but a long label would then run off the paper.

**Preview release and browser walk (2026-10-30, `f794902`):**

- **Deploys:** from the clean main checkout with `docs/DEPLOYMENT.md`'s commands; every plan only updated Workers. In order:
  - `a7a3e5d`: worker `a198adc1-d66d-4c95-ae6d-21870c2ced56`, website `4b8eb191-8b32-4375-b2e3-b7bab7123962`.
  - `cd12040`: worker `9068d019-95d6-4be6-ae38-c3880676ea96`, website `94c4654e-8ddb-4e0c-919b-bc737e22fa7d`, edge
    `fcd71581-1602-4783-9fb7-7250bd99f6bd`.
  - **`f794902`**:
    - worker deployment `7c0c2164-31da-4886-872b-2754a9f588c0` (version `571b66d3-27b8-4738-b777-c2b601b65ccf`);
    - website deployment `651e8ef9-9471-4a3e-bff4-d0762d4886d0` (version `87a9d008-d58b-4dd4-acb0-09b17795aa6f`);
    - the edge was unchanged at `fcd71581-1602-4783-9fb7-7250bd99f6bd` (version `249b3945-1fae-4659-8a07-e3cd995ba1f7`).
- **Readback:** health reports `status: ok` and release `f7949024b76954641c93dea110cf54df95555bb2`.
  `tools/preview.native.test.ts` passes 2/2.
- **Browser walk** on the preview URL: headless Chromium at 390×844 with touch, then 1440×900.
  - Signed in with a real emailed code (myinbox), using the preview's test account, which holds the capture
    session's test pieces.
  - The four acceptance cut-outs were added through the website's own API.
  - Then: Home, Spin (`Denim shorts, Tops, Derby shoes` became `Denim shorts, Cable knit, Derby shoes`), a board by
    hand (three pieces, a headline label, saved, save as a look), Ask with the + sheet, then desktop Home and the
    board.
  - Result: no page error, no CSP violation, no element past the page's edge on Home, the board or Ask, and no nav
    pill over the board's tray.
- **Found by the walk and fixed** (each landed green: 249 unit, 21 native, bundle 289,012 / 307,200):
  - `cd12040`: a wardrobe of only tops laid out one piece, and Spin seemed to do nothing. Home now links to adding
    a top, trousers or a skirt, or shoes, whichever a whole outfit lacks; a dress stands in for a top and a bottom.
  - `fed44c7`: Home offered an empty board to pick up, a large blank card. On a desktop the tray card stretched to
    the board card's height.
  - `9017196`: once a query was typed, Ask ran 6px past a phone's edge, because the page's `auto` column grew to the
    search field's own width. The native acceptance now measures every element's edge on Home, the board and Ask:
    it failed before the fix and passes after. `scrollWidth` can't see this, because the page clips sideways
    overflow.
  - `f794902`: the floating nav sat over the board editor's tray on a phone. The editor now has the whole screen,
    as `DESIGN.md` records.

## Guided camera, front and back — 2026-10-30

The owner's held-up sweater was never noticed, and they asked for a camera that looks good and makes every piece
come with both sides, for a later turning preview on a hanger (meta-hack's interactive garment spike).

- **Noticing a held garment** (`ceb69e6`):
  - A hand-held garment sways and never went perfectly still, so the camera waited forever. A scene now also
    settles after about a second without real movement.
  - A scene that stays put is looked at again twice, about 2.4 s apart.
  - After a "no", the hint says to hold the piece away from the body, spread out and fully in view, or to tap.
  - Clef's "one garment, main subject" bar is 0.6 (was 0.7).
- **Front, then back** (`b25fb13`):
  - Each front taken asks for that garment's back.
  - A turned garment (the check sees a back, or cannot tell) is taken as the back.
  - The front still held up is not taken twice.
  - Another garment's front starts a new piece; that piece goes without a back.
  - A tap takes either side, and "Skip the back" moves on.
  - On the add page a back waits for its front's capture and is sent with `pairsWith`.
- **Pairing on the server** (`c8cd261`):
  - Each shot looks for the other once stored, so whichever the queue finishes second pairs them.
  - Before, a back that finished first stood alone in the tray.
  - With no cut-out (providers off) the back is the photo itself.
  - Removing a front removes its folded back and that back's photo.
- **Full screen** (`8ab11aa`):
  - The camera is a modal dialog over the whole page: the picture edge to edge, corner marks, Front/Back steps, and
    the count.
  - A round shutter whose ring fills in quarters as the picture settles, and is full while the check looks.
  - Each photo flashes and flies into the stack, which is the Done button.
  - Focus starts on the shutter and Escape closes. The page behind is inert and does not scroll.
  - The screen stays on while the camera is open.
  - No new library: Foldkit's dialog helpers, zyzz keyframes, DESIGN.md's curve and timings; reduced motion ends
    the flash and the flight at once.
- **Evidence**:
  - Unit: stillness levels.
  - Story: the back step, the same front, another garment's front, skip, taps, and a back waiting for its front.
  - Native workerd (real D1, both orders): a back paired after its front, and a pair sent together; removing
    deletes both photos.
  - Native Chromium on the stand-in camera:
    - the dialog covers 390×844 with the shutter focused;
    - Enter takes the front and the steps move to Back;
    - a click takes the back;
    - the wake lock is held while the camera is open;
    - Escape leads to a tray of one piece with its back;
    - no CSP problems.
  - Preview release `8ab11aa`: `/api/health` reports it, deployed acceptance 2 tests.
- **Budget**: the initial bundle is 259,575 of 262,144 gzip bytes, so about 2.5 KB is left. The next screen work
  needs a lazy chunk or a budget decision.
- **Open**:
  - Not yet tried on a real phone (owner): whether swaying garments settle, the "back" answers from Clef on real
    turned garments, and the flight's landing point at other screen sizes.
  - The tray and the wardrobe do not show the back yet. The turning preview from the two real photos is the next
    step, to be proposed first.
  - Each side costs a credit, so a piece with its back costs 2.
  - On desktop Chromium the scrollbar gutter is turned off while the camera is open.

## Cut-out spikes — 2026-10-30

Owner-approved spikes, built in this repository so the winners are already in place.

- **Refined edges** (`53e7768`, live): `packages/server/src/capture/Matte.ts`.
  - **How it works.**
    - A SAM mask is spread smoothly onto the still or photo.
    - A guided filter snaps its edge to the photo's own edges, within 3 px of SAM's edge.
    - Specks are dropped and pinholes filled; hand-sized holes are kept.
    - The soft edge takes the garment's colour, not the background's.
    - Rows are processed in strips, to keep memory low.
  - **Evidence.**
    - Against the drawn tee's true outline, edge error falls from 0.078–0.120 (stepped) to 0.008–0.018.
    - `tools/cutout-lab.ts` cuts saved real masks both ways. On 52 garments: 46 ms median, 0.5 s at most.
    - At 3× zoom the staircase edges and white notches are gone.
  - `CUTOUT_EDGES=stepped` keeps the old way for comparison.
- **1024 px analysis clips** (`8bc632d`, live):
  - Clips match SAM's mask cap, at the same price per frame, at 1.5 Mbit/s (about 6 MB per part).
  - Preview: one minute of the try-on video went up as two 576×1024 parts, processed in 32 s and 47 s. In the
    owner's tray, the trench coat's contour follows the fabric where the 720 px version was notched.
  - The first attempt from the dev box stalled before sending anything. A second run worked; the cause is unknown.
- **Product photos** (`tools/product-photo-lab.ts`, not in the app):
  - FLUX.2 [klein] 4B redrew six real cut-outs in 3–6 s at about $0.0012 each, but changed the garments:
    - a print was lost;
    - a pattern and a badge were invented;
    - jeans came back as different trousers.
  - Only a trench coat came back close. The model takes references only under 512 px.
  - FLUX 3 Image Klein (about $0.009) refused inline references and needs an https link.
  - Not tried yet: GPT Image 2.5 (can return a transparent background) and Nano Banana 2.1.
  - A product photo would only ever sit beside the real cut-out.
- Results are shown privately on the tailnet (`http://netcup.tail5acf67.ts.net:4334/cutout-lab.html`, served from
  the research folder; not in Git).

## Cut-out quality — 2026-10-30

The owner's first real captures came out poorly: held-up camera shots kept the person, and a 6:51 rail video gave
mostly scraps. Diagnosis (preview D1 and R2, read-only), fixes so far, and the research that follows.

- **Diagnosis.**
  - Held-up shots: Clef rightly called each one garment (0.83–0.94), which routed it to Cloudflare background removal.
    That keeps the whole foreground, so the person came out with the garment. The research behind that route
    (`~/code/meta-hackathon`, 2026-10-27) tested it only on crops of single laid-out garments.
  - The video: 14 parts gave 165 detections, and 151 were kept because every one with a category is preselected.
    Contact sheets of three parts (39 cut-outs) show about 5 recognisable garments and none whole: pieces cut off by
    the frame, slivers of garments hanging edge-on, scraps. Nothing rejects a SAM track. SAM itself was tested only on
    synthetic clips before this; the handoff asked for review first and capture guidance, which v2 does not have yet.
  - Scaling a SAM mask onto a larger still mapped the first column to source column -1, which drew a one-pixel line
    beside many video cut-outs.
- **Fixed** (commit `3a757e1`, release `3a757e1` on the preview):
  - Camera shots always go to SAM; the piece nearest the middle stays preselected (`cutterFor`, unit-tested).
  - Each scaled mask pixel takes the source pixel under its centre and stays outside the mask's box when its centre
    does; the new test fails on the old code.
  - Preview: the owner's black-tee shot sent again as a camera capture now gives the tee alone (preselected, "top,
    short sleeve") and the worn trousers as a separate unticked piece, in 10.7 s; the test detections were discarded.
  - Full gate: 219 unit tests, 18 native tests. Deployed acceptance passed (2 tests, 35 assertions).
- **Research** (owner-approved, $10 cap, about $0.62 spent; private report and scripts in
  `~/code/meta-hackathon/out/styld-cutout-research/REPORT.md`):
  - Meta answers this key only over IPv6 from the dev box (IPv4 lists no models).
  - SAM caps a mask raster at 1024 px, and Styld dropped every larger mask: the main garment of a large photo vanished
    without an error. Fixed (`927c7b7`): the raster is scaled to its box; the test fails on the old code. On the
    owner's held-up shots, 5 of the 6 garments now come out whole (Clef 0.85–0.95), up from 3.
  - Specific nouns ("jacket", "coat", "dress") made SAM 3.1 return nothing where "clothing" found the garment.
  - Clef's "is this one whole garment?" separates usable cut-outs: of 119 at 960 px, the 16 usable ones scored
    0.497–0.95 and 93 of the 103 others under 0.2. A rail filmed close up has nothing whole in it (75 cut-outs, the
    best 0.37): that needs filming guidance, not another model.
- **Whole-garment gate** (`3107e42`, `2f0467a`): the Clef call each cut-out already gets also asks whether it shows one
  whole garment. At 0.5 or above the piece is offered ticked, from 0.2 unticked, below that it is dropped before it is
  stored. A video part that keeps nothing says how to film; the add page gives the same advice. Full gate: 222 unit
  tests, 18 native tests.
- **Preview** (release `2f0467a`, `/api/health` reports it, deployed acceptance 2 tests and 35 assertions):
  - the synthetic 10-garment rail: 10 offered, 10 preselected;
  - one minute of the close-up rail: part 1 kept nothing and showed the filming notice, part 2 offered one piece
    unticked (before the gate, parts like these gave about a dozen preselected scraps each);
  - the owner's open-jacket shot as a camera capture: the whole jacket, preselected;
  - all test captures were discarded or removed afterwards.
- **Owner's account reset** (2026-10-30, at the owner's request): the old preview account was closed with the app's own
  steps and its deletion job queued; no rows or stored files remain. The owner now uses
  `styld-wardrobe.kris@myinbox.lol` (myinbox, so codes can be read for them).
- **Try-on video on the preview** (first 3 minutes of the 14-minute video, uploaded through the add page): 6 parts sent
  in 81 s and processed within about 2 minutes, 35 credits. Ticked: jeans, a trench coat, a sweater, a long coat, a
  puffer and a jacket, plus the same jacket again from the next part; 12 partial pieces offered unticked. No person
  or rack in any ticked cut-out; gaps remain where hands or hair covered a garment.
- **Open.**
  - A library photo that shows a person still goes to background removal when Clef calls it one garment, and Clef
    rates "person plus garment" as whole (seen on the preview). Next: ask the route call whether a person is in it.
  - The same garment seen in several video parts or try-on segments is not merged.
  - Analysis clips are 720 px; the research ran at 960 (SAM's cap is 1024, the price is per frame).
  - A guided capture mode (one garment at a time, whole in frame), as the research handoff recommends.

## Long videos and a simpler add page — 2026-10-30

Plan: `/home/kristjan/.claude/plans/ticklish-popping-rivest.md` (owner-approved: videos up to 15 minutes, about 10
credits per started minute). Commits `5178732` and `0ba572d`.

- **Why.** A 3-minute and a 13-minute phone video were refused by the one-minute limit. Sending originals that long
  would cost about $4.70 of Meta frames for 13 minutes, and would run past SAM's 16-object cap and the 95 MB upload
  limit.
- **Cut on the device** (`apps/web/src/capture/VideoParts.ts`, Mediabunny 1.61.6, MPL-2.0, loaded only when a video
  is chosen):
  - A video of up to 15 minutes is read in the browser and cut into 30-second parts. A tail under 12.5 s joins the
    last part.
  - Each part is an upright H.264 clip at 720 px and a steady 4 frames a second, without sound. A 1280 px still is
    kept each second, with its tile sharpness.
  - One part is held in memory at a time. The original never leaves the device.
  - Where WebCodecs cannot decode the video, a clip of a minute or less still goes whole through the old sampler.
    A longer one is refused as unreadable.
- **Add page** (`apps/web/src/page/AddPieces/`, now Foldkit's message/model/update/view split):
  - Each part goes as an ordinary video capture. One video is read at a time, and photos keep going meanwhile.
  - The page shows "Reading the video, part N of M". Trying again resumes at the failed part and resends a request
    whose answer was lost.
  - When the day's allowance runs out partway, the page says "Today's free allowance covered N of M parts. Send the
    rest tomorrow."
  - The screen stays on while a video is read: a Subscription holds a wake lock and gives it back once the video stops.
  - The "use your camera app" picker is gone. Two tiles remain: photos or a video, and hold pieces up.
- **Pricing.** 5 credits per started half-minute of each part, measured on the server; it was a flat 10 per video.
  A 15-minute video is 150 credits, more than a day's 100.
- **Evidence.**
  - Unit: part planning, frame times and sizes.
  - Story: part by part, including a lost answer and the resume; the daily limit partway, with a late answer; one
    video at a time; the whole fallback; a video that is too long; when the wake lock is asked for.
  - Scene: the part progress and partial-allowance copy through the real view.
  - Native Chromium: a 140 s, 12 fps video with sound, recorded turned a quarter, goes through the picker with 7
    credits left. Part 1 is accepted and part 2 is refused for credits. Both stored clips have 120 frames, 30 000 ms,
    no sound track and portrait size. The page ends with "covered 1 of 5 parts". One wake lock was requested and one
    released.
  - Preview, release `0ba572d`, real providers, myinbox session:
    - A 3-minute rail loop (640×352, 24 fps) went up as 6 parts in 42 s.
    - All 6 were tracked by SAM within 138 s, each with 10 cut-outs.
    - The allowance went from 100 to 65: the last part measured 30.25 s, so it cost 10.
    - Meta: 6 track calls of 120–121 frames, $0.144 together (the original would have been about 4,300 frames,
      about $0.86).
    - No page errors. The run's 60 duplicate cut-outs were discarded afterwards.
  - Full gate on `0ba572d`: 242 type/Effect files with zero findings, 216 unit tests, 18 native tests.
  - Bundle: initial 255,655 gzip bytes of 262,144; all assets 512,125 of 524,288. Mediabunny's own chunk is 83 KB
    gzip.
  - Deploy: 3 Worker updates, 2 binding changes, nothing created or deleted. `/api/health` reports `0ba572d`, and
    deployed acceptance passed (2 tests, 35 assertions).
- **Open.**
  - For the owner on an iPhone:
    - the 13-minute video, with the time per part;
    - whether the picker hands over the HEVC original or a transcode;
    - whether portrait and front-camera clips come out upright;
    - HDR colours;
    - locking the phone mid-part, then trying again;
    - heat, and whether Safari keeps the tab alive across 26 parts.
  - A phone cuts more slowly than headless Chromium on this box. Not measured yet.
  - A garment seen in two parts shows twice in the tray. Merging them is not done.
  - The bundle budgets have about 6.5 KB (first load) and 12 KB (all assets) left. The next page needs splitting
    or a budget decision.

## Capture and assistant run — 2026-10-29

Plan: `/home/kristjan/.claude/plans/ticklish-popping-rivest.md` (owner-approved): iterations 1 and 2 plus video import,
deployed to the preview. One entry per slice.

- **S1 assistant view (MCP Apps).**
  - **The view:** a small client-only Foldkit program (`apps/web/src/assistant/`: `Views.ts`, `Bridge.ts`, `entry.ts`)
    draws tool results inside ChatGPT and Claude.
    - The bridge speaks the MCP Apps `ui/*` JSON-RPC over `postMessage`: the handshake, the tool result in, link
      requests out.
    - The view holds no copy of its own. The server sends its words from the catalogs in both languages, and the view
      picks the host's.
  - **The build:**
    - `tools/assistant-views.ts` builds the view with its own Vite config (one IIFE, inlined into one HTML file).
    - The server bundles the result as `packages/server/src/mcp/apps/AssistantViews.generated.ts`.
    - `assistant-views:check` rebuilds and compares it as part of `check`, with a 384 KiB budget. It is 318 KB
      today, mostly Effect and the Foldkit runtime (about 100 KB gzipped). The planned 150 KB was not reachable.
    - The graph gate treats it as a second browser root.
  - **The server side:**
    - MCP now serves resources: `ui://styld/views-v1.html` (`text/html;profile=mcp-app`, no network access).
    - Tools carry `_meta`, and results can carry data only the view reads.
    - The first view tool is `wardrobe_show`.
  - **Evidence:**
    - Unit: the tool list, the view result in both languages, the self-contained resource, the view's Story tests.
    - Native: SDK 2.x and 1.x clients read the resource through the OAuth journey.
- **S3 daily allowance (Domain).**
  - **The model:** the Wallet gains a free daily pool. `ReserveCredits` now carries the UTC `day` and that day's
    `dailyAllowance`, both from the server, so `decide` stays pure.
  - **How it spends:** the pool is spent before subscription and purchased credits, and resets rather than
    accumulates on a new day.
  - **Refunds** return to the pool only on the day it was spent.
  - **Retries:** neither field is part of the reservation's command id, so a retry across midnight is the same
    reservation.
  - **Events:** `CreditsReserved` and `CreditsSettled` record `day`, `fromDaily` and `dailyAfter`. No deployed Wallet
    events exist yet (the server had never called it), so the new fields are required.
  - **Evidence:** stories (daily first, reset each day, same-day refund, a free account's limit, a retry after
    midnight) and the native Durable Object fixtures.
- **S2 + S4 capture backbone (server).**
  - **Providers** (`packages/server/src/capture/`): three ports, each with an adapter.
    - `GarmentVision`: Clef-flash through the Workers AI binding, for routing, suggestions and the camera check.
    - `PictureWork`: the Images binding, for working copies, background removal and thumbnails.
    - `GarmentSegmenter`: Meta SAM 3.1 through `api.meta.ai`. Stills are sent inline. Videos are streamed to the
      Files API with a `FixedLengthStream`, and SAM's answer keeps only the lines of the wanted frames.
  - **Failures:**
    - A refusal is `ProviderFailed{retryable}`. Meta's intermittent `model_not_found` 404 counts as retryable and is
      retried briefly in place.
    - A broken stream after Meta accepted the work is `ProviderOutcomeUnknown`. The capture then waits as `unknown`
      with its credits held, and is never retried on its own.
  - **Metering:** every provider call writes one Analytics Engine row with provider, model, kind, outcome,
    milliseconds, units and estimated cost. Rows carry no account, prompt or image.
  - **Captures** (D1 `captures`, `capture_frames`, `detections`; migration `safe_lyja`): a photo or video becomes
    detections that wait in the tray.
    - **Order of writes:** credits are held through `Usage` → Wallet first, then one D1 batch with the receipt, then
      the queue. A failed batch refunds the hold.
    - **Processing:**
      - A photo goes to Clef, then to background removal (one garment, sure) or SAM.
      - A video goes to SAM tracking, and the best still per track is cut from the browser's sampled stills.
      - A refusal fails the capture and refunds it; the last failed attempt does too. A back shot becomes its
        front's back.
    - **Review:** kept detections become ready pieces in one batch, once per operation id.
    - **Removal:** removing a capture deletes its folder, photo, video and stills, except photos a kept piece shows.
  - **Assistant adds:** `piece_add` now runs the same cut-out (the largest garment) for one photo credit. Past the
    limit, or when nothing can be cut out, the piece keeps its original.
  - **Uploads:** `pieces.upload_id` is nullable, and pieces gain `detection_id` and `back_image_key`. Videos (mp4/mov,
    at most 95 MB) stream into R2 at their declared length and are checked by signature after they land. Pieces
    can be jumpsuits (en/sl labels).
  - **Policy** from the Worker's env:
    - `STYLD_PROVIDERS` (`live`/`off`);
    - `CUTOUT_SINGLE` (`cloudflare`/`sam`): the experiment switch;
    - the confidence thresholds;
    - `DAILY_ALLOWANCE` (100). A photo costs 1 credit, a video 10.
  - **Evidence:**
    - **Unit:** recorded real SAM and Clef answers through the parsers and adapters (every chunking, frame filter,
      refusal vs retry, unknown after a broken stream), the cut-out of a drawn tee against its truth mask
      (IoU > 0.98), MP4 frame counts, and still ranking.
    - **Native** (workerd, providers off): photo → tray → review → ready piece, once per operation id; isolation
      from a second account; a video with its still; the daily limit refusing with 429; removal deleting photos,
      the video and its still while a kept piece's photo stays.
    - **Live** (`tools/provider-live.ts`, earlier today, from this box): SAM split the rail clip into 10 tracks.
  - **Not yet proven:**
    - the `unknown` and refusal paths end to end (unit-level only);
    - an iPhone `.mov`.
- **S5 real providers on the preview** (release `c527c1e`).
  - **Deploy:** adds the Workers AI binding and the `StyldV2AiCalls` Analytics Engine dataset, migrates D1, and
    reads Meta's key from the operator's `META_MUSE_API_KEY`. The plan touched v2 resources only.
  - **Acceptance** (`tools/preview-capture.ts`, signed in with a myinbox code):
    - **One garment** (the drawn red tee): Clef routes it to background removal. The cut-out is a PNG with 44% of
      its pixels transparent, and Clef suggests a red short-sleeve top. Kept as a ready piece with a thumbnail, in
      13 s.
    - **The rail frame:** SAM finds 10 garments with 10 cut-outs and suggested categories, in 19 s.
  - **Found by the preview:** deployed D1 refuses a statement with more than 100 bound parameters, and the rail's
    10-detection insert had 150; local workerd accepts it. Rows now go one statement each and id lists in chunks
    of 90. The failed rail capture was refunded, as designed: the allowance read 97 after three paid captures and
    one refund.
  - **Metering:** `tools/ai-usage-report.ts` reads Analytics Engine back. It showed Images normalise, SAM segment,
    Clef suggest, Images foreground and a review decision, about $0.036 in list prices for the run. Rows arrive
    with a delay of minutes.
- **S6 add pieces and the review tray (web).**
  - **`/wardrobe/add`:**
    - Two ways in: the library (photos and videos, several at once) and the phone's camera, through the file
      input's `capture` hint.
    - Each file goes up as it is chosen, two at a time, under its own operation id. A photo that fails on the
      network keeps its id and upload, so trying again makes one capture.
    - A video is sampled in the browser by `capture/Sampler.ts`, loaded on demand: a still every 0.5 s (every 1 s
      past 30 s), at most 1280 px, with 8×8 tile sharpness. The clip and its stills go up, then one video capture
      is made.
    - When everything is sent, the review tray opens.
  - **`/wardrobe/review`** (Gallery add.html):
    - Found pieces in a grid with a 44 px tick. Ticked when suggested, and faded when not.
    - "Edit" opens the piece with the category, shelf, colour and name pickers and "Use the original photo".
    - Ticking a piece without a category opens it.
    - While captures are cut out, the tray asks again every 2 s.
    - Failed, half-finished and empty captures offer Try again and Remove.
    - The footer, above the tab bar, says "Add N to my wardrobe". It keeps the ticked pieces and drops the rest
      in one idempotent review, then opens the wardrobe.
    - Today's allowance shows under the title.
  - **Removed:** the hand-add page it replaces (one photo plus a required category). Copy is in en/sl
    (`capture.*`; the Slovenian awaits the owner).
  - **Evidence:**
    - Story tests for both programs and the sampler's pure parts.
    - Native Chromium: three photos through the picker, two kept with a category, the third dropped. The wardrobe
      shows the two, the tray is empty, and the page has no errors or CSP violations.
  - **Not yet proven:** the phone camera.
- **S7 video import on the preview** (release `637af98`).
  - **The first real browser run failed every video as unreadable:** the document policy blocked `blob:` media,
    so the page could not play the chosen file to sample it. `media-src 'self' blob:` fixes it. The diagnostics
    prompt now rises above a page's sticky action.
  - **Acceptance** (Playwright Chromium against the preview, the 10-garment rail clip, 10 s, H.264, 640 px):
    - Choosing the file sent the clip and its 20 stills in 14 s.
    - SAM tracked it, and the tray showed 10 cut-outs with suggested categories (bottoms, dress, outerwear,
      tops), all ticked, within about 40 s of opening the tray.
    - The allowance went from 97 to 87: a video costs 10.
  - **Not yet proven:** an iPhone `.mov` (HEVC, rotation) and a full minute of video.
  - **Flake seen:** native D1 answered `SQLITE_BUSY` to the wardrobe seed once while another process held port 1337. It passed on the rerun.
- **S8 held-up camera (web).**
  - **"Hold pieces up"** on the add page opens the camera on the page, selfie side first, with a switch to the back
    camera. The preview is mirrored; the photos are not.
  - **`capture/Camera.ts`** is loaded only when the camera opens. A Foldkit Mount runs `getUserMedia`, reads a
    64 px grey copy five times a second, and reports two things:
    - the scene settling after it moved (`capture/Stillness.ts`: the room must change, then hold still for about
      0.6 s, so an empty room or the same garment never shoots twice);
    - a tap or Enter on the picture.
  - **Each shot** is a 2048 px photo plus a 512 px copy for the check.
  - **`HeldCamera`** is its own submodel. A settled picture goes to `POST /api/captures/check` (Clef: one garment
    held up? which side? the same as the last shot?).
    - A garment held up is taken: a buzz, a counter, and the photo joins the send queue as a camera capture with
      its side.
    - Anything else asks the person to hold one piece up.
    - A failed check falls back to tapping.
    - The tray waits until the person presses Done.
  - **The camera app** stays available as a smaller link (the file input's `capture` hint).
  - **Evidence:** unit tests of the stillness rules, and Story tests of check → take, nothing held up, a failed
    check then a tap, a refused camera, and camera shots joining the queue while the tray waits.
  - **Preview** (release `89dcc60`): Chromium's fake camera played a backdrop, then the drawn red tee sliding in
    and holding still.
    - The page started the camera and saw the scene settle. Clef confirmed one garment on the first check, and the
      photo was taken (counter "1 taken") and uploaded as a camera capture. No page errors.
    - **Calibration:** asked whether a garment is "held up", Clef rated the lone tee 0.45, under the 0.7 threshold,
      so nothing was ever taken. Asked whether exactly one garment is the picture's main subject, it rated the tee
      0.92 and the 10-garment rail 0.02. The page's stillness already shows someone holding it.
  - **Not yet proven:**
    - a real phone, with a person holding real clothes;
    - whether clothes the person wears pass the check (the review tray catches them);
    - pairing a back with its front in the tray: the server supports `pairsWith`, and the page sends only the
      side.
- **S9 looks.**
  - **D1:** `looks` (name, optional occasion) and `look_pieces` (order). Both cascade, so deleting a piece takes it
    out of its looks and deleting an account takes its looks (migration `narrow_punisher`).
  - **One `Looks` service** (`packages/server/src/looks/`) acts for `CurrentAccount`. Creating a look checks that
    every piece is the account's own. One operation id makes one look; reusing it for another look is a
    conflict. Receipts share one query (`Receipts.ts`) with the wardrobe's.
  - **`CurrentAccount` is marked `@effect-leakable-service`:** it is per-request context, like a request, so
    services name it in their methods on purpose.
  - **Assistants** get `look_create`, `look_list`, `look_get` and `look_delete`. Results link each look and its
    pieces on the website, and refusals say what to do.
  - **The website** reads looks through `LookApi` (list, get, delete; only assistants make looks):
    - `/looks`: cards with a collage of up to four pieces, the name and the occasion or piece count, and an empty
      state that points to the assistant;
    - `/looks/:id`: its pieces, and delete with an in-page confirmation;
    - a Looks tab (coat-hanger icon) between Wardrobe and You.
  - **Evidence:**
    - Native MCP through the real OAuth journey: create a look from a piece; the same operation id returns it, a
      changed request and another account's piece are refused, and it appears in the list. Deleting the piece
      empties the look, and deleting the look removes it.
    - Story tests of both pages; the routes open with their reads.
- **S10 pictures in the assistant view.**
  - `wardrobe_show` now sends thumbnails of the first 24 pieces with its result. They are WebP data URLs under
    `_meta["styld/images"]`, read six at a time through the same owner-checked `pieceImage`. They stay out of
    the model's context, and the host's sandbox can show them without reaching Styld's private image routes.
  - A piece whose picture cannot be read is shown without one.
  - `Streams.ts` moved to the server package root, since wardrobe, capture and MCP share it. `pieceImage` types
    its body as the structural `ByteStream`, so callers read it without a cast between the Worker and DOM
    stream types.
  - **Evidence:** a unit test that the view result carries the readable thumbnail and skips the unreadable ones.
  - **Not yet proven:** the view inside ChatGPT and Claude with real pictures (owner).

- **Metering fix** (release `6e25e28`).
  - Analytics Engine samples per index. With every provider call under one index (`call`), the preview stored 40
    points standing for 103 normalisations, and no route or video-track call appeared at all.
  - Calls are now indexed `call.<provider>.<kind>` and reviews `review.<decision>`, and the report reads both
    forms.
  - **Readback:** after the deploy, a capture pass wrote `call.clef.route` (2 points for 2 photos) beside its
    other calls.

- **Review round (server).** Three independent reviews: Effect and architecture, the Foldkit web code, and
  security and durable behaviour. They found no cross-account access. Fixed on the server:
  - **Cost bounds:**
    - The server reads a video's real length and frame count from its container when the capture is made, and
      refuses anything over a minute or 3,660 frames (`tooLong`). It no longer trusts the browser's word.
    - Stills must be images.
    - A photo yields at most 20 pieces.
    - The camera's garment check is rate-limited per account (40 a minute; `CAPTURE_CHECK_RATE_LIMIT`) and
      answers "not held" without calling Clef for anything but a JPEG.
  - **Credits:**
    - A refunded capture holds its credits again, under a new Wallet operation (`hold`), before a retry runs.
      Retries are capped at three (`attempt`).
    - The status changes first and the settlement follows. A capture that is no longer processing but still
      holds credits has them settled on its next delivery: kept results consume, a failure refunds.
    - Removing a failed capture refunds it; removing an unknown one consumes, since it may have been billed.
    - `piece_add`'s credit stays held across queue attempts and comes back only when the queue gives up
      (`GarmentCutout.release`).
  - **Durable processing:**
    - The queue retries defects as well as typed failures, and logs each failure's cause.
    - A replayed create re-sends the queue message for a capture still processing.
    - Retry and remove move a capture only from the state it was read in.
    - A capture stuck processing for 30 minutes can be retried or removed.
    - A video is handed to Meta at most once per try (`tracking_started_at`, claimed atomically). A delivery that
      finds it handed over without a result ends `unknown` instead of paying again.
    - A finished capture's status is never overwritten by a late delivery.
    - Processing skips accounts closed for deletion.
  - **Providers:**
    - Every Meta, Clef and Images call has a timeout; Meta's also carry the cancellation signal.
    - SAM output that does not parse is a typed failure: refused for a still, unknown for a video.
    - A PNG that does not decode is a refusal.
    - The video upload aborts on a read error, and a missing video is not retried.
    - Working copies run concurrently; a video's stills are prepared once each; suggestions run four at a time.
  - **Privacy:**
    - Videos reach Meta with their `udta`/`meta` boxes blanked (type `free`, zeros), without moving a byte
      elsewhere in the file; phones keep location there.
    - Each video is deleted at Meta once tracked.
    - Removal never deletes a picture a piece shows (cut-out, back or original), refuses captures with kept
      pieces, lists R2 page by page, and logs what it could not delete.
  - **Smaller:**
    - Review decisions record the route and provider that made each piece.
    - Metric writes cannot fail the work they measure.
    - The Wallet fingerprint goes through Effect's `Crypto` service.
    - `wardrobe_show` sends only small WebP thumbnails.
    - The back-shot pairing counts only when a front was updated.
    - x18n ignores `Styld.*` log event names.
    - The native disable fixture retries on a busy local D1.
  - **Evidence:**
    - unit tests of video measurement and metadata blanking on the rail clip (every other byte unchanged);
    - native: a reviewed capture can no longer be removed and its photo stays;
    - the full gate.
  - **Still open from the reviews:**
    - a dead-letter queue (stuck captures recover through the 30-minute rule instead);
    - an upload rate limit, a storage quota, and sweeping uploads that were never used;
    - deleting a finished capture's video and unused stills;
    - charging videos by frame;
    - the Wallet's limit of 256 pending holds under a flood of stuck captures;
    - a final sweep after account deletion for jobs still running;
    - hand review of any future `pieces` table rebuild, since `look_pieces` now cascades from it.

- **Review round (web).** Fixed from the Foldkit review:
  - **Camera:**
    - Each garment check carries a number, and only the answer to the pending one counts. A late answer can no
      longer reopen a camera the person closed, or take the same garment twice after a tap.
    - The status line and count sit outside the shutter button, so screen readers announce them.
    - Space no longer scrolls the page.
    - Code that fails to load reports the camera as unavailable instead of hanging on "Starting".
  - **Add page:**
    - "See what's in N files" appears only once nothing is waiting or sending, so leaving can't cut an upload
      short. The OutMessage is renamed `FinishedSending`.
    - A video's capture request that got no answer is kept and resent with the same operation id and uploads,
      so a retry can't make a duplicate.
    - A chunk that fails to load is a retryable network problem, not an app crash.
    - After the day's limit, the files still waiting are not sent.
    - An unreadable video offers no pointless retry. Conflicts and refusals are not offered retries either.
    - One live summary reads out the queue, and retry buttons name their file.
  - **Review tray:**
    - Polling is one refresh at a time and keeps going after a failed refresh, with an out-of-date note.
    - Retrying or removing a capture reports success or failure per capture.
    - The open editor has a heading.
    - `DrewOperationId` is renamed `CompletedDrawOperationId`.
  - **Looks:** collage images have empty alt text, so a card's name is its look's name; a look that can't load
    offers a retry and has a heading.
  - **Sampler:** listens for `seeked` before it seeks.
  - **Shared pieces:** the review's retry and remove Commands share one helper, the looks pages share one "could
    not load" section, and the native fixture shares one busy-database retry.
  - **Evidence:** Story tests of late answers after Done and after a tap, a settle during a check, single-flight
    polling and recovery, and failed and successful capture actions; the full gate.
  - **Still open from the review:**
    - focus moving to the opened camera or editor;
    - skeletons for the review and look loading states;
    - Scene tests of the add, review and looks pages;
    - Command execution tests with a stub client;
    - a `Photo | Video` union for queue items;
    - the `StyldClient` lazy import caching a failure;
    - Message names in the shared piece pickers (`ChoseCategory`).

- **Final readback** (release `a158d38`, `/api/health` reports it):
  - real providers, with the myinbox session: one garment → a transparent cut-out kept as a piece; the rail
    photo → 10 cut-outs; the rail video sent in 11 s → 10 cut-outs;
  - the fake-camera held-up shot → checked once, taken and uploaded, with the queue summary announced;
  - no page errors in any run.
  - The preview account's tray now holds the test captures (about 60 pieces), which the owner can review or
    remove.

- **Deferred from this run** (the plan's drop order, so the time went to review and a clean base):
  - the look card view in ChatGPT and Claude;
  - pairing a back shot with its front in the tray;
  - the ChatGPT sidebar entry and @-mentions;
  - a rate limit on the camera's garment check.

## Scope and roadmap — 2026-10-29

The owner decided the next iterations after the v1 feature inventory (`docs/migration/v1-features.md`), v1's production usage (`docs/migration/v1-usage-2026-10-29.md`: 20 real accounts, about 8 outside, no paying customer, 78% of AI spend on redrawn product shots) and the Meta/segmentation research handoff (spike commit `1461a78`).

- **Iteration 1:** photos to real cut-outs.
  - Capture: the picker, plus a camera that shoots when the frame goes still.
  - Processing: Clef-flash routes each photo (Cloudflare background removal for one garment, Meta SAM for several) and suggests the category.
  - Review: a "To review" tray.
  - Limits and tracking: free with a daily cap, metered in the usage ledger, provider calls in Analytics Engine, a minimal admin page.
- **Iteration 2:** MCP Apps wardrobe view and look cards, the ChatGPT sidebar entry and @-mentions, and looks made by the assistant. Then go-live on styld.app with real v1 wardrobes imported.
- **Iteration 3:** try-on, together with billing.
- **Parked:** catalog, feed and follow, share links, referrals, wheel, calendar, onboarding funnels, favourites and archive.
- **Provider probe (throwaway Worker in the v2 account, deleted after; synthetic images only):**
  - Meta answers a Worker directly, with `sam-3.1` listed and no relay needed.
  - Cloudflare background removal works through the Images binding: IoU 0.86–0.9995 on the drawn garments, with enclosed holes kept as background.
  - SAM found all 10 garments on a rail frame in one "clothing" call, at IoU 0.99 on the single garments.
  - Clef-flash routed 7 of 7 images correctly, named 5 of 5 categories and gave plausible categories for 10 of 10 crops, at about $0.00005 a call.
  - Details: ROADMAP › Provider probe. Still open: the camera on iPhone Safari.

## Overnight run: sign-in, wardrobe, MCP — 2026-10-29

Plan: `/home/kristjan/.claude/plans/ticklish-popping-rivest.md` (owner-approved). One section per slice below.

- **S0 preflight.** The `RAILWAY_API_TOKEN` in the environment is refused by Railway (account, project and team token forms), so v1's Google client and email token could not be pulled; Google waits for the owner. Email needs no token: `styld.app` is in the same Cloudflare account as v2 and is already set up for sending, so v2 will use the `send_email` Worker binding (Alchemy `Email.SendEmail`, no DNS change; local workerd writes each message's text part under `.alchemy/local/email/text/`, which the native tests read). The deploy token can manage Queues; the Images API answered 403 (the Worker binding is tried at deploy). Non-browser clients (curl, Bun, a Python and an MCP user agent) reach the preview without Cloudflare's Error 1010, so MCP hosts can connect.
- **S1 spine.** New browser-safe `@styld/protocol` declares the typed API (`StyldApi`, effect HttpApi) once for the API Worker and the website; it may import only `@styld/auth`'s contract. `SessionHttp` (Yielded's `makeSessionHttpContract` on the `__Host-effect-auth-session` cookie) is the session requirement for endpoints; the API Worker implements it with Yielded's own session check and request middleware, so the typed API and the auth routes share one session rule. First endpoint: `GET /api/me`. The edge routes `/oauth` to the API Worker. Native test: `/api/me` refuses a signed-out request, returns the account after sign-in, and refuses after sign-out and after the account is disabled. Graph rules and tests cover the new package.

- **S2 OAuth issuer and MCP transport.** Styld is its own OAuth issuer for MCP, following the owner's myapps and goblin pattern on Yielded Auth: `OAuthServer.make('mcp')` (authorization code with PKCE S256, rotating refresh tokens, replay revokes the grant, RFC 9728 metadata) with one scope, `styld`. Grants, assertions and dynamically registered clients live in D1 (new migration). Dynamic client registration (RFC 7591) at `/oauth/mcp/register` admits public clients only, with exact https or loopback redirect URIs, narrows grant types instead of refusing them, and is rate-limited per IP; client metadata documents are accepted only from the exact hosted-client list in myapps (Claude, ChatGPT, Codex, VS Code). Authorization reads the website's own session cookie; without one it sends the visitor to `/login/connect` (page in S3). The edge now keeps the policy the API sets for a document it renders, so the consent page may post to the client's redirect. `/mcp` ports myapps' stateless transport: `@modelcontextprotocol/server` 2.4.0 loaded on first use, the 2026-07-28 era plus older eras on a per-request JSON transport, `GET` answered 405, a fresh server per request. Tools are noun_verb projections with closed inputs (an empty `Schema.Struct` would otherwise accept anything), refusals that name bad arguments without their values, and `{code, message, recovery, retryable}` errors; every call checks that the account is still enabled. First tool: `account_get`.
  - Evidence: unit tests (tool list and budgets, closed inputs, refusals, redirect policy, challenge, edge policy) and a native acceptance through the public edge: discovery, the 401 challenge, registration (custom scheme refused, grant types narrowed), the login redirect, sign-in, consent, the PKCE code exchange, the official SDK 2.x (2026-07-28) and 1.x (2025-11-25) clients listing and calling `account_get`, refresh rotation with replay ending the grant, revocation, and an account disabled mid-session losing access.
  - Deviations from myapps: opaque access tokens for up to 600 s checked against D1 (so revocation is immediate) instead of 900 s JWTs; no 30 s refresh grace; one scope instead of read/write. Yielded's default consent page is plain English HTML until S5 replaces it with Gallery copy from the catalogs; MCP and OAuth protocol text is excluded from x18n because it is written for assistants and OAuth clients.

- **S3 sign-in.** One six-digit email code both signs in and creates an account, with no password. Yielded's email registration never issues a session, so `packages/auth/src/EmailEntry.ts` is a custom strategy: it binds Yielded's code sign-in and email registration modules under one namespace, decides between them by looking up the address, and for a new address commits the registration and then issues the session from the same code, the way Yielded's own sign-in does after a proof. Both paths answer alike, so the response never says whether an account exists; a disabled account gets a receipt and no mail. Rules: 6 digits, 5 minutes, 3 tries (counted in D1), a new code at most every 30 s, a per-network request limit (in isolate memory, keyed by `cf-connecting-ip`). The new account is named after the email's local part. Codes and their email credentials live in two new tables (migration `perpetual_red_hulk`); the code email is in en/sl from the catalogs (`authEmail.*`, Slovenian awaits owner review) and goes out after the response through the request's `waitUntil` from `Styld <noreply@styld.app>` (`send_email` binding, two new keyrings `AUTH_PROOF_KEYS` and `AUTH_REQUEST_BINDING_KEYS`). `makeAuth` moved to `storage.ts` so the browser's contract import does not pull in the strategies; auth may now use `@styld/i18n` (graph rule and test).
  - Website: Foldkit routes (`/`, `/login`, `/login/connect`, `/account`, NotFound with a 404 from the server), a Login Submodel (`page/Login.ts`, `page/LoginView.ts`) and the account page. The code stays in the code form and never enters the Model, a Message or a Command; the browser adapter (`EmailSignIn.ts`) reads and empties it, and takes flow and request ids from Effect's platform `Crypto`. The page keeps one sign-in flow for the whole visit, because a new flow gets no mail while a code from the old one is live; the server answers a wrong, expired or spent code the same way, so the page counts tries and times the code itself to say which. Signed-in visitors on `/login` go to their account, signed-out visitors on `/account` to `/login`, and `/login/connect` returns to the assistant's pending authorization. `PasswordForm.ts` and the old account view are gone; the password strategy stays server-side for fixtures.
  - Evidence: Scene tests (sending, invalid email, the full code journey, wrong codes and the third using the code up, the resend pause and announcement, another email keeping the address, the assistant return, account sign-out) and Story tests (expiry, stale timers, resend gating, the flow kept across emails and dropped after a refusal, session routing); native workerd and Chromium through the public edge: a new address creates its account with one code from the sent mail (after a wrong code is refused and the field cleared), the session survives a reload, sign-out kills the replayed cookie, the same address signs in again and the spent first code is refused, and telemetry never carries the email or a code.
  - Native workerd found what an in-memory run could not: a Worker has no socket peer, so the API Worker gives Yielded the visitor's network from `cf-connecting-ip`; Alchemy's execution context taken in the Worker constructor refuses to run outside a handler, so the email sink closes over each request's live context; and the native fixture Worker now builds its auth on first use, because auth validates its tables against D1 before Alchemy has migrated it.
  - Full gate passed: 126 type/Effect files with zero findings, 130 unit tests, 14 native workerd/Chromium tests with 139 assertions, initial browser bundle 241,219 gzip bytes of 256 KiB (up from 231,015; later pages will need splitting).
  - Deployed: release `9d0fc6b4ac4e0fb84f244612e4f6afaed1611a7d` is on the isolated preview (four updates: edge, API and website Workers and the D1 database, which applied the S2 and S3 migrations; two new bindings, `STYLD_EMAIL` and `OAUTH_REGISTER_RATE_LIMIT`; no deletes). `/api/health` reports it, `/login` and `/login/connect` answer 200 and an unknown path 404, the protected-resource metadata is served, and deployed acceptance passed (1 test, 25 assertions). A real code went to a dedicated myinbox address (`styldv2-preview.kris@myinbox.lol`, 14-day expiry): it arrived in the inbox from `Styld <noreply@styld.app>` with SPF, DKIM and DMARC passing, and completing it created the account and a session that `/api/me` reads.
  - Not done: Google sign-in (Railway refused the token, so v1's client id and secret are unavailable; the owner adds them and the `/api/auth/google/callback` redirect). No consent-quality copy yet for the sign-in page's terms line. Real mail to a real inbox is verified after the deploy.

- **S4 wardrobe.** People keep their pieces: a photo becomes a piece with a category (v1's six), an optional shelf (v1's subcategories, `other` in every category), up to six of v1's thirteen colours, a name and notes. One `Wardrobe` service (`packages/server/src/wardrobe/`) implements every operation for `CurrentAccount`; the typed API (`WardrobeApi`: list, get, createUpload, addPiece, updatePiece, deletePiece) and the MCP tools are projections of it, and every D1 read and write names the account.
  - Photos: `createUpload` hands out a one-time `PUT /api/uploads/:id?token=` path; the token is the only credential (stored as a SHA-256 digest, carried in the query string that Workers logs redact), so assistants can upload without the website's cookie. The bytes are read whole (at most 15 MB, refused before reading when the declared length is larger) and must be the declared type by their own signature (JPEG, PNG, WebP, AVIF, GIF; HEIC waits, browsers convert it), then go to R2 under `accounts/<id>/`. Deviation from the plan: buffered, not streamed, because the Worker's stream types and Alchemy's binding types do not meet; the cap is the same.
  - `addPiece` is idempotent per operation id: the piece, the spent upload and the receipt are one atomic D1 batch, a unique upload id stops two pieces sharing a photo, a repeat with the same meaning returns the same piece and a different meaning is a conflict. New pieces are `processing` and a Cloudflare Queue (`StyldV2PieceProcessing`, three attempts, then the piece shows as `failed`) runs the `GarmentCutout` port; tonight `keepOriginal` shows the photo as it arrived, and the Meta AI cut-out model plugs in there. Deviation: no dead-letter queue; the last attempt marks the piece failed instead.
  - Images: `/cdn/pieces/:id/thumb|full` serves the owner's image through the Images binding as WebP (480 and 1600 px wide, `private`, an ETag that changes with the piece), falls back to the stored photo when a transform fails, and answers another account with 404.
  - Website: `/wardrobe` (category filters with counts, a 2/3/6-column grid of square thumbnails with captions, polling while a piece is processing), `/wardrobe/add` (Foldkit UI FileDrop with a preview, category, shelf, colours, name; the add retries a lost answer with the same operation id and never uploads twice) and `/wardrobe/:id` (photo, details, edit, delete with an in-page confirmation). Signed-in visitors get the Gallery shell's navigation for the built sections only: a tab bar on phones (Home, Wardrobe, You) and links in the desktop top bar. The typed client loads the first time a page calls the API. Copy reuses v1's reviewed keys; one new key, `wardrobe.deletePieceConfirmBody` (sl awaits owner review). The add screen has no Gallery prototype and is a design gap for the owner.
  - Languages: the browser now loads only the page's language (`catalog-en.ts`/`catalog-sl.ts` from the generator, loaded before hydrating; a language switch loads the next one first). Servers and tests provide both. The wardrobe pages had pushed the first load to 264,277 gzip bytes; it is now 234,177 of 256 KiB including the larger language, and the budget check counts that language.
  - Evidence: Story and Scene tests for the three pages and the shell; native workerd through the public edge: signed-out 401, a wrong token 404, bytes that are not the declared type 415, a reused upload 409, a shelf from another category 422, an add, its replay and a conflicting reuse, the queue turning the piece `ready`, the WebP thumbnail with ETag/304, another account refused on read, image, edit and delete, a category change dropping a shelf it lacks, and deletion removing the R2 object.

- **S5 MCP wardrobe tools.** Assistants get the wardrobe through the same operations: `piece_search` (words, category, colour, pages of up to 50), `piece_get`, `upload_create` (the one-time upload URL), `piece_add` (from an `imageUrl` or an `uploadId`, idempotent per `operationId`), `piece_update` and `piece_delete` (destructive hint). Results link each piece's page and never carry an image address. A photo address is fetched only over plain https on the default port, following at most three redirects by hand (each checked again), refused unless it is an accepted image type, and cut off at 15 MB while reading; it then goes through the same upload checks. Refusals carry a code, a message, a recovery and whether to retry.
  - Evidence: unit tests (the tool list, budgets and names, search filters and paging, no image addresses, the imageUrl/uploadId rule, the https rule) and the native OAuth acceptance, where an SDK 2.x client uploads a photo, adds it, gets the same piece back for the same operation id, finds, changes and deletes it.
  - Full gate passed for S4 and the S5 tools: 159 type/Effect files with zero findings, 163 unit tests, 15 native workerd/Chromium tests with 182 assertions, initial browser bundle 234,173 gzip bytes of 256 KiB.
  - Commits: `68e12b0` holds only the old combined catalog's deletion, because a failed `git add` left the rest unstaged, so main does not build at that commit; `bf3db11` carries the change and is green. History was not rewritten.
  - Deployed: release `bf3db112cd2d3fb449f1fdc2a15848d1cddb0c79` is on the isolated preview (created: Queue `StyldV2PieceProcessing` and its consumer; updated: the three Workers and the D1 database, which applied the pieces/uploads/receipts migration; new bindings: R2, Images, the queue; no deletes). `/api/health` reports it, `/wardrobe`, `/wardrobe/add` and a piece path answer 200 and `/wardrobe/add/more` 404, deployed acceptance passed (1 test, 25 assertions). With a session from a real Slovenian sign-in code (myinbox, SPF/DKIM/DMARC pass): an upload, a PUT, an add, the real queue turning the piece `ready` within a second, the real Images binding answering a WebP thumbnail (`private`, ETag) and 401 without the session, then deletion and 404.
  - Account page: a "Use Styld in ChatGPT or Claude" section with the server URL (`<origin>/mcp`, from a new `origin` flag the server sets), a copy button (clipboard in a Command; failure tells the person to copy by hand) and the first two setup steps for each host from v1's reviewed `connect.*` copy (its later steps promise browsing without an account and a revoke page, which v2 does not have). The account page is now a Foldkit Submodel; sign-out reaches the root as an OutMessage.
  - Not done in S5: the Gallery consent page; assistants still see Yielded's default consent page in English. No list of connected assistants or revoke button yet; deleting the account revokes them.

- **S6 account deletion.** `DELETE /api/me` (typed, session-protected) runs `AccountLifecycle`, which Styld owns because Yielded leaves `SubjectLifecycle` to the application. Access ends first in one D1 batch (the account disabled with a new security revision, its sessions and its assistants' grants deleted), then the account's R2 prefix is swept a page at a time, then its auth rows and the account go in a second batch and its pieces, uploads and receipts cascade with it. A failure after the first batch leaves a closed account that a retry completes. The account page asks first, can be kept, shows a failure, and sends the person to the home page when the account is gone.
  - Evidence: Scene tests (confirm, cancel, failure, success to home); native: an account with a stored photo is deleted, its old cookie is refused at once, its photo is gone from R2 and its password no longer signs in. Assistant grants are deleted by the same batch but not yet exercised by a native test.
  - New copy: `account.assistants.*`, `account.deleteAccount*` (sl awaits owner review).
  - Full gate passed: 162 type/Effect files with zero findings, 165 unit tests, 15 native workerd/Chromium tests with 192 assertions, initial browser bundle 235,827 gzip bytes.
  - Deployed: release `cd241be5c558d33d160d1f19076f8ba90515d531` is on the isolated preview (three Worker updates, no resource changes); `/api/health` reports it and deployed acceptance passed (1 test, 25 assertions). On the preview, the test inbox account signed in with a real code, added a piece and deleted itself: `DELETE /api/me` 204, its old cookie then 401 on `/api/me` and `/api/pieces`, and the same address next received "Your code to create a Styld account", so its identifiers are gone (the code was left unused).

- **S7 review.** Three independent reviews ran on the night's work: security/privacy/durable behaviour, architecture/tooling, and the product in Chromium on the preview at 390 and 1280 px (signed in with a real code, a piece added, edited and deleted, the account deleted at the end).
  - Fixed:
    - **Code guessing (security, high).** Yielded's per-address code limits counted per isolate, so spreading requests over isolates allowed thousands of guesses a day. Two durable per-address budgets now apply (D1 buckets keyed by an HMAC of the address): 5 code requests and 10 code tries an hour, the same for known and new addresses. The per-network limit is a Workers RateLimit binding (5 a minute), provided per request.
    - **Deletion that could not finish (security, high).** After access ends, the rest of a deletion is queued as well as tried at once, and is safe to repeat; it also removes the codes stored with the address and sweeps photos again at the end. Uploads to a closed account are refused.
    - **Typed API changes without the website's own Origin/CSRF header (security).** Every mutation now goes through Yielded's admission and answers 403 (`RequestRefused`) otherwise; native tests check a bare DELETE, a foreign Origin and a JSON POST without the header.
    - **Upload tokens in traces (security).** `token` joins the query parameters Effect's tracer redacts; not yet confirmed in a deployed trace.
    - **Pieces stuck in processing (both).** A lost queue message makes the add answer retryable, so the retry with the same operation id schedules it again. A failed "mark failed" retries the message instead of dropping it, and the queue settles each message exactly once (unit tests).
    - **Duplicate piece on a lost answer or concurrent repeat (both).** The add re-reads its receipt before calling the upload used.
    - **Deleting a piece removes its photo first**, so a failed row delete can be retried.
    - **Images revalidate** (`no-cache` with the ETag), so a processed image shows at once.
    - **MCP** takes its piece schemas from the protocol, gives the photo import a 10 s timeout, and answers 503 when D1 does not answer the enabled check. Photo-import unit tests cover redirects, the per-hop https rule, type and size refusals.
    - **Keyboard focus (product, high).** It is visible on the photo picker and on chosen colour swatches.
    - **Smaller product fixes.** Focused fields scroll clear of the phone's tab bar, and a file that is no photo is reported on the photo ("That file isn't a photo we can use").
  - Full gate passed: 163 type/Effect files with zero findings, 171 unit tests, 15 native workerd/Chromium tests with 196 assertions, initial browser bundle 236,022 gzip bytes. Release `66ffb1e886c180703a63f533d938092f1931acd4` is on the isolated preview (three Worker updates, one new binding `EMAIL_CODE_RATE_LIMIT`, no deletes); `/api/health` reports it, deployed acceptance passed (2 tests, 35 assertions, including the MCP discovery, challenge and registration checks), and a real code request through the new limits still delivered mail (SPF/DKIM/DMARC pass).
  - Remaining from the reviews (not done tonight):
    - **Security and durability:**
      - a scheduled cleanup of expired uploads, codes, OAuth grants and assertions (abandoned uploads keep their bytes in R2 until then);
      - a per-account upload quota;
      - one `Accounts` read shared by `account_get` and `/api/me`;
      - one session-cookie helper for the raw routes (the image route answers 401 when D1 fails).
    - **Foundations for the next slices:**
      - the `GarmentCutout` port needs an idempotency key and an outcome-unknown error, plus a Domain generation with a credit reservation, before a paid model plugs in;
      - search and import-from-photo belong in the `Wardrobe` service rather than the MCP projection;
      - the website's bundle budget does not count the typed client that signed-in pages load (about 11 KB);
      - the page's origin and the OAuth issuer have different sources and will differ on a custom domain.
    - **Product:**
      - focus moves to the page body after most state changes;
      - signed-out protected pages render before the redirect, and sign-in always lands on the account rather than where the visitor was going;
      - Slovenian mixes formal and informal address, and "Omara" with "Garderoba" (owner review);
      - touch targets for category chips are 36 px;
      - several Gallery differences: the top bar holds the language picker, the desktop add button is round, and some heading sizes differ.

## Gallery design — 2026-10-28

- Owner decisions: the Gallery direction replaces Atelier; the port is reprioritised to the experience first (sign-in, boards and public profiles, the MCP server, AI on Cloudflare with one credit balance through AI Gateway with v1's own provider keys), shops last. v2 reuses v1's Google OAuth client and email sender.
- The Gallery prototype lived only in `/tmp`; it is now in `docs/design/gallery/` (built site with the ten archived directions, its generator, data and the exploration scripts; the generator reproduces the site). Review screenshots, the shop photo cache and a raw wardrobe dump with a real user's id were left out.
- v2 named Hanken Grotesk but never loaded it, so screens rendered in a system font. The variable font is now self-hosted from `@fontsource-variable/hanken-grotesk` 5.3.0 (latin and latin-ext); the wordmark and favicon are the STYLD logo v1 adopted after the baseline. That commit (`3422fe9`) alone was not green: lint rejected the side-effect CSS import (now allowed for `.css` only; other side-effect imports still fail) and Vite inlined the smallest font subset as a `data:` URL that the CSP's `font-src 'self'` blocked, which native browser acceptance caught. Fonts now always ship as files, and acceptance checks the paper colour and that the font is in use.
- `DESIGN.md` is rewritten for Gallery, and the tokens, document defaults, actions and the existing screens (top bar, landing, inspiration, footer, diagnostics sheet, sign-in, account) follow it: one sans face, ink pills, stock fields, signal-underlined links, the prompt as a bottom sheet. The language picker keeps its label for assistive technology but hides it visually. Copy is unchanged; Gallery's landing copy names shops and waits for the catalog.
- Full gate passed on `c471548` (103 type/Effect files with zero findings, 96 unit tests, 13 native workerd/Chromium tests with 96 assertions). Release `c471548d1b400ecb319a718eaf6eea155c771858` is deployed to the isolated preview (three Worker updates, no resource changes); `/api/health` reports it, deployed acceptance passed (1 test, 25 assertions), and the font is served from the preview's own origin as `font/woff2`.

## Phosphor icons — 2026-10-28

- Owner decision: Phosphor icons replace Lucide (compared side by side on Styld paper; Lucide is the most used set, which is why it reads as the default look). DESIGN.md › Icons: Light weight at 24px and up, Regular below, colour from the text, hidden from assistive technology beside a visible label.
- `docs/migration/v1-icons.json` maps all 122 Lucide icons v1 imports (211 files at `dddf9d44`) to Phosphor; 13 entries carry a note where Phosphor has no exact match (for example ImagePlus, FolderHeart, ScanEye). Screens decide those when they are ported.
- `tools/icons.ts` builds `apps/web/src/PhosphorIcons.ts` from the pinned `@phosphor-icons/core` 2.1.1 and the allowlist `apps/web/src/icons.json`, so only listed icons ship; `icons:check` in `bun run check` rejects an edited or stale module, an unknown or unsorted name, and a v1 mapping to a missing icon (each mutation tried).
- First use, matching v1's sign-in: the `circle-notch` loader in the pending sign-in button and beside the session check status, in the new `signal` token. It is the first animation, so the reduced-motion rule from DESIGN.md › Motion landed with it; loaders are exempt. Checked in Chromium: under reduced motion the loader still runs, and focus stays on the pending button. Server rendering emits the hidden SVG (unit test), and the Scene test keeps the button's accessible name as its label.
- Full gate passed on `59b7ba3` (103 type/Effect files with zero findings, 96 unit tests, 13 native workerd/Chromium tests with 95 assertions, initial browser bundle 231,015 gzip bytes). Release `59b7ba3fd590cdccdd81181448fbfe5221bc50ca` is deployed to the isolated preview (three Worker updates, no resource changes); `/api/health` reports it, deployed acceptance passed (1 test, 24 assertions), and the live `/login` server-renders the loader SVG. The throwaway icon comparison Worker (`styld-icon-shortlist`, deployed by hand with wrangler, never in Alchemy) is deleted.

## Foldkit agent tooling — 2026-10-28

- `FOLDKIT.md` (Foldkit's own convention file for app code) is copied verbatim from the `repos/foldkit` snapshot; `vendor:check` rejects an edited or stale copy and `--pull` refreshes it. AGENTS.md points at it and keeps precedence.
- The Foldkit DevTools MCP server (`@foldkit/devtools-mcp` 0.25.0, pinned with the Foldkit catalog) is registered in `.mcp.json` for Claude Code, Codex and Cursor, started with `bunx --no-install` (npx cannot read Bun's `catalog:` overrides, and a pinned local install never fetches). The application passes `devTools: { Message }`, so agents can dispatch decoded Messages in dev; production builds start no bridge.
- `@foldkit/vite-plugin` 0.28.0 never started its MCP relay on Effect 4.0.6+: `relayId` reads `crypto.randomUUIDv4` as an Effect, which is now a method, and the forked fiber died silently (upstream foldkit/foldkit#1733, open). `patches/@foldkit%2Fvite-plugin@0.28.0.patch` makes it a call; drop the patch when an upstream release fixes it. Live check against the dev server, headless Chromium and the MCP server over stdio: the relay starts and publishes its record, `foldkit_list_runtimes` sees the tab, `foldkit_get_model` reads `root.telemetry`, dispatching `OpenedTelemetrySettings` reopens the consent prompt in the page, and an unknown Message is rejected by the schema. Without the patch the relay never starts. MCP clients must pass `XDG_RUNTIME_DIR` through to the server (the relay registry lives there); a client that strips the environment sees no dev server.
- `@foldkit/ui` 0.169.0 (with the Foldkit catalog) now renders every button and the language picker: `actionButton` wraps its headless Button, the picker uses its Select. Pending sign-in and sign-out buttons are `aria-disabled` instead of natively disabled, so a pending button keeps focus; disabled actions now show DESIGN.md's half opacity and `not-allowed` cursor (v2 had no disabled style before), and DESIGN.md records the button rule. A failed language save now describes the picker (`aria-describedby`). Scene tests cover the pending button and that a second submission (Enter still submits through an `aria-disabled` button) starts no second sign-in; removing the update guard fails it. The password form's inputs stay hand-built until email OTP replaces that form.
- Full gate passed on `107c057`: 99 type/Effect files with zero findings, typed lint, Knip, no clones, 95 unit tests, 13 native workerd/Chromium tests (95 assertions), initial browser bundle 230,345 gzip bytes. Release `107c057a3678aba644b9527fe117d2c2cb4853ae` is deployed to the isolated preview (three Worker updates, no resource changes); `/api/health` reports it and deployed acceptance passed (1 test, 24 assertions).

## Diagnostics consent and repository — 2026-10-28

- Owner decisions: the Safari/iOS 17.5 CSS baseline is accepted; browser diagnostics need explicit consent; production sampling and aggregation of browser telemetry are deferred until before launch. `AUTH_SESSION_KEYS` stays bound until the email OTP and MCP OAuth work shows whether anything needs signed sessions.
- The repository is private at `github.com/grmkris/styld.app`. The hosted CI workflow passed its first run (`bun run check`, including native workerd/Chromium tests) at `f918c7e`.
- Browser diagnostics now wait for a choice: a sticky prompt (Allow / No thanks) and a footer Diagnostics button to reopen it. The prompt copy is new in English and Slovenian, has no v1 equivalent and awaits owner review. Unit tests cover the states, cookie parsing and server rendering; browser acceptance proves nothing is posted before the choice, past the SDK's 5 s auto-flush (a build without the gate fails), and that Allow stores the grant.
- Release `4ceddc8c2b5e417c5be1568559e01bcd02e0884c` is deployed to the isolated preview; `/api/health` reports it and deployed acceptance passed (1 test, 24 assertions), including the consent checks.

## Preview release after review — 2026-10-28

- Commit `7ee1b45ad5e0449e430663f0beea4fe8ea0fa2e8` is deployed to the isolated preview (`https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev`); `/api/health` reports that release. The plan updated the three Workers and created the telemetry rate-limit binding; no resource was deleted or replaced.
- Active versions at 100%: edge `0207060b-87b7-4a99-81e9-05f3d1950235`, website `1ce08195-5cc3-4ac9-8062-1d876f33596f`, API `ae572ecb-c538-4476-a135-a16cf818fb3b`.
- Deployed acceptance passed (1 test, 22 assertions), including the CSP and anti-framing headers, the telemetry flush answered 204 by the relay and no credentials in telemetry bodies. `/api/storage` and `/.vite/manifest.json` answer 404; `favicon.svg` carries nosniff and a deny-all CSP.
- Workers Logs readback: relayed browser spans are structured records indexed by field (`styld.browser.span` such as `SaveLocale` and `ReadSession`, outcome, duration, Foldkit message) beside the server's environment, release and correlation ID.
- A burst of empty exports from one IP was throttled once Cloudflare's eventually consistent counter caught up (after 140 accepted, 16 then 52 of 80 got 429).
- Screenshots of `/` and `/login` at 390 and 1280 px match the release before the zyzz port pixel for pixel.

## Independent review round — 2026-10-28

Two reviewers read the changes since `370a0e2` independently (architecture/tooling and security/privacy/durable behaviour). No high-severity findings; every medium and most low findings are fixed with tests:

- **Isolate build.** A request arriving during another request's first build was cancelled as hung in workerd (reproduced by the reviewer). Concurrent first requests now build their own value; the first success is kept and failures are retried.
- **Wallet.** An early settle stored an accepted no-op receipt that could leave a later hold unsettleable. A settle without a pending hold is now rejected (`ReservationNotFound`); rejections leave no receipt. After settlement the Wallet keeps no record of the operation, so the generation request must refuse a changed payload for an operation it already ran.
- **Telemetry relay.** Per-IP rate limit (120/min), per-span decoding, a `Map` allowlist, exception details from span events, a 1 MiB body cap with 100 logged spans, discarded session events, route-only URLs and masked element text in the browser, and no `url.path`. API requests log structured objects (Alchemy's bridge default is a pretty string).
- **Vendored Foldkit.** Its `CLAUDE.md`, `.claude`, `.claude-plugin` and `.agents` were being loaded into agent sessions; they are excluded and `AGENTS.md` is renamed `FOLDKIT_AGENTS.md`. `vendor:check` now ties the snapshot to the installed version and the Foldkit skill pins.
- **Other.** Static files carry their own security headers (`public/_headers`); x18n checks server packages except three named files; pseudo-locales appear only in `local` and `preview`; the 44px control minimum and an explicit CSS baseline are back.
- **Recorded, not changed.** zyzz token custom properties are never applied with `vars()` and derived tokens repeat their source literals. The relay's rate limit bounds one client, not a distributed flood; production needs sampling or aggregation before launch.

## Review and stack adoption — 2026-10-28

Owner decisions after the foundation handoff: zyzz for styling, Maple for Effect browser telemetry kept inside Cloudflare, x18n for catalog tooling, official agent skills, a vendored Foldkit reference and current dependency pins. A code review of the foundation was folded in. Full parity is still not achieved; every DELIVERY matrix row remains pending.

- **Skills and references.** Vendored the official Foldkit (`foldkit`, `generate-program`, `audit-program`), x18n (`x18n`, `x18n-setup`, `x18n-check`) and Cloudflare `workers-best-practices` skills with pinned provenance, plus local `effect`, `zyzz` and `styld-telemetry` skills. `repos/foldkit/` is a hash-verified snapshot of `foldkit@0.169.0` without Foldkit's own Effect copy (`bun run vendor:check`).
- **Dependencies.** Effect 4.0.7, tagged Drizzle `1.0.0-rc.5` (no schema change), intl-messageformat 12.1.4, tsrs 0.20.1, oxfmt 0.75, oxc-parser 0.156. Held: oxlint 1.90 (the pinned tsrs-lint backend predates it) and Bun 1.4.4 (shared box toolchain). `@effect/platform-browser` is declared again as Foldkit's runtime peer.
- **Review fixes.** The API Worker builds its auth stack and router once per isolate instead of per request; building inside the first request's context hung later requests, so the build runs with the constructor's services (unit-tested helper, CPU saving not measured). The edge adds a same-origin CSP with `frame-ancestors 'none'`, X-Frame-Options, nosniff, a referrer policy and HSTS. `/api/storage` no longer lists table names publicly. Pseudo-locales are offered only outside production. Wallet command IDs come from one helper that includes the conflict-checked inputs.
- **Styling.** zyzz replaces `styles.css` with typed Atelier tokens, global document rules and per-view style modules through a Foldkit adapter. Screenshots of `/` and `/login` at 390 and 1280 px match the previous release pixel for pixel. Two intended differences: every primary-action button now drops the browser's default border and shows a pointer (previously only the form submit did), and the 44px control minimum is restored as a global rule. Typecheck rejects unknown properties, tokens and value types, and Knip reports unused styles; zyzz's lint adds only `valid-styles` because its JSX and namespace rules cannot apply. The CSS baseline is explicit: Chrome/Edge 123, Firefox 120, Safari 17.5 (zyzz emits native nesting). Token custom properties are never applied with `vars()`, so tokens resolve through compiled fallbacks.
- **Telemetry.** Maple's Foldkit layer turns Commands and navigations into Effect spans and posts OTLP/JSON to the same origin; the API Worker relay allowlists and bounds them into structured Workers Logs. Server spans record `styld.browser.trace_id` from a valid `traceparent`. Replay, session rows, visitor IDs, storage and Command arguments are off. Native browser acceptance proves the flush and that no telemetry body contains the typed email or passwords.
- **x18n.** `bun run translations:check` (`x18n check --strict`) fails on missing keys, invalid syntax, missing or stale translations and hard-coded strings in application code; only style modules and three files of SQL or developer-only defect messages are exempt. placeholder-mismatch is off (x18n 0.1.2 plural false positives); unused keys are info while 2,251 of 2,296 keys await unported screens.
- **Gates.** Knip production mode now covers every web module; the bundle budget measures assets a page loads (initial 228,512 gzip bytes of 256 KiB; all 287,491 of 512 KiB).
- **Not changed, deliberately.** The password sign-in form still shows one error for wrong credentials, rate limits and outages; the email OTP flow replaces it. SSR still renders in UTC until a page shows dates. `AUTH_SESSION_KEYS` appears unused with stateful sessions (typecheck passes without it) but stays until the OTP and MCP OAuth work confirms no signed tokens need it. The repository has no git remote, so the CI workflow has never run.

## Foundation boundary review — 2026-10-28

- Commit `2d21426` closes a reproduced dependency-check bypass: a browser entry importing a JavaScript file that imported `node:fs` previously passed with only the entry audited. Discovery and traversal now cover TS/TSX/MTS/CTS/JS/JSX/MJS/CJS, TypeScript import-equals declarations, extensionless barrels and explicit JavaScript imports backed by TypeScript source. Bare Node built-ins are rejected; unresolved or ambiguous local source imports fail rather than silently skipping an edge.
- Seventeen additional filesystem regression cases exercise the complete graph checker. The full `heavy --wait bun run check` passed with exit 0: 81 type/Effect files with zero findings, all tooling gates, 75 unit tests, 13 native/browser tests with 82 assertions and bundle budgets (205,943 browser gzip bytes; 909,703 SSR source bytes). Log: `/tmp/styld-v2-boundary-review-final.log`; durable exit receipt: `/tmp/styld-v2-boundary-review-final.exit`.
- This commit changes quality tooling and handoff documentation only. The deployed application release remains `08191f5b40872d1806a4a677157e1af97f0c6482` with the accepted preview readback below. No email OTP implementation was started. The foundation is ready for handoff; the original full-parity goal remains active pending an explicit pause instruction.

## Browser identity foundation — 2026-10-28

- Added Foldkit `/login` and `/account` routes with typed Yielded session/sign-in/sign-out Commands, localized form feedback, accessible labels and mobile/RTL layout. Credentials stay out of Model, Message and Command arguments; the password field clears when the command takes its value.
- Native acceptance now binds the real public edge origin, as preview does. Chromium proves failed-login feedback, successful password login for a synthetic test identity, session persistence across reloads, account navigation, logout and immediate rejection of a replayed cookie. Seed routes exist only in the local test Worker.
- Full `heavy --wait bun run check` passed (exit 0): formatting, provenance, 2,296-message catalog, 71-file Effect/tsrs check with zero findings, typed lint, 56 unit tests, production build, and 12 native/browser tests. Log: `/tmp/styld-v2-identity-check.log`.
- This adds browser acceptance to the password identity foundation. Email OTP signup/login, Google, anonymous sessions/merge, onboarding and all remaining parity requirements remain pending. Deployed acceptance of this slice is recorded separately after deployment.

## Preview release — 2026-10-28

- Commit `73b01a2f36c24d3dcb11eeded65ad121b53f7f2a` is deployed to the isolated preview URL `https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev`.
- `STYLD_RELEASE` readback matches the commit on `styldappv2-styldworker-preview-xl7ey7d6cq4z7vez`; `VITE_STYLD_RELEASE` matches on `styldappv2-styldwebsite-preview-z4qir7nggl6fxu2x`. API and Website workers.dev/version previews remain disabled. All three Workers have native logs/traces enabled, query-string redaction enabled and head sampling set to 1 for this preview.
- `STYLD_PREVIEW_URL=... heavy --wait bun test tools/preview.native.test.ts` passed: 1 test, 18 assertions. The deployed check covered health, auth/CSRF, a rejected foreign origin, missing-route behavior and hydrated browser rendering.
- Cloudflare deployment readback: Edge deployment `2d9b2be9-3783-4966-b8f7-cc6589858d03` / version `59314f15-a71d-4e8d-9222-f7522df57070`; Website deployment `430bca42-4f35-4f72-a880-5091ec91e42e` / version `fe3ab1ee-cb63-4e73-bcfc-79cc4853ecda`; API deployment `ff3d920b-d3a1-4071-aa9a-45d8d904a895` / version `18233254-e09b-4402-bf71-11974be6f169`.
- This is the foundation handoff release, not a feature-complete Styld replacement. The next agent should begin with the identity parity matrix (email OTP, Google, anonymous merge and onboarding), then port the v1 domains in the order recorded in `docs/DELIVERY.md`.

## Final foundation deployment — 2026-10-28

- The tested code release `08191f5b40872d1806a4a677157e1af97f0c6482` is deployed to the same isolated preview URL. Deployed acceptance passed again: 1 test, 18 assertions.
- Cloudflare readback: Edge deployment `fc205fa1-8c15-48c9-9ff1-b68b6632bdae` / version `62634d2d-bf16-4fdc-8094-d0853164d0d2`; Website deployment `4f1e4c56-80f5-4929-a830-cf4443ffb683` / version `62c1ef52-1a36-4401-b7b9-7c1b35e56907`; API deployment `0060c4a1-fea8-4542-86aa-0d58e111e724` / version `123540e8-abc2-4f65-bc07-905d84e787cc`.
- API and Website `workers.dev` and version previews remain disabled. All three Workers have native logs/traces enabled, query-string redaction enabled, persistent logs/traces and head sampling set to 1 for this preview. API/Website release bindings match the deployed code release; the edge is the public routing shell and carries no application release binding.

## Foundation handoff checks — 2026-10-28

- Added validated agent provenance and generated Codex/Cursor MCP configuration; `repoagents check`, provenance verification and the offline skill verifier pass. Vendored skills are byte-pinned, with the Alchemy Domain license recorded.
- Added graph, browser-boundary, suppression-census, checker-canary, Knip and duplicate-code gates. The browser graph is transitive and export-map aware; the census has four reasoned directives and rejects explicit `any` and non-null assertions. Knip passes in normal and production modes. There are zero duplicate blocks at the configured eight-line/50-token minimum after extracting the shared native auth request helper.
- Added a native restart/recovery fixture. It waits for the new Worker generation and API release identity, then proves Domain wallet state/idempotency receipts, stateful auth session reads and R2 bytes survive the restart. The test also proves duplicate settlement and reservation commands remain retry-safe.
- Added browser/SSR bundle budgets (256 KiB total gzip browser assets, 3 MiB SSR source), a hosted CI workflow and `docs/HANDOFF.md`. The complete local gate passed for this handoff's code: formatting, agents, provenance, i18n, graph, suppressions, canaries, 81-file Effect/tsrs with zero findings, typed lint, Knip twice, jscpd, 58 unit tests, production build, 13 native/browser tests with 82 assertions and bundle budgets. Browser assets measured 205,941 gzip bytes; SSR measured 909,703 source bytes. Log: `/tmp/styld-v2-foundation-check.log`.

## 2026-10-28 — initial baseline

- Created the new repository at `/home/kristjan/code/styldappv2` on main.
- Captured v1 commit `dddf9d44b656701282debd2ff88b343851145126` and 341 relevant files.
- Inventory counts: {"pages": 57, "routeHandlers": 1, "routers": 24, "workers": 15, "databaseDomains": 24, "mcp": 67, "behaviorTests": 153}.
- Preserved prior architecture/tooling/localization research under `docs/research`.
- New implementation, quality gates, native runtime proof, provider integration, deployment and review rounds remain to be completed.

Next: install the exact compatible stack, implement and prove quality gates, then the first vertical runtime slice.

## Foundation gate bootstrap

- Exact stack catalog and lockfile created; runtime packages will be resolved as their owning workspaces are added.
- Type checker: effect-tsrs 0.2.2, TypeScript and Effect diagnostics in one pass with plugin coverage verification. Editor/reference checker: tsrs 0.20.0.
- Oxlint 1.89 uses the pinned SHA-256-verified tsrs-lint backend with no stock fallback. Anti-slop rules and selected skills have file hashes.
- Initial gate passed: formatting, 37 provenance files, 8 checked TypeScript files with zero findings, typed lint, 2 backend-integrity tests.
- Graph, Knip, duplicate/suppression checks, semantic canaries, native runtime, app implementation and deployment remain pending. This initial gate is not the final delivery gate.

## Localization foundation

- Preserved both v1 catalogs (2,296 string leaves each), including four intentionally empty onboarding result prompts per locale.
- Added reproducible catalog/key/argument generation and a content version, cached explicit-locale formatting, structured rich text, and expansion/RTL pseudolocales that preserve interpolation values.
- The catalog gate checks key/variable parity, ICU syntax, approved rich tags and plural categories. Three exact frozen-copy plural exceptions preserve v1 wording; additional omissions fail.
- Local foundation gate passed: Oxfmt, 37 provenance files, generated-catalog checks, effect-tsrs on 17 files with zero findings, verified tsrs-lint/Oxlint, and 15 tests.
- Worker Intl/concurrency, Foldkit SSR/hydration, locale negotiation/persistence, safe formatter-error telemetry, email coverage and page/accessibility acceptance remain pending. This is a tested package foundation, not completed localization parity.

## Domain wallet foundation

- Added Alchemy Domain Wallet: separate credit pools, bounded pending reservations, fingerprint conflicts, subscription-first allocation, original-pool refunds and trusted service authority.
- Full current gate passed: 30 TypeScript files, zero findings, verified typed lint, 20 tests. Wallet stories run against Domain.InMemory, not Cloudflare persistence.
- Domain beta.84 lacks the skill's Domain.verify helper; model construction validates its definitions instead. This deviation is source-verified.
- Generation request idempotency, durable orchestration, complete billing semantics, native concurrency/restart proof, wallet read projections, HTTP/MCP authority and deployment remain pending.

## Native Cloudflare runtime proof

- Added an Alchemy server Worker with native Cloudflare tracing/log observability enabled, compatibility date `2026-10-19`, and a local stack entrypoint.
- The original workerd acceptance deployed and deleted a dedicated `RuntimeWorker` fixture plus `WalletAggregate` Durable Object. It passed Slovenian `Intl` formatting and concurrent reservation serialization with separate-user state; it did not execute the application `StyldWorker` entrypoint.
- Added the first D1/Drizzle/Yielded Auth persistence boundary: the application-owned `accounts` table and Yielded's managed credential/session tables are generated as explicit SQLite migrations. Alchemy owns application of those migrations in an isolated v2 D1 database; its bookkeeping remains separate from the application schema.
- Added an isolated EU-jurisdiction R2 bucket and native Worker bindings for D1 and R2. The native workerd acceptance now proves the migrated application tables are readable and the R2 binding is live; the gate passes 3 tests (Intl, Domain concurrency, D1/R2 storage).
- Added the first live Yielded Auth boundary: the shared `AuthContract`, D1-backed credential/session persistence through `@yielded/auth-persistence-drizzle`, an application secret, signed session keyring decoding, and origin/CSRF-protected HTTP routes. The native workerd acceptance now proves an unauthenticated `getSession` request through the generated Worker router; the gate passes 4 tests (Intl, Domain concurrency, D1/R2 storage, Auth HTTP).
- This still proves local native storage and host composition only. Eviction/restart recovery, alarm/backoff, deployed workers.dev readback, browser telemetry, sign-in/provider flows, and the full HTTP/MCP surface remain pending.

## Auth/runtime slice gate

- `ALCHEMY_TEST_DEV=1 bun test packages/server/test/Runtime.native.test.ts` passed: 4 tests, 0 failures.
- `bun run format:check`, `bun run provenance:check`, `bun run i18n:check`, `bun run lint`, `bun run test:unit`, and `heavy bun run typecheck` passed. The unit suite reported 9 files and 51 tests, later found to include duplicate workspace-symlink discovery; this historical count is not unique coverage. Effect-tsrs checked 55 files with zero findings.
- The Auth HTTP acceptance uses the generated POST `getSession` contract with explicit `application/json`; no CSRF or origin checks are bypassed. The native fixture uses loopback-only test secrets and insecure cookies; production requires Worker secrets and secure cookies.
- Added a browser-safe `@styld/auth/client` adapter around Yielded's `Client` transport. It uses the same `AuthApi` contract, credential-inclusive fetches, bounded JSON envelopes and the standard CSRF header; a contract test verifies the generated route and request body without mocking modules. Foldkit UI wiring and same-origin API proxying remain the next host integration step.
- The published Alchemy beta.84 Cloudflare adapter required the minimal export-map patch in `patches/`; its Node/Bun import regression test passes.

## Observability metadata slice

- Added `@styld/observability`, a shared Effect boundary that accepts only bounded environment, release, component, kind, correlation, operation, job and attempt fields. It maps the same approved attributes to named spans and log annotations; request bodies, credentials, signed URLs, prompts and arbitrary headers never enter this seam.
- The native server Worker and Foldkit SSR request boundary now derive metadata from deployment bindings/build identity plus allowlisted `x-styld-*` headers. The native fixture carries explicit `local`/`native-test` identity, while Alchemy preview binds `preview`/`preview` identity.
- The package tests prove header bounds, secret-header exclusion, span attributes and log annotations. Unit coverage was 29 tests across 8 files. The 4/4 native fixture tests did not exercise the new application observability wrapper. Client-supplied metadata remains insufficiently constrained as a privacy boundary; generated correlation identity, real release metadata, deployed trace/log readback, browser telemetry ingestion and application metrics/alerts remain pending.

## Application runtime and public edge

- Replaced the speculative custom Foldkit entry with a separate public edge and supported generated SSR. Internal API and website Workers disable workers.dev and version preview URLs. The edge serves the build's static files and forwards the original requests/responses through native service bindings.
- Corrected D1/R2 binding-layer composition, deferred runtime-only auth configuration out of Alchemy planning, and supplied Alchemy's HTTP platform services to the real application router.
- Auth signing keys now decode from Cloudflare secret-text JSON, with key-length, key-ID, active-key and duplicate-key checks. Configuration errors omit raw input. The configuration module is independent of the auth runtime and its WASM dependency.
- Fixed browser entry tree-shaking: the package now declares the hydration entry's side effects, so both the actual client code and its CSS survive the generated Foldkit import.
- Native acceptance now tests the actual application Worker and production SSR artifact in workerd through the edge. Eight tests pass, including Chromium hydration, English/Slovenian switching, cookie persistence after reload, RTL/mobile overflow, built JS/CSS delivery, auth session reads, Origin/CSRF rejection, 404s, D1/R2 bindings and wallet serialization. Local Vite dev SSR is not used as deployed-runtime evidence.
- Current unit gate: 55 unique tests in 10 files. Type/Effect gate: 64 files, zero findings. Typed lint passes. No public preview or signed-in/provider acceptance yet; all full-parity matrix rows remain pending.

## Preview configuration and SSR tracing

- The first cloud plan created only isolated v2 preview resources. Initial upload partially provisioned D1/R2 and the website, then failed because raw `secret_text` descriptors received Redacted objects. The supported bound `env` path now performs that serialization; the incorrect type suppression was removed.
- Preview secret material is generated locally in ignored `.env.preview.local` with mode 600. It is separate from v1 and production secrets.
- Deployment now requires `STYLD_RELEASE` and binds it into the API and SSR build. The Foldkit SSR boundary installs Alchemy's Cloudflare tracer per request, and the website enables native traces with an explicit compatibility date.
- After the binding/tracer correction: typecheck, typed lint, 55 unit tests and all 8 native/browser tests pass. Cloud redeployment/readback remains pending; the partial resource upload is not acceptance.

## Preview acceptance receipt — 2026-10-28

- The isolated preview deployed successfully at [`workers.dev`](https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev), release `14e5884e01b74a131df6cb7a744f4cb646ed2219`.
- Cloudflare readback: edge version `a335ebd4-fd65-4ec2-beed-1404aeda5767`, website version `5bc8e8cd-ca19-44a7-bae1-9dd691310241`, API version `7bcfb139-52c4-4567-a7c2-d168ea23c29a`; API and website have workers.dev and version previews disabled, while only the edge has the public subdomain.
- Deployed acceptance (`STYLD_PREVIEW_URL=… heavy --wait bun test tools/preview.native.test.ts`) passed: health, session read, wrong-Origin rejection, unknown API route, browser hydration, Slovenian persistence/reload, RTL mobile overflow and client assets.
- Native Cloudflare observability readback passed through the account telemetry query: edge/website invocation logs and website `styld.web.render` spans carry `styld.environment=preview`, the exact release, `styld.component=web`, and `effect.exit=success`. API `styld.http` spans also carry the exact release, server component and finite Effect outcome. Edge and downstream Workers currently have separate native trace IDs; cross-service trace continuity is not claimed. This is runtime proof of the initial release, not a production alerting policy.
- A plain Python request can receive Cloudflare Error 1010 from the account's bot controls; Playwright/normal browser requests and the deployed acceptance path pass. Do not treat a bot-blocked ad-hoc client as an application failure.

## Telemetry trust boundary

- The public edge now removes all incoming `x-styld-*` fields and supplies a new UUID correlation ID. HTTP metadata accepts only that UUID; job/operation/attempt fields must originate in trusted application operations. Tests verify malicious labels are removed while request bodies, cookies, Origin, redirects and repeated Set-Cookie headers survive.
- Deployment identity now fails with a sanitized typed configuration error instead of silently reporting local/unreleased values. The local build explicitly identifies itself as local; deployed SSR/API receive the release from the stack.
- All three Workers declare query-string redaction in native observability. This closes a platform-default leak found in the settings readback; production retention/metrics/alerts and browser telemetry remain pending.
- Gate after these changes: 65 type/Effect files with zero findings, typed lint, 56 unit tests, 8 native/browser tests, generated catalogs and provenance checks. The prior release's deployed receipt is above; redeployment of this change remains pending.

## Telemetry deployment receipt — 2026-10-28

- Release `b1d6b2167313751c26ac6c5b7a8df5c80091130e` deployed successfully: all three Worker updates completed; deployed browser/API acceptance passed (14 assertions).
- Active versions read back at 100%: edge `4227f61f-99db-403e-afa8-1482368fc322`, website `b6351b8d-c8cf-46fc-8351-23e18fd9d1de`, API `f2249c30-25d3-462c-b67a-6c13d3511a13`. API and website still disable workers.dev and version preview access.
- Native settings confirm `redact_query_string=true` on all three Workers. API and website bindings identify the exact release. Live API spans carry generated UUID correlation IDs and bounded release/environment/component fields.
- Full feature parity, signed-in/provider acceptance, browser telemetry, metrics and alerts remain pending.

## Authoritative session acceptance

- Added a test-only D1 identity fixture that creates a real Argon2id credential using Yielded's Worker hasher. It is imported only by the native-test Worker; no seed or password-signup endpoint exists in the application Worker.
- Native replay testing reproduced a stale signed-in result after logout when the complete cookie jar included the positive session snapshot. Removed `cacheFor: 30_000`; sessions now consult authoritative persistence on every request.
- Native acceptance passes 9 tests, including real password verification, wrong-password rejection, closed password signup, session claims, logout replay rejection and immediate account-disable invalidation through the actual public edge/API Worker. Type/Effect check passes on 66 files; typed lint and formatting pass.
- This is local signed-in acceptance only. Public sign-in UI, unified email OTP signup/login, Google, anonymous merge, durable attempt limiting and deployed identity acceptance remain pending.

## Durable password admission

- Replaced Yielded's per-runtime default password limiter with an application-supplied D1 token bucket. The conditional debit and bounded expiry cleanup share an atomic batch; D1 time controls refill, and bucket keys are HMAC digests instead of raw identifiers.
- Native tests prove budgets persist across separate application requests, three concurrent admissions win out of twelve for a three-token budget, fractional refill survives, and expired entries recover. Fixture routes remain exclusive to the native-test Worker.
- Full integration gate passed: formatting, 37 provenance files, 2,296 catalog messages, 68 type/Effect files with zero findings, typed lint, 56 unit tests, production build and 11 native/browser tests. Evidence: `/tmp/styld-v2-check.log` (exit 0).
- Edge/network abuse limits and isolate-wide KDF admission still need host-level integration. Email proof delivery and unified OTP registration/sign-in remain unfinished. This slice has not yet been deployed.
