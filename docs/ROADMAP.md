# Roadmap

Decided with the owner on 2026-10-29, after the v1 feature inventory (`docs/migration/v1-features.md`), v1's
production usage (`docs/migration/v1-usage-2026-10-29.md`) and the Meta/segmentation research in
`~/code/meta-hackathon/grok-meta-hackathon-spike/docs/research/` (`styld-v2-wardrobe-video-motion-handoff-2026-10-29.md`,
commit `1461a78`).

## Scope

v2 is a clean rewrite. It ports only the v1 behaviour that is useful, on a foundation later features build on. It does
not aim for v1 parity.

- **Why parity is dropped:** v1 never had real traction.
  - Production holds 20 real accounts, about 8 of them outside people, and 2 non-admin accounts were active in the last
    30 days.
  - Nobody ever paid.
  - Nobody followed, reported, blocked or referred anyone.
- **Where v1's money went:** $19.30 of its $24.68 AI spend went on Gemini redrawing product shots, which v2 replaces
  with real cut-outs.

Kept, in order:

1. Adding pieces from photos with real cut-outs (iteration 1).
2. The wardrobe inside ChatGPT and Claude, then go-live on styld.app (iteration 2).
3. Virtual try-on and billing (iteration 3).
4. Later, each with its own planning round:
   - video capture, and outfit check (both extend the photo pipeline);
   - boards and collages;
   - a public profile to show off a wardrobe;
   - the web stylist chat.

Parked (not built unless real demand appears):

- the Slovenian shop catalog;
- the feed and follow, directories and share links, with the moderation and safety work that exists only for public
  content;
- referrals, the daily wheel, the calendar and v1's onboarding funnels;
- favourites and archive;
- Jev outfit ideas, which were on in production but unused;
- AI-redrawn product shots as a piece's main image.

Not porting: guest accounts and the free wardrobe cap (owner, 2026-10-28).

## Iteration 1: adding pieces from photos

**Capture**

- **The phone's own picker:** several photos at once, from the camera or the library.
- **A Styld camera for a propped-up phone:**
  - It notices a new garment in view and waits until the frame holds still for about a second.
  - Then it shoots, with a flash and a sound. A shutter button also works.
  - Stillness is found by comparing frames on the phone; no AI runs there.
  - Photos upload in the background while the person carries on.

**Processing each photo**

1. **Route:** Cloudflare Clef-flash answers "one garment or several?".
2. **Cut out:**
   - One garment goes to Cloudflare Images background removal (`segment: "foreground"` through the Images binding).
   - Several garments, or an unsure answer, go to Meta SAM 3.1, which returns one mask per garment.
3. **Suggest:** Clef-flash suggests each piece's category and subcategory. A confident answer is pre-filled; an unsure
   one is left for the person.
4. **Colours** are read from the cut-out's own pixels.

**Rules for the result**

- **Real pixels only:** the main image is always the real cut-out. If the cut-out is poor, the piece keeps its original
  photo. Nothing is redrawn by AI.
- **Originals are kept:** the original photo stays private, next to the cut-out, so a better model can process it again
  later.
- **Review first:** every result waits in a "To review" tray. The person keeps it, discards it, or keeps the original
  photo instead. Only a person turns a detection into a piece.
- **Assistant adds skip the tray:** pieces added by ChatGPT or Claude become pieces at once, because the person asked
  for them in the chat.
- **Categories** are Styld's own six, since shops follow no shared standard:
  - jumpsuits go under "Dresses & one-pieces";
  - swimwear, underwear and sleepwear wait until someone asks.

**Cost and experiments**

- **Free with a cap:** about 100 photos per account per day.
- **Metering:** every AI call is reserved before it runs, then settled or refunded, in the usage ledger (Domain owns
  usage reservations). Billing plugs in where the cap sits.
- **One provider per job kind,** set in server config. Switching it on the preview and comparing keep rates is the
  experiment.
- **Analytics:** every provider call (provider, model, units, estimated cost, time taken, outcome) and every keep or
  discard is written to Cloudflare Analytics Engine, beside the existing traces.
- **Admin page:** one minimal page, open to an email allowlist, shows cost per provider and per day, keep rate and
  failures.

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

## Iteration 3: try-on and billing

- **Try-on:** far fewer buttons than v1. The provider is chosen through the iteration 1 switch and its cost tracking.
- **Billing** arrives with it, because try-on (about $0.03–0.05 an image) is the first feature whose cost matters. Its
  model (membership, credits or both), price and payment provider get their own planning round.

## Later

- **Video capture** uses SAM's video tracking.
- **Outfit check** works from a photo of you wearing the clothes: it gives feedback and offers the pieces for the
  wardrobe through the same review tray.
- **Boards and collages** use an existing canvas library, picked at that iteration. tldraw is out: it needs a paid
  licence with no published price, and its domain-locked key would treat assistant iframes as unlicensed. Excalidraw
  (MIT, React) and framework-free Konva or Fabric are the candidates. Foldkit hosts them through `Mount`.
- **A public profile,** and the safety it needs.
- **The web stylist chat.**
