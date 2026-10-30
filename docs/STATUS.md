# Delivery status

Status: active. Sign-in, the wardrobe, capture with real cut-outs (photos, video import, a held-up camera), the review tray, the daily allowance, looks and the assistant's wardrobe view are deployed to the isolated workers.dev preview (release `8bc632d`). Videos of up to 15 minutes are cut into parts on the device. Scope follows `docs/ROADMAP.md`: v2 ports only the v1 behaviour worth keeping.

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
