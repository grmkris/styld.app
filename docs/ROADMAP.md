# Roadmap

Decided with the owner on 2026-10-29, after the v1 feature inventory (`docs/migration/v1-features.md`), v1's
production usage (`docs/migration/v1-usage-2026-10-29.md`) and the Meta/segmentation research in
`~/code/meta-hackathon/grok-meta-hackathon-spike/docs/research/` (`styld-v2-wardrobe-video-motion-handoff-2026-10-29.md`,
commit `1461a78`). Revised with the owner on 2026-10-31 after a product brainstorm about how people use their own
clothes (see "Shopping your own wardrobe" below). The brainstorm's notes are private; only its decisions are recorded
here.

## Scope

v2 is a clean rewrite. It ports only the v1 behaviour that is useful, on a foundation later features build on. It does
not aim for v1 parity.

- **Why parity is dropped:** v1 never had real traction.
  - Production holds 20 real accounts, about 8 of them outside people, and 2 non-admin accounts were active in the last
    30 days.
  - Nobody ever paid.
  - Nobody followed, reported, blocked or referred anyone.
- **Where v1's money went:** $19.30 of its $24.68 AI spend went on Gemini redrawing product shots, for every piece
  at $0.034. v2 redraws only the pieces whose cut-out needs it, with Muse Image at $0.01, and keeps the real cut-out
  as the source (owner, 2026-10-30; see "Clean pictures" below).

Kept, in order:

1. Adding pieces from photos, a held-up camera and video, with real cut-outs (iteration 1).
2. The wardrobe inside ChatGPT and Claude, then go-live on styld.app (iteration 2).
3. Boards, public profiles and social, built on the preview (owner, 2026-10-30; see "Boards, profiles and social"
   below), trimmed on 2026-10-31. Going live on styld.app stays its own step.
4. Styld, the stylist in the app: a chat about the person's own wardrobe and looks, moved up from Later (owner,
   2026-10-31; see "Styld, the stylist in the app" below).
5. **Shopping your own wardrobe** (owner, 2026-10-31): wardrobe browsing like a shop, board templates that build
   outfits around real pieces, My Gallery and a first try-on. This is the next delivery; see the section below.
6. Billing: plans, credits, checkout and webhooks get their own planning round before go-live. Until then every paid
   action spends the daily allowance.
7. Later, each with its own planning round: recording video inside the app, outfit check's feedback on a worn photo
   (My Gallery already reads the pieces in one), wardrobe analysis and shop suggestions.

Parked (not built unless real demand appears):

- the Slovenian shop catalog and its shop directory;
- fit badges ("Goes with 4 of yours", "You own 2 like these");
- referrals, the daily wheel, the calendar and v1's onboarding funnels;
- favourites and archive for pieces (favourite outfit photos are kept, in My Gallery);
- Jev outfit ideas, which were on in production but unused.

Not porting: guest accounts and the free wardrobe cap (owner, 2026-10-28).

Deleted on 2026-10-31 (owner): the wishlist (a "Before you buy" board replaces it), showing the whole wardrobe on a
public profile, and mood boards of generated pictures (a mood board is now made from the person's own pieces).

## Shopping your own wardrobe (owner, 2026-10-31)

Styld should make people enjoy and use the clothes they already own: find a piece as easily as in a shop, remember
the outfits they felt good in, and build new combinations around real pieces. The AI does specific jobs a person
asked for, and everything it proposes stays editable. It never invents a garment for a practical outfit; when the
wardrobe cannot make one, it says what is missing. The private styling workflow comes first; public features wait
until it is proven useful.

**Navigation.** Four tabs: Home, Ask, Wardrobe, Boards. Wardrobe holds Pieces, Looks, Gallery and Try-ons. Explore
leaves the tab bar and stays reachable from a link on Home, from Ask's search and from the landing. Home keeps today's
outfit (Spin and Wear this), adds "Wear it again" (a favourite outfit photo), and keeps "Pick up where you left off"
and "From people you follow".

**The wardrobe like a shop.**

- Garment types are Styld's own, predefined, in three groups, as shops sort them. Sleeve length is not a category.
  There are no custom categories.
  - Clothing: Tops & T-shirts, Shirts & blouses, Bodysuits, Knitwear, Hoodies & sweatshirts, Blazers, Jackets,
    Coats, Gilets, Dresses, Jumpsuits, Jeans, Trousers, Shorts, Skirts, Sportswear, Swimwear, Loungewear & nightwear.
  - Shoes: Trainers, Boots, Heels, Flats, Sandals.
  - Accessories: Bags, Belts, Scarves, Hats, Jewellery, Sunglasses & glasses.
- Where a piece sits in an outfit (top, bottom, one-piece, layer, shoes, accessory) follows from its type and is never
  shown.
- Clef suggests a season (warm, cold or all year), occasions (casual, smart, formal, sport, lounge) and a pattern
  (plain, striped, checked, printed) when a piece is added, and once for every existing piece. The person can change
  them. Brand and shop link are optional.
- Browsing: group tabs, then type chips, then a dense grid (three across on a phone); a filter sheet for colour,
  season, occasion and brand.
- A piece's page shows the front and the back, lets the person add or replace the back, and offers "Create board"
  (the "One item, many outfits" template with this piece), "In your photos" and "In your looks". Shops' "Style with"
  is deliberately not on the page.

**Boards and templates.** One board concept. A new board starts blank or from a template, and every template keeps
the pins and the free collage:

- **One item, many outfits:** one piece is the anchor; Styld builds outfits around it from the person's wardrobe.
- **Before you buy:** the first step asks for a screenshot, a photo or a shop link of something the person is
  considering. Styld cuts it out (1 credit; when several garments show, the person taps one) and builds outfits
  around it, to answer "can I make three or four outfits with this?". It stays a candidate and never becomes a piece
  until the person says "I bought it". "Style with mine" on someone's public piece starts such a board with it,
  credited; buying it then asks for the person's own photo, so another person's picture never enters their wardrobe.
- **Travel:** destination, dates and activities (city, beach, hiking, work, evenings out). Styld fetches the forecast,
  or the usual weather for those dates, and the person can correct it. Styld then plans a small set of pieces and one
  outfit per day, up to seven, showing how often each piece is reused (1 credit).
- On a template board the anchor sits on top; the current proposal lies below it as a flat-lay with Shuffle, Keep,
  a lock on each piece and "From wardrobe"; kept outfits follow as cards with "Add another". A kept outfit is a look,
  pinned on the board and listed under Wardrobe › Looks; a look on a "Before you buy" board includes the candidate.
- Any board exports as a picture made on the device: the anchor and its kept outfits, or a blank board's collage.
- "Make a mood board" turns one sentence into a board of the person's own pieces, pinned and laid out (1 credit).
  Generated pictures stay only as small decorative stickers, marked Generated (1 credit each).

**The outfit engine is an experiment.** The owner decides between two ways of making an outfit from data, so the
board offers both and records each:

- **Fast:** rules build candidate outfits (the anchor and locks always in, one piece per place, at most one loud
  colour, season and occasion fitting), and Clef ranks them by looking at the pieces' pictures with the board's
  purpose.
- **Thinking:** a text model proposes candidates from the pieces' types and attributes and the board's purpose; the
  rules check them and Clef ranks them.
- Shuffle shows the next best candidate, keeping the anchor, the locks and the outfits already kept. Each new template
  board starts on Fast or Thinking in turn, and the switch is always visible; Home's Spin uses Fast.
- Every outfit made records its mode, time, cost and whether it was kept, and `tools/ai-usage-report.ts` reports the
  keep rate per mode. The first readout is the owner's rating of about 60 outfits from their own wardrobe, before
  the templates are built on the engine.

**My Gallery.** The person's own outfit photos, the ones they felt good in. It is optional, private, and holds no
generated pictures and no one else's photos.

- Styld finds the garments in a photo (1 credit) and matches them to the person's pieces. The person confirms or
  corrects each match; a garment with no match can be added to the wardrobe through the review tray, never as a
  silent duplicate.
- A confirmed photo shows on each of its pieces' pages. "Wear it again" saves its pieces as a look; "Add to board"
  pins the photo with that look; "Cut out the outfit" turns the person in the photo into a picture for the collage.
- Favourite photos and their pieces are clues for the outfit engine and for Styld.
- Outfit photos are never public in this delivery. On a public board they are held back from visitors.

**Try-on.** A quality test comes first: Meta Muse image edits against Pruna's try-on model on Workers AI, on the
owner's own photos (another person's only with their explicit consent), for at most $5. The owner then decides
whether try-on ships, with which provider and at what price.

- If it ships: a default full-body photo of the person, chosen from My Gallery or taken new, remembered and
  deletable. Try on from a look, a kept outfit or a "Before you buy" board. Results go to Wardrobe › Try-ons, are
  marked Generated, are held back from visitors and reach a board only when the person adds them.
- **Privacy exception (owner, 2026-10-31):** try-on may send the person's own photo to the try-on provider. It never
  sends anyone else's photo; a screenshot of someone else contributes only the garment's cut-out. Every other rule
  stays: a picture where a face may show (Clef ≥ 0.3) is never sent to Muse for a clean picture or a redraw, no
  generated picture uses a real person's likeness, and original photos never leave Styld except for this try-on.

**Credits** (daily allowance 100):

| Action                                                                          | Credits                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------- |
| A photo, also a back photo, an outfit photo's analysis or a candidate's cut-out | 1                                           |
| A video, per started half-minute                                                | 5                                           |
| Redrawing a clean picture                                                       | 1                                           |
| A turn on a hanger                                                              | 5                                           |
| A message to Styld                                                              | 1                                           |
| A mood board, a sticker, a trip plan                                            | 1 each                                      |
| Make an outfit, Shuffle, Keep, Spin, Style with mine, Cut out the outfit        | free; Thinking at most 50 a day per account |
| Try-on                                                                          | set by the owner after the quality test     |

**Order:** clean-ups (the deletions above, the four tabs, mood boards from pieces), garment types and browsing, the
outfit engine and its first readout, the templates with export, "Before you buy", travel, My Gallery, the try-on
quality test and, on the owner's go, try-on. Each step is deployed to the preview and read back.

**Provider notes:** Open-Meteo's free API is for non-commercial use; going live needs its paid plan or another
provider. Pruna's try-on model is a third-party model on Workers AI whose data terms are not published; the quality
test records what is known before anything ships.

## Styld, the stylist in the app (owner, 2026-10-31)

The owner asked to bring v1's AI features into v2, starting with the chat, with few features and a simple UI.

- **Styld** answers at `/ask/stylist`, reached from Ask. It knows the person's pieces and looks through the same tools
  the assistants in ChatGPT and Claude use: it searches and reads them, shows pieces in its reply, and saves a look
  when asked. ChatGPT and Claude stay a way in for those who use them.
- **Price:** a message costs 1 credit from the daily allowance; it comes back when no reply comes.
- **Not yet:** pictures in or out of the chat, shop suggestions, try-on, a wardrobe report, renaming or deleting chats.
  The model (DeepSeek V4.1 Flash on Workers AI for now) and the price are the owner's to confirm.

## Clean pictures, the turn and video scans (owner, 2026-10-30)

The owner's test on the preview showed that real cut-outs of clothes held up or worn look poor: finger dents, holes
where hands or hair were, droop. A cut-out keeps only the pixels the camera saw. Spikes (STATUS, 30 October) showed that
an image model redrawing the garment from its cut-out gives a clean product picture.

- **Clean pictures:** after a keep, Clef judges the cut-out: every piece is redrawn, even one already clean (owner,
  2026-10-31), a retake asked for when it is only a fragment, and the photo kept when a face may show. Muse Image (Meta) draws the picture by default; Gemini 3.1
  Flash Lite Image, v1's model, can replace it by configuration. Clef checks the drawing against the cut-out: shown
  when it matches, offered for the person to choose when unsure, dropped when it does not. The first clean picture
  is free; a redraw, with an optional hint, costs 1 credit. Existing pieces can be given clean pictures too.
- **The turn:** on request, the clean picture on a wooden hanger turns a quarter-turn (Veo 3.1 Lite), for 5 credits.
- **Video scans:** filming pieces one by one, hand-held, is the main way to add many pieces; a garment seen in several
  parts of a video becomes one card.
- Generated pictures and turns are presentation assets beside the real photo, never a replacement for it.

## Gallery 2 and boards (owner, 2026-10-30)

The owner chose the Gallery 2 redesign (`docs/design/gallery-2/`) and moved boards up from Later. Both were built in
the overnight run of 2026-10-30, next to the iterations below. Gallery 2 was first taken for the person's own
wardrobe only:

- the navigation: Home, Wardrobe, Ask, Boards;
- Home's table: Spin and Wear this, with "Pick up where you left off";
- Wardrobe with Pieces and Looks;
- Ask: search your wardrobe, the hand-off to the assistants, and the + sheet into capture;
- boards.

Explore and other people came with "Boards, profiles and social" below. Fit badges stay parked. Since 2026-10-31 the
navigation is Home, Ask, Wardrobe, Boards again (see "Shopping your own wardrobe").

**Boards** are the table, built in Foldkit itself with no canvas library: pieces, text labels and your own pictures,
moved, pinched, turned, layered and undone, saved whole with a version, and savable as a look.

- **Why not a library:** the spike in `docs/design/canvas-spike/` (v1 repository era, 2026-10-30) did this in about
  1,200 lines and kept 60 fps with 50 pieces. That replaced the earlier plan of an existing library (tldraw out over
  its licence; Excalidraw, Konva or Fabric through `Mount`).
- **Next:** the pins grid, MCP tools for boards and sharing, in "Boards, profiles and social" below.

## Boards, profiles and social (owner, 2026-10-30)

Planned with the owner on 2026-10-30, once Gallery 2 was on the preview. It brings the public profile forward and
un-parks the feed, follow and share links, with the safety work public content needs. All of it is built and accepted
on the workers.dev preview; going live on styld.app stays its own step. The design is the Gallery 2 prototype
(`docs/design/gallery-2/`: `board`, `boards`, `person`, `explore`, `pin`, `wishlist` and `ask-desktop`). The owner
trimmed it on 2026-10-31: the wishlist, the profile's Pieces tab and generated mood boards are deleted, and Explore
leaves the tab bar.

**Boards**

- A board is a scrolling grid of pins with one collage on top. Today's table editor becomes the collage.
- Pins are your pieces, your looks, your pictures and other people's public pieces, credited. Text labels live only
  on the collage.
- New pins come first; there is no reordering, no captions and no comments. A board's cover is its collage, or else
  its first four pins.

**Public and private**

- Everything is private by default. Public means on your profile, in Explore and feeds, and shareable by link, with a
  link preview.
- A public profile at `/@handle`: a name, the handle, an optional city, a short bio and an initials avatar, with
  Boards and Looks tabs; looks are shared one at a time. Publishing never shows the whole wardrobe (owner,
  2026-10-31): a piece is public only while it is on a public board or a shared look.
- Original photos and pieces still in the review tray are never public. Someone else's piece on your board shows only
  while its owner keeps it public.

**Moderation, decided by a model**

- Nothing reaches anyone else until an automatic check passes: Clef for pictures, a Workers AI text model for words.
- A pass is public everywhere. An unsure answer stays on the profile and its link, but out of Explore, feeds and
  search. A fail is hidden from others, and its owner sees why.
- A report runs the check again with the reporter's reason, and three reporters hide the item. A reported profile only
  drops out of discovery.
- There is no human review queue. Admins, an email allowlist, have MCP tools to hide or restore anything, to feature
  boards and people, and to read reports and check results.

**People**

- Save is one tap into Saved; "Add to a board" and the board editor's tray go on from there. A saved board is a
  bookmark of the original.
- Follow is one-way and needs no approval. Nobody sees anyone else's follows, followers or counts. Home shows "From
  people you follow", newest first.
- Blocking hides two people from each other and removes their follows; the blocked person is never told.
- There are no notifications.

**Explore and search**

- Explore opens on Edits from Styld (the house account, `@styld`, with its own wardrobe and generated pictures) and on
  boards and people the admins feature. Below them come any public board and person that passed the check, newest
  first, by mood.
- Moods come from a fixed list. The publish check suggests up to three, and the owner can change them.
- Ask searches the wardrobe on the device as today, plus people and public boards on the server, with a "people I
  follow" filter. Questions go to the assistants. There are no embeddings.
- Explore is reached from a link on Home, from Ask's search and from the landing (owner, 2026-10-31; it was a tab
  until then).

**Links**

- Add from a link, for clothes the person owns: a product page becomes a piece through the review tray (directly when
  an assistant adds it). When a shop refuses the page, Styld asks for a photo or a screenshot.
- The wishlist was deleted on 2026-10-31 (owner): something the person is only considering goes on a "Before you buy"
  board and never becomes a piece by itself.

**Generated pictures**

- Generated pictures are small decorative stickers with a transparent background, 1 credit each (owner, 2026-10-31).
  Prompts can be creative and can use the board's pieces as references, but never a real person's likeness. Stickers
  are marked Generated, checked like any picture and can be shared.
- "Make a mood board": from one sentence, Styld picks the person's own pieces, pins them and lays out the collage
  (1 credit). Until 2026-10-31 it generated two to four pictures instead.

**In ChatGPT and Claude**

- Assistants can do whatever the person asks: boards, pins, the collage, pictures, mood boards, the profile,
  publishing, saves, follows and search. A board view draws the board inside the host.
- Anything other people wrote is data for the assistant, never instructions.

**Order:** pins and the collage, then MCP for boards, then profiles, checks and public pages, then saves, follows and
the feed, then Explore and search, then the wishlist and links, then generated pictures and mood boards.

## Iteration 1: adding pieces from photos, the camera and video

Iterations 1 and 2 are built together in the run of 2026-10-29, with video import added (owner).

**Capture**

- **The phone's own picker:** up to 30 photos at once, from the camera or the library.
- **"Hold it up" camera:**
  - The phone is propped up on the selfie camera; the back camera is one switch away.
  - The person holds up one garment after another.
  - The phone notices a change followed by about a second of stillness. It then sends a small frame to Clef-flash,
    which says whether one garment is being held up, whether it is the front or the back, and whether it is the same
    garment as the last shot.
  - Only a "held up" answer fires the shutter, with a flash and haptic feedback. A shutter button always works.
  - A back shot of the same garment becomes that piece's back photo.
- **Video import:**
  - A clip of up to 60 s from the phone's library, counted as 10 credits.
  - The browser samples stills from it and uploads them with the video.
  - Meta SAM 3.1 tracks every garment through the video.
  - The best sampled still per garment is cut out with that garment's mask, ranked on sharpness, size, contact with
    other garments and the frame edge.
  - Recording inside the app comes next.

**Processing each photo**

1. **Route:** Cloudflare Clef-flash answers "one garment or several?".
2. **Cut out:**
   - One garment goes to Cloudflare Images background removal (`segment: "foreground"` through the Images binding).
   - Several garments, or an unsure answer, go to Meta SAM 3.1, which returns one mask per garment.
3. **Suggest:** Clef-flash suggests each piece's garment type, season, occasions and pattern (since 2026-10-31; a
   category and a sleeve-length shelf until then). A confident answer is pre-filled; an unsure one is left for the
   person.
4. **Colours:** Clef-flash also suggests a main colour and an optional second one from the 13 swatches.

Every photo and video still is first re-encoded through Images (EXIF and location removed, orientation applied), and
only that copy reaches a provider.

**Rules for the result**

- **The real photo is the source:** the real cut-out, or the original photo, is always kept and one tap away. A
  piece may show a clean picture an image model drew from it, always marked as such (owner, 2026-10-30, replacing
  "real pixels only"; see "Clean pictures" below).
- **Originals are kept:** the original photo stays private, next to the cut-out, so a better model can process it again
  later.
- **Review first:** every result waits in a "To review" tray. The person keeps it, discards it, or keeps the original
  photo instead. Only a person turns a detection into a piece.
- **Assistant adds skip the tray:** pieces added by ChatGPT or Claude become pieces at once, because the person asked
  for them in the chat.
- **Garment types** are Styld's own, in the three groups shops use (owner, 2026-10-31; see "Shopping your own
  wardrobe"). They replaced six categories with sleeve-length shelves. Underwear waits until someone asks.

**Cost and experiments**

- **Free with a cap:** about 100 photos per account per day.
- **Metering:** every AI call is reserved before it runs, then settled or refunded, in the usage ledger (Domain owns
  usage reservations). Billing plugs in where the cap sits.
- **One provider per job kind,** set in server config. Switching it on the preview and comparing keep rates is the
  experiment.
- **Analytics:** every provider call (provider, model, units, estimated cost, time taken, outcome) and every keep or
  discard is written to Cloudflare Analytics Engine, beside the existing traces.
- **No admin page** (owner, 2026-10-29): spans, Workers Logs and Analytics Engine carry the numbers, and
  `tools/ai-usage-report.ts` prints cost per provider and per day and keep rates.

**Provider probe, 2026-10-29**

A throwaway Worker in the v2 account was deleted after the run. It used synthetic images only: the spike's drawn garments
and frames of its Grok-generated ten-garment rail video.

- **Meta from a Worker works directly.** The Worker lists all nine Meta models, `sam-3.1` included, so no relay is
  needed. SAM calls took 1.4–3.6 s.
- **Cloudflare background removal works through the Images binding.**
  - It returns a transparent PNG in 1.0–4.9 s.
  - On the drawn garments: IoU 0.9995 for the shirt; 0.95 for the tee, which kept the background in its neck hole;
    0.86 for the dress, which kept the gap between the straps.
  - Scene photos come back as everything salient (hands, rail, bag), as expected.
- **SAM splits garments.**
  - One "clothing" call found all 10 garments on the rail, with partly hidden ones cut where they are hidden.
  - On the single drawn garments it scored IoU 0.99 and 0.985, better than Cloudflare on enclosed holes, but its masks
    are one-bit with hard edges.
- **Clef-flash routes and categorises well.**
  - It said "one" or "several" correctly for all 7 images. The scene photo came back unsure (0.39), so it would go to
    SAM.
  - Categories were right for all 5 whole images and plausible for all 10 SAM crops (a cardigan as a top at 0.62).
  - It took 0.5–1.4 s and about 1,050–1,360 input tokens, roughly $0.00005 a call.
- **What follows:** which provider handles single garments is decided on real, consented photos through the config
  switch; a hybrid (Cloudflare's soft edges inside SAM's mask) is one experiment.
- **Still open:** the auto-shooting camera on iPhone Safari.

**Provider facts** (read 2026-10-29; recheck before budgeting)

- **Cloudflare background removal (BiRefNet):**
  - $0.50 per 1,000 unique transformations, with 5,000 a month free.
  - One combined foreground, with soft alpha and no per-object masks.
  - Inputs up to 20 MB through the binding.
- **Meta SAM 3.1:**
  - $2.50 per 1,000 images, or $0.20 per 1,000 video frames (minimum 50 frames).
  - One concept per call; it returns every matching instance with a box and a one-bit or lossless mask, but no label.
  - Standard Services content is not used for training.
- **Clef-flash:**
  - $0.038 per million input tokens, with no output charge. An image is 64–1,024 tokens.
  - Answers choice questions with a probability for each option.

## Iteration 2: the wardrobe in ChatGPT and Claude, then go-live

**In the assistants**

- **Standard MCP Apps (ChatGPT and Claude):**
  - a fullscreen wardrobe view of the cut-outs;
  - inline cards when the assistant shows pieces or makes a look.
- **OpenAI MCP Extensions (ChatGPT only):**
  - a sidebar entry point that opens the wardrobe view;
  - composer @-mentions that search the person's pieces.
- Thumbnail-picker forms wait.
- **How the views are built:** a small Foldkit program built into one self-contained HTML file. The extension metadata
  is written by hand, because `@openai/mcp-extensions` 0.2.1 needs MCP SDK 1.x and pins zod. Foldkit's single-file
  build is proved first.

**Looks**

- Only the assistant makes them, from the person's pieces, on request.
- The web app lists them, opens one and deletes one; there is no builder page.

**Go-live**

- Privacy and terms pages.
- A reviewer account, using the server-side password strategy.
- The ChatGPT directory submission.
- v2 replaces v1 on styld.app, with the owner's explicit go at the time.
- **v1 wardrobes are imported at the switch:**
  - **Who:** all real v1 accounts. Guests, shop accounts and test addresses are skipped.
  - **What:** each piece with its category, colours, the image the person saw, and the original photo. Pieces land as
    ready, matched by email. Boards, chats and try-ons are not imported.
  - **Where:** only into v2 production, never into the public preview.

## Iteration 3: billing

- **Try-on** moved into "Shopping your own wardrobe" (owner, 2026-10-31): a quality test first, far fewer buttons than
  v1, the provider chosen through the iteration 1 switch and its cost tracking.
- **Billing:** its model (membership, credits or both), price and payment provider get their own planning round
  before go-live. Until then every paid action spends the daily allowance.

## Later

- **Recording video in the app** (import from the library comes in iteration 1).
- **Outfit check** works from a photo of you wearing the clothes and gives feedback. My Gallery already finds the
  pieces in such a photo and offers missing ones for the wardrobe through the review tray; the feedback comes later.
