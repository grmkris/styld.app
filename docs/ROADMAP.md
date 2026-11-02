# Roadmap

What remains of the owner's scope on 2 November 2026. Everything built so far, and the decisions and history behind
it (the 29 October scope, iterations 1–2, Gallery 2, boards and social, clean pictures, Styld, "Shopping your own
wardrobe" M1–M3 and M7), is in `docs/archive/ROADMAP-built-2026-11-02.md`; what is live is `docs/STATUS.md`.

## Direction

v2 is a clean rewrite that ports only the v1 behaviour worth keeping; v1 parity is not the goal (v1 had about eight
outside users and no payments). Styld should make people enjoy and use the clothes they already own: find a piece as
easily as in a shop, remember the outfits they felt good in, and build new combinations around real pieces. The AI
does specific jobs a person asked for, everything it proposes stays editable, and it never invents a garment for a
practical outfit. The private styling workflow comes before public features.

## Now

1. **Cleanup C8:** review rounds, fixes, the full gate, deploy and read back every `docs/DELIVERY.md` row.
2. **Testing:** the owner and a second tester use the rebuilt preview (`docs/TESTING-GUIDE.md`); their findings
   decide the order of the frozen milestones below.

## Frozen until testing starts (31 October plan)

Their decisions stand as recorded in the archived roadmap › Shopping your own wardrobe; the order among them is
decided from the testers' findings. M4 waits for owner gate 1 (the owner's rating of about 60 outfits, Fast against
Thinking).

- **M4 — Template boards and export.** A new board starts blank or from a template, and every template keeps the pins
  and the collage. **One item, many outfits:** one piece is the anchor; the board shows the current proposal as a
  flat-lay with Shuffle, Keep, a lock per piece and "From wardrobe", and kept outfits as cards with "Add another"; a
  kept outfit is a look pinned on the board. The piece page gains "Create board". Any board exports as a picture
  drawn on the device.
- **M5 — Before you buy.** A screenshot, photo or shop link of something the person is considering is cut out
  (1 credit; the person taps one garment when several show) and outfits are built around it. It stays a candidate
  (own table, keys and owner-only images) until "I bought it", which asks for the person's own photo. "Style with
  mine" on someone's public piece starts such a board, credited. A look may hold one candidate and cannot be shared.
- **M6 — Travel.** Destination, dates and activities; the forecast or usual weather, correctable; a small set of
  pieces and one outfit per day, up to seven, showing reuse (1 credit). Open-Meteo's free API is non-commercial: going
  live needs its paid plan or another provider.
- **M8 — Try-on quality test.** Meta Muse image edits against Pruna's try-on model on Workers AI, on the owner's own
  photos (another person's only with explicit consent), for at most $5. Needs 2–3 full-body photos from the owner.
  Then the owner decides go or no-go, provider and price.
- **M9 — Try-on** (only on the owner's go): a remembered, deletable default full-body photo; try on from a look, a kept
  outfit or a Before you buy board; results under Wardrobe › Try-ons, marked Generated, held back from visitors.
  **Privacy exception (owner, 2026-10-31):** try-on may send the person's own photo to the try-on provider, never
  anyone else's; every other picture rule stays.
- **M10 — Review rounds** after the milestones built.

Also kept from that plan, not built: favourites in My Gallery as clues for the outfit engine and Styld; link import
reading a product's brand.

## Kept, later

- **Go-live on styld.app:** privacy and terms pages, a reviewer account (server-side password strategy), the ChatGPT
  directory submission, and the cutover with the owner's explicit go. All real v1 accounts' wardrobes are imported
  into v2 production by the operator importer (guests, shop accounts and test addresses skipped).
- **Billing:** model (membership, credits or both), price and payment provider get their own planning round before
  go-live. Until then every paid action spends the daily allowance (100).
- **Recording video in the app** (import from the library is built).
- **Outfit check:** feedback on a photo of the person wearing the clothes (My Gallery already finds the pieces).
- **Wardrobe analysis and shop suggestions.**
- **Social leftovers:** a composed link-preview image, follows and blocked lists on the website, a "people I follow"
  search filter.
- **Styld:** pictures in or out of the chat, renaming or deleting chats; the model and price are the owner's to
  confirm.
- **Sign in with Google** (an owner topic from the screen review).

## Parked (not built unless real demand appears)

- the Slovenian shop catalog and its shop directory;
- fit badges ("Goes with 4 of yours", "You own 2 like these");
- referrals, the daily wheel, the calendar and v1's onboarding funnels;
- favourites and archive for pieces (favourite outfit photos are kept, in My Gallery);
- Jev outfit ideas.

## Not porting

Guest accounts and the free wardrobe cap; the wishlist (a Before you buy board replaces it); showing the whole wardrobe
on a public profile; mood boards of generated pictures (a mood board is made from the person's own pieces); v1's admin
pages (Analytics Engine and `tools/ai-usage-report.ts` carry the numbers).

## Credits

Daily allowance 100 per account (`packages/protocol/src/Prices.ts`): a photo or a back photo 1, a video 5 per started
half-minute, a redraw 1, a turn 5, a message to Styld 1, a sticker 1, a mood board 1, a My Gallery photo 1. Making an
outfit, Shuffle, Keep and Spin are free; Thinking at most 50 a day per account. Frozen milestones add: a candidate's
cut-out 1, a trip plan 1, try-on priced after its test.
