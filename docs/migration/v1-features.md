# v1 feature inventory

This is every user-facing and operator-facing behaviour of Styld v1 at the frozen baseline, stylelab `dddf9d44`, with
what v2 has of it today. It was read on 2026-10-29 from a `git archive` export of that commit; v1's repository was not
touched. `v1-inventory.json` beside this file lists v1's files; this file lists what those files do.

## How to read it

- **Feature ids** (`WR-03`) are stable, so `DELIVERY.md` rows and tests can cite them.
- **v1 status:**
  - `shipped`: working on dev.styld.app. Production lagged: the dev → main launch PR #93 was unmerged at the baseline.
  - `partial`: built but incomplete.
  - `API only`: a procedure or MCP tool with no web screen.
  - `flag`: behind an environment flag.
  - `absent`: not in v1, though docs or copy imply it.
- **v2 status:**
  - `done`: built, with acceptance evidence recorded in `DELIVERY.md`.
  - `partial`: built in part; the line says what is missing.
  - `pending`: not started.
  - `not porting`: the owner decided against it, recorded in `STATUS.md`.
  - `new in v2`: v1 did not have it.
- **Paths** are relative to v1's repository root. Short forms: `web/` = `apps/web/src/`, `api/` = `packages/api/src/`,
  `shared/` = `packages/shared/src/`, `db/` = `packages/db/src/schema/`. Procedures are written `router.procedure`.
- A feature is at parity only when `DELIVERY.md` carries its acceptance evidence. This file records scope, not proof.

## Owner decisions, 2026-10-29

`docs/ROADMAP.md` records what v2 keeps, in what order, and what is parked. In short:

- **Kept:** wardrobe capture with real cut-outs, the wardrobe in ChatGPT and Claude, looks made by the assistant, try-on
  and billing. Later: video, outfit check, boards and collages, a public profile and the web stylist chat.
- **Parked:** the shop catalog, feed and follow, share links, referrals, the wheel, the calendar, onboarding funnels,
  favourites, archive, Jev and AI-redrawn product shots.

The v2 column below still records what exists. `docs/migration/v1-usage-2026-10-29.md` has the production numbers
behind these decisions.

## Rules that run through v1

- **One plan, "member":** $19.99 a month or $199 a year, 500 credits a month (`shared/subscription-plans.ts`).
- **Hard paywall:** no Styld AI of any kind without membership. Free accounts get 50 wardrobe pieces and 500 MB.
- **Free without a plan:** boards, collages, saves, follows, looks, calendar and manual adds.
- **Credit packs:** 250 for $9.99, 750 for $24.99, 2500 for $69.99. Purchased credits never expire.

| Credits | Action                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------- |
| 5       | try-on, product shot / item extraction (per image), look render (`INSPIRATION`)                                     |
| 3       | stylist turn                                                                                                        |
| 2       | outfit check                                                                                                        |
| 1       | image analysis, outfit generation, outfit ideas (flat), body type, scan (per photo)                                 |
| 0       | style read, titles, onboarding, moderation, link import, catalog classification and embeddings; plan still required |

- **Models** (`packages/ai/src/ai-config.ts`):
  - `gemini-3.7-flash`: stylist and outfit-check analysis.
  - `gemini-3.6-flash`, minimal thinking: other structured work.
  - `gemini-3.1-flash-lite-image`: try-on, product shots, look renders.
  - `gemini-embedding-001` at 1536 dimensions: embeddings.
  - Overrides: `AI_LANGUAGE_MODEL` reroutes text features through LiteLLM (dev used Qwen); `TRY_ON_IMAGE_MODEL` can
    move try-on to Alibaba `wan2.7-image`.
- **Charging:** usage is charged before the work and refunded on failure, with idempotency keys. Paid MCP tools also
  need `maxCostCredits` and an idempotency key.

## Coverage at a glance

| Area       | v1 features | v2 done or new | v2 partial | v2 pending | not porting |
| ---------- | ----------- | -------------- | ---------- | ---------- | ----------- |
| identity   | 11          | 3              | 2          | 5          | 1           |
| onboarding | 5           | 0              | 0          | 5          | 0           |
| wardrobe   | 22          | 1              | 6          | 14         | 1           |
| scans      | 12          | 0              | 1          | 11         | 0           |
| studio     | 14          | 0              | 0          | 14         | 0           |
| outfits    | 13          | 0              | 0          | 13         | 0           |
| stylist    | 10          | 0              | 0          | 10         | 0           |
| catalog    | 11          | 0              | 0          | 11         | 0           |
| social     | 12          | 0              | 0          | 12         | 0           |
| safety     | 5           | 0              | 0          | 5          | 0           |
| billing    | 14          | 0              | 0          | 14         | 0           |
| mcp        | 15          | 3              | 5          | 7          | 0           |
| operations | 22          | 0              | 4          | 18         | 0           |
| experience | 9           | 1              | 5          | 3          | 0           |
| **total**  | **175**     | **8**          | **23**     | **142**    | **2**       |

---

## identity

**ID-01 Email code sign-in and sign-up** · v1 shipped · v2 done

- **What a person can do:** enter an email and receive a 6-digit code. An unknown email creates the account.
- **v1:**
  - The email also carries a link, `/login?otp=…&email=…`, that signs the person in.
  - Resend, and "use a different email".
  - The return path survives a fresh tab through the `styld_login_return` cookie (10 minutes).
  - Code length, expiry and attempts are Better Auth defaults. Shop placeholder addresses (`@shops.styld.invalid`)
    silently get no code. A new account's empty name becomes the email's local part.
  - Rate limit: 10 sign-ins per 15 minutes per IP.
  - Code: `web/components/auth/sign-in-flow.tsx`, Better Auth `emailOTP` in `packages/auth/src/auth-config.ts`.
- **v2:**
  - One code either signs in or creates the account: 6 digits, 5 minutes, 3 attempts, 30-second resend.
  - Requests are rate limited.
  - Evidence: native Chromium, plus real mail on the preview.
  - Not carried over: the sign-in link in the email, and return paths other than `/login/connect`.

**ID-02 Google sign-in with automatic linking** · v1 shipped (config) · v2 built (`94dc82d6`, `9b5e923a`), acceptance open

- **v1:**
  - "Continue with Google". A verified Google email links to the existing account with that email.
  - Shown only when `NEXT_PUBLIC_AUTH_GOOGLE=true` and both `GOOGLE_CLIENT_*` are set.
  - There is no manual link/unlink UI, and the live check was still an owner task.
- **v2:**
  - The owner decided (4 November 2026) to keep v1's linking: a verified Google address signs into the account of that
    address, or makes one. Built in `packages/auth/src/GoogleEntry.ts` over Yielded's `IdentityImports`, with v1's
    OAuth client and v1's callback path `/api/auth/callback/google`.
  - Open: unit and native runs, and a live sign-in on the preview once its callback is registered.

**ID-03 Password sign-in** · v1 shipped (limited) · v2 partial

- **v1:**
  - `/login?method=password` works only for accounts that already hold a password: seeds, tests, the MCP reviewer.
  - Sign-up with a password is closed. No reset or change UI; the `forget-password-otp` template is unused.
- **v2:** the password strategy exists server-side only, for fixtures and a future reviewer account. There is no web form.

**ID-04 Guest sessions merged into a real account** · v1 shipped · v2 not porting

- **v1, where guests start:** onboarding and landing-page capture create an anonymous session
  (`web/lib/anonymous-session.ts`).
- **v1, on linking:** the `onLinkAccount` hook moves media, merges collections and keeps one default model photo. It
  carries over the wizard and profile, unless the real account had finished onboarding.
- **v1, guest limits:** guests cannot open `(app)` pages and never get referrals or the welcome email.
- **v1, gaps:** abandoned guests are never cleaned up.
- **v2:** owner decision on 2026-10-28: no guest accounts.

**ID-05 Sessions and sign-out** · v1 shipped · v2 done

- **v1:**
  - Cookies are httpOnly, SameSite=Lax and Secure; session data is cached in the cookie for 5 minutes.
  - Stale duplicate cookies are repaired (`api/middleware/clear-stale-session-cookies.ts`).
  - Sign-out clears the query cache and resets PostHog.
  - No list of active sessions and no way to revoke one.
- **v2:** sign-out ends the session, and a replayed cookie is refused (native).

**ID-06 Account page `/account`** · v1 shipped · v2 partial

- **v1:**
  - Tabs: Account, Subscription, Models, Referrals.
  - Cards:
    - public profile link;
    - name and email (read-only);
    - style profile, where "Update my style profile" restarts onboarding;
    - connected agents (MC-12) and blocked accounts (SA-02);
    - language, stored in the `NEXT_LOCALE` cookie;
    - location and weather.
  - Rows: Admin (admins only), Help (replays the tour), Sign out.
  - Code: `web/app/(app)/account/account-content.tsx`.
- **v2:** shows who you are, then language, Sign out, "Use Styld in ChatGPT or Claude" (MC-13) and Delete account
  (ID-11). Missing: the style profile, connected agents, blocked accounts, location, help and admin rows, and the other
  tabs.

**ID-07 Profile row and onboarding status at sign-up** · v1 shipped · v2 pending

- **v1:** `user.create.after` inserts `user_profile` with `onboardingStatus: pending`, empty preferences and a "User
  joined" note. It also creates the referral code and attribution (OP-17) and sends the welcome email (ON-05).

**ID-08 Roles and admin access** · v1 shipped · v2 pending

- **v1:**
  - Roles are `user` and `admin`, from the Better Auth `admin` plugin.
  - `ADMIN_EMAILS` promotes accounts at every boot.
  - `adminProcedure` answers FORBIDDEN; `verifyAdmin` sends non-admins to `/dashboard`.
  - MCP calls always run with the `user` role.

**ID-09 Ban and unban** · v1 shipped · v2 pending

- **v1:**
  - An admin dialog takes a reason and an expiry: permanent, 1, 7 or 30 days.
  - Enforcement relies on plugin defaults: sign-in is blocked and sessions are revoked.
  - Logged to `admin_action` (OP-12).

**ID-10 Impersonation** · v1 shipped · v2 pending

- **v1:**
  - "Impersonate" from the user list or a user's detail page.
  - A banner with "Stop" shows on every page.
  - Analytics identity is not swapped while impersonating.

**ID-11 Account deletion** · v1 absent · v2 new in v2

- **v1:** no procedure, route or UI, although `/privacy` says "You may also delete your account".
- **v2:**
  - Delete account, with an in-page confirmation.
  - Access ends first: sessions and OAuth grants are revoked.
  - Pieces, uploads and receipts are deleted, and the R2 prefix is swept by a queued finish step.
  - Evidence: native and preview.

---

## onboarding

**ON-01 Flow engine** · v1 shipped · v2 pending

- **Routes:** `/onboarding?flow=` → `/onboarding/[step]` → `/onboarding/finish`.
- **Step types:** intro, choice, taste, account-creation, capture, subscribe, results. Each can have a `showWhen`
  condition, for example `_isAnonymous` or `_hasActiveSubscription`.
- **Code:** `onboardingWizard.*`; tables `onboarding_wizards` and `wizard_steps`; flows in
  `shared/onboarding-flows/*`.
- **Rules:**
  - Without a session, only a flow's first step opens.
  - Re-entering a finished wizard resets it, except `default-v5`.
  - Answers merge into `user_profile.preferences` and are protected from later AI inference.
  - Onboarding never blocks the app.
- **Note for v2:** with no guest accounts (ID-04), anonymous steps need a new design.

**ON-02 Default flow `default-v5`, taste first** · v1 shipped · v2 pending

- **Steps:** welcome → gender (skippable) → pick at least 3 of 24 public feed cards → create account → finish → home.
- **On completion:**
  - creates a private "First picks" board ("Prvi izbori"), pins the picks and follows each pick's author;
  - a progress receipt plus a 5-minute lock keep a retry from duplicating anything;
  - fails if that board was made public.
- **Code:** `api/features/onboarding-wizard/completion.ts`. Event: `taste_picks_saved`.

**ON-03 Feature funnels with paywall** · v1 shipped · v2 pending

- **Flows:** `try-on`, `outfit-check` and `wardrobe` run capture → account → subscribe → results; `stylist` runs
  account → `/chat`.
- **Steps:**
  - Capture works for guests.
  - Subscribe is a hard paywall that starts Dodo checkout; "Maybe later" finishes the wizard.
  - Results confirms the subscription and runs the paid feature.
- **Declined wardrobe paywall:** the photos become untagged manual pieces.
- **Legacy:** `default-v4` (quiz plus closet import) is still registered, and `rate-outfit` maps to `outfit-check`.

**ON-04 Style and body preferences** · v1 shipped · v2 pending

- **What it does:** onboarding answers (gender, style goal, body type, occasions, vibes) feed the stylist and are shown
  on the Account style-profile card.
- **Body type:** `bodyType.analyze` costs 1 credit.
- **Style read:** a free job after a scan derives the style profile (SC-09).

**ON-05 Welcome email** · v1 shipped · v2 pending

- **When:** sent once for every real account created by a request, OAuth included.
- **Never for:** guests, seeds, `/admin` paths or placeholder addresses.
- **Content:** language from `NEXT_LOCALE`; the button goes to `/dashboard`.
- **Failure:** a failed send never blocks sign-up. `DELIVERY.md` asks for it to be retry-safe in v2.

---

## wardrobe

**WR-01 Add a piece by hand** · v1 shipped · v2 done

- **v1:**
  - One photo plus a required category. Optional: up to 2 of the 13 colours, and a name of up to 120 characters.
  - No AI runs.
  - Allowed types only, 15 MB maximum. The same photo twice gives 409. The closet cap (WR-21) is checked first.
  - For members, an automatic product shot follows (SC-07).
  - Code: `web/components/wardrobe/add-piece-sheet.tsx`, then `media.getUploadUrl` → `media.confirmUpload` →
    `wardrobe.createManual`.
- **v2:**
  - Photo, category (required), then subcategory, up to 6 colours, and a name.
  - Uploads go through the Worker with signature-checked types (avif, gif, heic, heif, jpeg, png, webp; 15 MB) and
    one-time tokens.
  - The add is idempotent per `operationId`. The queue prepares the image through the `GarmentCutout` port, which keeps
    the original for now.
  - No duplicate-photo check, no cap (owner decision), no automatic product shot.

**WR-02 "I own this" and "Save to wishlist" from a shop piece** · v1 shipped · v2 pending

- **v1:**
  - Turns a catalog piece into an owned or wishlist piece, with category and colour taken from the catalog.
  - Free, and runs no AI; the cap still applies.
  - Idempotent through `media.metadata.catalogItemId`. Ownership only moves from wishlist to owned.
  - Code: `catalog.saveToWardrobe`, `api/features/catalog/catalog-save.ts`.

**WR-03 Add from a link, a board card or a pin** · v1 shipped · v2 pending

- **v1:**
  - `studio.importFromUrl`, `studio.addNodeToWardrobe` and `pins.addToWardrobe` all promote a card to a piece.
  - Adding is free. AI analysis (1 credit) runs only when the plan covers it.
  - The screenshot fallback is ST-08. Link imports: 30 per minute.

**WR-04 Import an uploaded image from the outfit builder** · v1 shipped · v2 pending

- **v1:** `tryOn.importToWardrobe`, 1 credit (`IMAGE_ANALYSIS`), source `try_on_import`.

**WR-05 Agent ingest** · v1 shipped · v2 partial

- **v1:**
  - `add_pieces`: free, up to 20 pieces, with attributes from the host's own vision.
  - `add_item_from_url`: source `agent`. `analyze: true` costs 1 credit.
  - Also `request_image_upload`, `own_this`, `scan_closet_photos` / `add_scanned_items`, `save_board_card`.
  - Stylist tools: `detectItems`, `extractItems`, `saveDetections`.
- **v2:**
  - `piece_add` takes an `imageUrl` or an `uploadId` and is idempotent per `operationId`.
  - The URL fetch: https on port 443, at most 3 checked redirects, an image type allowlist, 15 MB checked while
    streaming.
  - `upload_create` is built.
  - Missing: batch add, AI analysis, and the other ingest tools.

**WR-06 AI analysis and tagging (`analyze-image` job)** · v1 shipped · v2 pending

- **What it fills in:** category, ordered colours with hex, typed tags, name, formality, coverage and subcategory,
  plus the flags `isModelPhoto`, `hasMultipleItems` and `items[]` with bounding boxes. It also writes a 1536-d embedding.
- **Cost and failure:** 1 credit. After the last retry the piece is marked failed and the charge refunded.
- **Consistency:** the prompt reuses the person's existing tags.
- **Afterwards:** the piece joins its collection, the stylist's context cache is cleared, and an automatic shot is
  tried.
- **Code:** `api/workers/image-analyzer.worker.ts`, `packages/wardrobe/src/clothing-analyzer.ts`.
- **v2:** owner decision: no AI tagging in the first cut.

**WR-07 Retry a failed analysis** · v1 API only · v2 pending

- **v1:** `wardrobe.retryFailedItem` is free but needs a plan. No web caller.

**WR-08 Split a multi-garment photo** · v1 API only · v2 pending

- **v1:**
  - `wardrobe.getDetectedItemPreviews` and `splitItems` cost 5 credits per garment; unused credits are refunded.
  - The UI was removed; its strings remain.

**WR-09 Wardrobe gallery, search and filters** · v1 shipped · v2 partial

- **v1:**
  - Tabs: Pieces, Looks and Wishlist (`?tab=`).
  - Text search is ILIKE, with no semantic search.
  - Filters: category, colour, tag, subcategory chips, a cross-category "Sports" chip, and a filter drawer.
  - Select mode, and polling while pieces process.
  - Paging: 20 by default, 100 maximum. Facet counts come from `wardrobe.getTags`.
  - Code: `web/app/(app)/wardrobe/wardrobe-gallery.tsx`, `wardrobe.getItems`.
- **v2:**
  - The Pieces grid with category chips and counts, plus loading, empty, error and full states.
  - The MCP `piece_search` takes a query, category, colour, a limit of up to 50, and a cursor.
  - Missing on the web: text search, colour, tag and subcategory filters, tabs, select mode.

**WR-10 Reference lists** · v1 shipped · v2 partial

- **v1:** the public `wardrobe.listCategories`, `listColors`, `listTags`, `listTagTypes`.
- **v2:**
  - Categories, subcategories and the 13 colours are protocol schemas (`@styld/protocol` `Wardrobe.ts`), not endpoints.
  - Tags are missing.

**WR-11 Six categories with automatic subcategories** · v1 shipped · v2 partial

- **v1:**
  - The categories are top, bottom, dress, outerwear, shoes and accessory.
  - Built-in subcategories, plus "sport" inside each wearable category.
  - Without AI, the subcategory is derived from category, name, tags and formality.
  - `subcategory_source` records auto or user. A boot task backfills.
  - Code: `shared/wardrobe-subcategories.ts`.
- **v2:**
  - The same categories and subcategory lists. The person picks the subcategory; nothing derives it.

**WR-12 Custom subcategories ("Edit categories")** · v1 shipped · v2 pending

- **v1:**
  - Add, rename, merge, delete and reorder; move pieces between them.
  - Limits: up to 40, names up to 32 characters, moves of up to 100 pieces.
  - `deleteShelf` has no web caller.
  - Code: `wardrobe.manageSubcategories`, table `wardrobe_shelf`.

**WR-13 Edit a piece** · v1 shipped · v2 partial

- **v1:**
  - Name (120 characters), and private notes (1000) that the stylist reads.
  - Category, and up to 6 colours; the picker can sample from the photo.
  - Tags: up to 20 of 40 characters each, saved as type `style`.
  - Code: `web/components/wardrobe/item-editor/*`, `wardrobe.updateItem`.
- **v2:**
  - An edit sheet for name, notes, category, subcategory and colours (at most 6). The MCP tool is `piece_update`.
  - Missing: tags and colour sampling.

**WR-14 Extra photos, rotation, original vs product shot** · v1 shipped · v2 pending

- **v1:**
  - Up to 4 extra photos. Rotate by 90°, 180° or 270°.
  - Switch between the product shot and the original.
  - Rotation is blocked while a scan shot is pending.
  - Code: `wardrobe.addItemPhoto`, `removeItemPhoto`, `rotateItemImage`.

**WR-15 "Improve image" (product shot on demand)** · v1 shipped · v2 pending

- **v1:**
  - 5 credits, members only.
  - Eligibility rules: not on photos of a person, photos with several pieces, or pieces that already have a shot.
  - The MCP tool `generate_product_shot` takes up to 8 pieces.
  - The pipeline is SC-06.

**WR-16 Where a piece is used** · v1 shipped · v2 pending

- **v1:** the outfits, try-ons and collections that use a piece, and moving it between collections
  (`wardrobe.getItemUsages`, `collections.getEntityCollections`, `collections.moveEntities`).

**WR-17 Delete a piece, single or bulk** · v1 shipped · v2 partial

- **v1:**
  - Confirm, then cascade; media nothing else uses is removed.
  - Bulk delete and move from the bulk action bar. MCP `delete_item`.
- **v2:**
  - Single delete with a confirmation sheet; the R2 objects are removed. MCP `piece_delete`.
  - Missing: bulk delete and move.

**WR-18 Favourites, archive, purchase price and date** · v1 absent · v2 pending

- **v1:** there is no favourite or archive field. The `purchase_price` and `purchase_date` columns exist but are never
  read or written.
- **v2:** `DELIVERY.md` lists favourite and archive under wardrobe. The owner has to decide whether they are new scope.

**WR-19 Wishlist** · v1 shipped · v2 pending

- **v1:**
  - A system collection with its own tab.
  - "Move to wishlist" and "I own this"; saves from shop pieces and from boards.
  - Counts toward the free 50-piece cap. Up to 12 wishlist pieces go into the stylist's context.

**WR-20 Wardrobe stats and context** · v1 shipped · v2 pending

- **v1:** counts, category and colour aggregates, and the style summary (`get_wardrobe_context`, the stylist's
  `getWardrobeSummary`). Home's wardrobe stats are cached for 5 minutes.

**WR-21 Closet cap** · v1 shipped · v2 not porting

- **v1:**
  - Free accounts: 50 pieces and 500 MB. Members: unlimited.
  - Every create path calls `assertClosetCapacity`, which answers `quota_exceeded` / `closet_full`.
  - Upload links are refused at the cap.
  - Pin images and collage renders don't count toward storage.
- **v2:** owner decision: no wardrobe cap.

**WR-22 Share a piece publicly** · v1 shipped · v2 pending

- **v1:**
  - An opt-in toggle opens `/share/item/<id>` with an OG card. Turning it off and on keeps the same link.
  - Sharing queues moderation; hidden content is filtered out. Only finished pieces, with only whitelisted fields.
  - Pieces never appear on profiles, only as pins.
  - Code: `wardrobe.setShared`, `wardrobe.getPublicItem`, column `clothing_item.shared_at`.

---

## scans

**SC-01 Multi-photo closet scan** · v1 shipped · v2 pending

- **v1:**
  - Up to 50 photos; every garment in them is detected. Members only, 1 credit per photo, charged up front.
  - Detection: Gemini 3.6 Flash with structured output (box, category, colours, tags, description, confidence) at
    1024 px. Up to 3 photos run ahead in parallel.
  - Progress is `processedPhotos` / `totalPhotos`. A scan counts as failed only when every photo failed, and a retry
    reruns the whole scan.
  - Code: `scans.getUploadUrls`, `scans.startScan`, `api/workers/scan.worker.ts`; tables `scan`, `detection`.
- **v1 gaps:**
  - No cancel and no user retry.
  - A worker failure is not refunded; only a failed enqueue is.
  - `DELIVERY.md` asks v2 for progress, retry, cancel and correct charging.

**SC-02 Scan guide and weak-photo check** · v1 shipped · v2 pending

- **v1:** a 4-step guide, and a check in the browser for dark or blurry photos that never blocks: "Scan anyway" or
  "Scan only the clear ones" (`web/components/scan/scan-guide.tsx`, `photo-check-dialog.tsx`).

**SC-03 Scan review** · v1 shipped · v2 pending

- **v1:**
  - Per photo and per detection: add, add all, dismiss, edit after adding, generate a shot, "Generate remaining (N)".
  - Detections below 50% confidence are hidden behind a toggle.
  - An added piece starts as the box crop (`scan_crop`), or reuses an existing shot. It gets an embedding, and a
    wallet-paid fallback shot if none is in flight.
  - Code: `web/app/(app)/wardrobe/scan/[scanId]/…`, `scans.addToWardrobe`, `addAllToWardrobe`, `dismissDetection`.

**SC-04 Automatic product shots for every detection** · v1 shipped · v2 pending

- **v1:**
  - Shots are made highest confidence first, in chunks of 10, 5 credits each, from the wallet.
  - What the balance can't cover waits for "Generate remaining".
  - No per-scan cap, and the automation budget does not apply.
  - Scans started from MCP make no automatic shots.
  - Code: `api/features/scan/paid-scan-shots.ts`; claims expire after 15 minutes.

**SC-05 Unfinished scans** · v1 shipped · v2 pending

- **v1:** `scans.listScans({unfinishedOnly})` lists them on the scan page and in the activity feed.

**SC-06 Product-shot pipeline (`extract-items`)** · v1 shipped · v2 partial

- **v1:**
  - Modes: `regenerate`, `split`, `extract_detections`.
  - Gemini image draws the garment on a green background (magenta for green garments). The background is keyed to a
    transparent PNG, with a quality check that falls back to the unkeyed image. An optional Cloudflare edge matte can
    run on top. The original is kept as the parent image.
  - Credits are reserved per image and the unused part refunded. Up to 10 detections per job. At most one active job
    per person, and 3 starts per minute.
- **v2:** only the seam. The `GarmentCutout` port runs in the piece queue, and `keepOriginal` stands in until the cut-out
  model plugs in. `ARCHITECTURE.md` plans paid work as an Alchemy Domain saga with a credit reservation.

**SC-07 Automatic product shot after an add** · v1 shipped · v2 pending

- **v1:** runs after analysis or a manual add, for members. It is gated by the automation settings (BI-12); when skipped,
  nothing is said.
- **v1 gap:** members are charged 5 credits on the otherwise free "Add a piece" path.

**SC-08 Background garment detection on board and chat images** · v1 shipped · v2 pending

- **v1:**
  - A "N garments detected" overlay with add, dismiss and extract.
  - Members with `autoDetectGarments` on. Free (token cost only), one pass per image, stored as an `ambient` scan.
  - Code: `api/workers/detect-garments.worker.ts`.

**SC-09 Style read** · v1 shipped · v2 pending

- **v1:** a free, text-only `style-read` job after a scan with at least one detection. It writes `derivedProfile`, which
  the stylist and MCP `get_style_profile` read.

**SC-10 Outfit-check detections** · v1 shipped · v2 pending

- **v1:** an outfit check makes a one-photo scan (`source: outfit_check`). Its detections can be added to the wardrobe,
  optionally after product shots.

**SC-11 Segmentation-first cut-outs** · v1 flag (dev) · v2 pending

- **v1:** a Cloudflare `segment=foreground` matte, judged by Gemini, is tried before generating an image. It needs
  `SEGMENTATION_FIRST_ENABLED` and `CUTOUT_SEGMENT_BASE_URL`.

**SC-12 Repair and backfill at boot** · v1 shipped · v2 pending

- **v1:** relabel the cut-out source, backfill subcategories, and an opt-in product-shot backfill
  (`PRODUCT_SHOT_BACKFILL_LIMIT`, free to people).

---

## studio

**ST-01 Boards list `/studio`** · v1 shipped · v2 pending

- **v1:**
  - Boards with 4-thumbnail covers; search by name (`?q=`); create a board.
  - Names are 1–100 characters and unique among a person's boards. Descriptions up to 500.
  - On the nav as "Boards".
  - Code: `web/app/(app)/studio/studio-shell.tsx`, `studio.listBoards`, `createBoard`; table `board`.

**ST-02 Board grid of pins** · v1 shipped · v2 pending

- **v1:**
  - **Pin kinds:** wardrobe piece, look, shop piece, link, uploaded photo, try-on, collage.
  - **Actions:** paste or drop anywhere; drag to reorder; multi-select; feature one pin full width; caption (500
    characters); remove (100 per call); save to another board; add to the wardrobe; open the link.
  - Order uses a fractional position. A pin whose target is gone, no longer the owner's, or no longer public is dropped
    when read (`api/features/visibility/pin-cards.ts`).
  - The `pin-image` job copies outside images into Styld storage (1600 px WebP).
  - Code: `web/app/(app)/studio/[boardId]/board-grid-shell.tsx`, `pins.*`; table `pin`.

**ST-03 Save-to-board picker and repins** · v1 shipped · v2 pending

- **v1:**
  - Save to any board or a new one, with a caption, from 6 surfaces: piece, look, try-on, the wardrobe bulk bar, item
    detail, feed cards.
  - Saving a feed board repins its pins, credited to the original ("Saved from …").
  - A repin references its source and shows only while that source is public. `save_count` is private.
  - The public board page has no Save button. Repins: 120 per hour.

**ST-04 Collages** · v1 shipped · v2 pending

- **v1:**
  - "New collage", or select pins and "Make collage" (up to 40 pins).
  - A collage is a child board (`kind='collage'`) that shows as a pin on its parent. Deleting the board deletes its
    collages.
  - Migration 0074 turned old canvas boards into grids, each with a featured collage.

**ST-05 Collage canvas editor** · v1 shipped · v2 pending

- **v1:**
  - **Content:** pieces, looks, shop pieces, text, sticky notes, images and links, dragged in from a side panel.
  - **Text:** serif, sans or eyebrow; foreground, muted or accent colour; alignment; 10–320 px; plain or chip; a
    resizable box.
  - **Limits:** 50 nodes added and 100 updated or removed per call; notes and text up to 2000 characters.
  - Code: `web/components/studio/board-canvas.tsx` (React Flow), `studio.addNodes`, `updateNodes`, `removeNodes`; table
    `board_node`.

**ST-06 Canvas interactions and saving** · v1 shipped · v2 pending

- **v1:**
  - Marquee select, Ctrl/Cmd+A, Delete; a dragged card comes to the top.
  - Pan, zoom, fit view, inline text editing (1:1 zoom on mobile).
  - Every change saves at once, with no save button. Positions save on drop, text on blur.
- **v1 gap:** no undo or redo, although `DELIVERY.md` asks for undo.

**ST-07 Card actions** · v1 shipped · v2 pending

- **v1:**
  - Open details, and comment on a card (an annotation of up to 500 characters).
  - "Find similar" at Slovenian shops: 12 results from cached embeddings, free.
  - Add to wardrobe; add to a stylist chat; "Create outfit" from selected pieces; remove.

**ST-08 Link import and screenshot fallback** · v1 shipped · v2 pending

- **v1:**
  - A pasted product URL becomes a product card. When the shop blocks the fetch, the card shows only the domain.
  - A screenshot can then be read by Gemini: 1 credit, members only, refunded on failure.
  - URLs up to 2000 characters. Code: `studio.importFromUrl`, `studio.extractFromScreenshot`,
    `api/features/link-import/*`.

**ST-09 Garment detection badge on board images** · v1 shipped · v2 pending

- **v1:** the board side of SC-08.
  - Save a garment to the wardrobe or wishlist, extract a cut-out onto the canvas (5 credits), or dismiss it.
  - Polls every 4 seconds while detection runs.

**ST-10 Compose / tidy layout** · v1 API only · v2 pending

- **v1:**
  - Up to 12 sections of 6 cards each, under an optional header, as a grid, row or column of 1–8 columns.
  - Cards are moved, never recreated.
  - Reached only through `studio.composeNodes`, MCP `compose_board` and the stylist; there is no web button.

**ST-11 Collage rendering** · v1 shipped · v2 pending

- **v1:**
  - Each collage renders to one WebP, 1600 px wide and 900–2400 px tall (takumi).
  - Re-rendered only when the canvas changes (`render_hash`), debounced 10 seconds. A boot sweep renders up to 500
    collages that have none.
  - Renders draw only what the public may see: a look shows its render or up to 4 pieces, never a try-on.
  - Sharing or deleting a look or try-on re-renders the affected collages. Deleting a wardrobe piece does not.
  - Used by profiles, the feed, OG cards and MCP cards.
- **v1 gap:** people cannot download or export a collage.

**ST-12 Board visibility, settings, delete** · v1 shipped · v2 pending

- **v1:**
  - **Visibility:** private or public. Public boards appear on the profile, can enter the feed, and their link works.
  - **Going public:** needs a published profile with a handle; otherwise a `profile_not_published` dialog.
  - **Collages** follow their parent board.
  - **Moderation:** going public, or renaming while public, queues it.
  - **Settings:** rename, describe, delete (deleting removes pins and collages, never pieces).
  - **Limit:** 30 visibility toggles per 10 minutes.

**ST-13 Outfit ideas panel in Studio** · v1 flag · v2 pending

- **v1:**
  - "Outfit ideas" on a private collage, with up to 6 selected pieces, opens OU-05.
  - "Save & add to [board]" is free.
  - Needs the Jev flag. The labels are hard-coded English, and the `studio.inspiration` copy is stale.

**ST-14 Stylist on a board** · v1 shipped · v2 pending

- **v1:** a chat scoped to the board, with quick prompts (critique, complete, turn the board into an outfit). The
  stylist's canvas tools act on the open collage. Members only, 3 credits a turn.

---

## outfits

**OU-01 Build or edit an outfit `/outfit/new`** · v1 shipped · v2 pending

- **v1:**
  - Pick pieces, name the outfit (the server names an unnamed one, without duplicates), save, edit.
  - Free; names are unique per person. `/try-on` redirects here.
  - Code: `collections.createOutfit`, `update`, `addEntities`, `removeEntities`; tables `collection` (type `outfit`),
    `collection_item`.

**OU-02 Saved looks and the look page** · v1 shipped · v2 pending

- **v1:**
  - The Looks tab, and `/wardrobe/[collectionId]` with the figure and pieces.
  - Actions: edit pieces, "preview on you", switch model photo, share, save to a board, "Wear on…", "Worn today",
    delete.
  - Sharing a look needs no published profile (boards do) and queues moderation.

**OU-03 "Ask the stylist" one-shot** · v1 shipped · v2 pending

- **v1:** a prompt of 3–300 characters on `/outfit/new`. The AI picks the pieces and a name; nothing is saved until
  Save. 1 credit, members only (`collections.generateOutfit`).

**OU-04 Generate a look and render it** · v1 shipped · v2 pending

- **v1, composing:** "Generate for me" builds a look from owned pieces, optionally for an occasion, and avoids pieces
  from recent looks. 1 credit.
- **v1, rendering:** draws the look on the model photo for 5 credits; needs a model photo. A failed render is refunded;
  re-composing is free. Stuck renders are reconciled.
- **Code:** `collections.generateAiOutfit`, `retryAiOutfitRender`; workers `outfit-compose`, `outfit-render`.

**OU-05 Outfit ideas (Jev)** · v1 flag · v2 pending

- **v1:**
  - `/outfit/style?item=`: 3–20 ideas (default 6) for an occasion, from owned pieces. "Show more" and saving are free.
  - 1 credit flat, one request at a time per account, refunded on zero results or failure.
  - The `typesafe-ai/jev` evaluator runs through Vercel AI Gateway on at most 24 candidates. Spend is capped at $1 in
    total. Needs `JEV_ENABLED`.
  - The older `recommendOutfits` (3 results) and `recommendOutfitBurst` are still served.
- **Open:** whether production set the flag.

**OU-06 Virtual try-on** · v1 shipped · v2 pending

- **v1:**
  - 1–10 pieces (wardrobe pieces or temporary photos) on the person's model photo.
  - Started from `/outfit/new`, a look, or a shop piece.
  - The result page `/try-on/[id]` has Download, Save to board, Share, Try again. A result can be imported to the
    wardrobe for 1 credit.
  - 5 credits, members only. Refunded on failure; retry is free.
  - Identical inputs reuse an earlier render (`TRYON_CACHE_VERSION`).
  - Shares are opt-in and moderated.
- **Open:** whether a cache hit is still charged.
- **Code:** `tryOn.generate` and friends, worker `try-on-generation`; tables `try_on_generation`,
  `try_on_generation_item`.

**OU-07 Model photos `/account/models`** · v1 shipped · v2 pending

- **v1:**
  - Upload, list, set the default, delete. Photos can also be picked or uploaded inline from the look page.
  - The first photo is the default; deleting the default promotes another.
  - Never public, and no count limit.
  - Stored as a `model_photos` collection.
- **v1 gap:** `tryOn.getPhotoUploadUrl` has no type allowlist.

**OU-08 "Wear on…", "Worn today", today's look on Home** · v1 shipped · v2 pending

- **v1:**
  - On a look, pick a day: the next 14 days, or browse months, with a count of what is already planned that day.
  - Mark it worn today.
  - Home shows today's planned look (the try-on image, else the render, else a flat lay) with one-tap "Mark worn".
  - Free; one day per placement, ordered by slot.
  - The calendar screen itself was cut (owner decision D6).
  - Code: `calendar.place`, `update`, `get`, `listForLook`; table `collection_schedule`.

**OU-09 Week planning** · v1 API only · v2 pending

- **v1:**
  - `calendar.planWeek` covers 1–31 days and replaces whatever is planned on them, never worn days.
  - Reached only through MCP and the stylist.
  - Trips (a board across a date range) are retired, and the packing workflow was never built.
  - Most `calendar.*` copy is unused.

**OU-10 Outfit check and follow-ups** · v1 shipped · v2 pending

- **v1:**
  - **Result:** from a mirror photo, a score, issues by severity, strengths, and fixes (free, swap from the closet, buy).
  - **After the check:** add the detected pieces (SC-10), keep a history, share the result.
  - **Follow-ups:** question chips open the stylist with the check attached.
  - **Cost:** 2 credits, members only, refunded on failure. Gemini 3.7 Flash with full reasoning for the analysis,
    3.6 Flash for the fixes.
  - **Sharing:** shared checks are not moderated.
  - **Not built:** the roadmap's "1 a day free".
  - Code: `outfitCheck.*`, worker `outfit-check`; table `outfit_check_session`.
- **Open:** no main web nav entry was found; people reach it through chat, share pages, onboarding and MCP.

**OU-11 Daily outfit wheel** · v1 shipped · v2 pending

- **v1:**
  - Spin once a day to land on an owned piece, chosen deterministically by season (northern hemisphere), person and
    day.
  - "Help me make outfits with it" (needs Jev) or "I'll build my own", which opens a "Wheel {date}" board.
  - Appears at 10 or more owned pieces. "Already spun today" is stored in the browser. Events: `wheel_spun`,
    `wheel_action`.
  - Code: `web/components/dashboard/item-of-the-day.tsx`, `web/lib/wheel-items.ts`.

**OU-12 Body type analysis** · v1 shipped · v2 pending

- **v1:** `bodyType.analyze`, 1 credit, members only. It feeds the style profile (ON-04).

**OU-13 Public look, try-on and outfit-check pages** · v1 shipped · v2 pending

- **v1:** see SO-08. A shared look, a try-on and an outfit check each have a public page and an OG card.

---

## stylist

**SY-01 Chat threads `/chat`** · v1 shipped · v2 pending

- **v1:**
  - **Thread list:** grouped by Today, Yesterday, Last week and Older; search; rename; delete with a confirmation;
    retry; new chat.
  - **Empty state:** six chips: wear today, analyse wardrobe, look idea, style an item, pack for a trip, try on.
  - **Price:** 3 credits a turn, taken before the stream starts. Every automatic continuation after a client tool result
    is another billed turn.
  - **Paywall:** hard, as a bar plus the membership dialog.
  - Code: `stylist.*` (`api/routers/stylist.router.ts`); tables `ai_conversations`, `ai_messages`, `ai_message_parts`,
    `chat_message_media`.

**SY-02 Streaming turn engine** · v1 shipped · v2 pending

- **v1:**
  - The AI SDK `streamText` streams through an oRPC event iterator.
  - Limits: up to 25 steps per turn, 4000 output tokens per step. The turn also ends after `recommendOutfits`.
  - The stream keeps running server-side if the client disconnects.
  - Errors fall into three messages: history, overloaded, generic, each with a reference.
  - If the turn fails before any step finishes, it is refunded (`stylist-turn-refund:<messageId>`).
  - Malformed parts are dropped. Token usage is recorded per message, and a free title is generated on the first turn.

**SY-03 Context and persistent memory** · v1 shipped · v2 pending

- **System prompt:** the admin guidance for `chat` plus fixed rules: never show ids, a question policy, brevity, no
  narration, recommend only Slovenian shops.
- **Filled in each turn:** date, season, name, wardrobe (40 recent pieces, 12 wishlist, top colours and tags; cached for
  5 minutes), preferences, style read and notes.
- **Added each turn but never stored:** the calendar for today plus 7 days, the attached board or collage, and the
  attached outfit check.
- **Memory:** `user_profiles.notes`, `preferences`, `derivedProfile`, and up to 20 answered clarifications, never asked
  again.
- **v1 gap:** the stylist is not told the UI language, and dates are formatted en-US.

**SY-04 Attachments** · v1 shipped · v2 pending

- **v1:** presigned upload, 15 MB. This turn's images go inline to Gemini; older ones become text references. Send is
  blocked until uploads finish.

**SY-05 Stylist tools (31, plus 1 behind the flag)** · v1 shipped · v2 pending

- **Wardrobe:** `getWardrobeSummary`, `searchWardrobe` (text, no embeddings), `getItemDetails`, `showItems`.
- **Media:** `viewMedia`.
- **Outfit check:** `analyzeOutfit` (2 credits), `getOutfitCheck`, `getOutfitCheckHistory`.
- **Try-on:** `generateTryOn` (5 credits), `getTryOnHistory`.
- **Outfits:** `createOutfit`, `getCollections`, `setItemOwnership`.
- **Calendar:** `getCalendar`, `planWeek`, `scheduleOutfit`, `updateScheduled`, `removeFromCalendar`.
- **Studio:** `getBoard` (50 nodes), `createBoard` (attaches the board to the chat), `addToBoard`, `layoutBoard`,
  `moveBoardNodes`, `removeFromBoard`, `importLinkToBoard`.
- **Extraction:** `detectItems` (free, cached), `extractItems` (5 credits per cut-out), `saveDetections`.
- **Questions:** `askUserQuestion`, with buttons or text; the answer is kept.
- **Catalog:** `searchCatalog`, 8 results from Slovenian shops.
- **Flag:** `recommendOutfits` (SY-06).
- Code: `packages/chat/src/stylist/stylist-tools.ts`; renderers in `web/components/chat/tool-renderers/`.

**SY-06 Outfit ideas from chat** · v1 flag · v2 pending

- **v1:** `recommendOutfits` builds a priced card. The person presses the price, which calls
  `stylist.confirmOutfitIdeas` with no extra billed turn. 1 credit for 3–20 ideas.

**SY-07 Assistant panel** · v1 shipped · v2 pending

- **Opening and closing:** summoned, never always on. `?chat=` opens it and Back closes it.
- **Kept alive:** it stays mounted, so a reply in progress survives navigation.
- **Layout:** docked or expanded on desktop, a bottom drawer on mobile.
- **Features:** per-board chat history, "Open in full", quick-prompt chips that pages contribute, pending board cards
  as composer chips.
- **v1 gap:** the calendar quick prompts have copy but no code.

**SY-08 Handoffs** · v1 shipped · v2 pending

- **Into the stylist:**
  - Board selection → "Add to chat".
  - Outfit check → follow-up chips.
- **Out of the stylist:**
  - The web stylist → "Continue in ChatGPT or Claude" (`/connect`). Owner decision D7: the hosts are the stylist's main
    home.
  - Home chips → Outfit Check or Scan, with the images already chosen.

**SY-09 Activity timeline and "AI is working" indicator** · v1 shipped · v2 pending

- **v1:**
  - `/activity` merges chats with recent AI jobs (analysis, try-on, outfit check, render, scan, product shot,
    detection).
  - Stuck jobs show as interrupted. Failed try-ons and renders can be retried.
  - The header indicator polls `activity.getActive` every 2 seconds while something runs.

**SY-10 Admin view of conversations** · v1 shipped · v2 pending

- **v1:** `/admin/users/[userId]/conversations/[conversationId]`, with token breakdowns.

---

## catalog

**CA-01 Shops and live status** · v1 shipped · v2 pending

- **v1:**
  - A shop is a user account plus a `shop` row. The `live_shop` view (shops with a published profile) decides
    visibility everywhere.
  - 30 seed shops, 7 of them parked with no feed.
  - The platform (Shopify, WooCommerce, none) is detected by probing the site.
  - Code: `api/features/catalog/seed-shops.ts`, `catalog-detect.ts`.

**CA-02 Feed sync** · v1 shipped · v2 pending

- **Schedule:** twice daily (cron `0 4,16 * * *`, Europe/Lisbon), plus at boot for shops not synced in 12 hours. One
  job per shop.
- **Paging:** up to 40 pages, with backoff.
- **Writes:** an atomic upsert. Pieces that drop out of the feed are deactivated, unless the feed returned under half of
  the live pieces (a truncation guard).
- **Afterwards:** errors are recorded on the shop, the cache epoch is bumped, then embedding and classification are
  queued.
- **Code:** `api/features/catalog/catalog-sync.ts`, `catalog-fetch.ts`, `catalog.mapper.ts`; table `catalog_item`.

**CA-03 Classification** · v1 shipped (AI dormant) · v2 pending

- **v1:**
  - Category, gender, colour and apparel/non-apparel come from per-shop rules, then a Slovenian/English dictionary,
    then the shop's gender default.
  - The Gemini flash-lite fallback (50 per call) exists, but the daily path passes `aiFallback: false`.
  - Code: `catalog-classify.ts`, `shop-rules.ts`, `shared/catalog-dictionary.ts`.

**CA-04 Catalog embeddings** · v1 shipped · v2 pending

- **v1:** embeds "title | shop name" in batches of 100, only when that text changes. Never billed to people.

**CA-05 Search and facets** · v1 shipped · v2 pending

- **v1:**
  - **Search:** semantic plus text, anchored to the closest match.
  - **Sorts:** relevance, newest, price up, price down.
  - **Filters:** category, colour, gender, price, on sale, in stock, brand, shop, city, non-apparel.
  - **Gender rules:** women's and men's filters include unisex; kids' pieces never show; unknown gender shows only under
    All.
  - **Paging:** 48 per page by default, 60 maximum, offsets up to 2000.
  - **Signed out:** text only, at 60 requests per minute per IP.
  - **Caching:** query embeddings for 24 hours, facets for 10 minutes per epoch.
  - **Web UI:** has no brand or in-stock filter.
  - Code: `catalog.search`, `catalog.facets` (public).

**CA-06 Catalog pages** · v1 shipped · v2 pending

- **v1:**
  - `/catalog`: the signed-in browser, with filters kept in the URL.
  - `/catalog/items/[id]`: try on, "I own this", wishlist, save to a board, visit the shop.
  - `/catalog/shops`: the in-app shop list. The public directory is SO-07.

**CA-07 Try on a shop piece** · v1 shipped · v2 pending

- **v1:** `catalog.prepareTryOn` copies the shop's photo into the person's storage, then try-on runs (5 credits).

**CA-08 Click-out tracking `/out/:id`** · v1 shipped · v2 pending

- **v1:**
  - Records a `catalog_click`, skipping bots and HEAD requests; adds UTM tags; redirects with 302.
  - Shops see their visits over 30 days. This is an internal count, not an affiliate network.

**CA-09 Shop self-management** · v1 shipped · v2 pending

- **v1, on `/profile` for a shop account:**
  - **Overview:** piece counts, visits, followers and sync state.
  - **Details:** city, street and website; changing the website re-detects the platform. "Update now"; live on/off.
  - **People:** up to 12; name up to 60 characters, role up to 40, a photo, a linked handle.
  - **Hand-added pieces:** photo, title of up to 200 characters, link, EUR price, featured.
  - Code: `shop.*`, `web/components/profile/shop-editor/*`.

**CA-10 Admin and agent shop tools** · v1 shipped · v2 pending

- **v1:**
  - MCP tools `get_shop`, `create_shop` (admin only), `update_shop` (login email and gender default are admin only),
    `save_shop_piece`, `save_shop_person`, `remove_from_shop`.
  - A `catalog:ingest --dry-run` CLI.
  - There is no admin web page for shops; they are managed only through MCP.

**CA-11 Other catalog consumers** · v1 shipped · v2 pending

- **v1:** the stylist's `searchCatalog`, MCP `search_shop_pieces`, Studio's add picker and "Find similar" (ST-07). Feed
  ranking uses taste fit (SO-02).

---

## social

**SO-01 Signed-out landing `/`** · v1 shipped · v2 pending

- **v1:**
  - A hero, then the public feed. The first page renders on the server, then the feed scrolls on.
  - Save and Follow send the visitor to `/login?callbackURL=/`.
  - Visitor ranking is freshness plus editorial boost. The page is indexable.
  - Signed-in visitors are sent to `/dashboard`.
- **v2:** the home page exists (Gallery design); the public feed does not.

**SO-02 Home feed: For you and Following** · v1 shipped · v2 pending

- **What a person can do:** switch tabs, filter by gender, scroll without end; the URL keeps the tab and filter.
- **Card kinds:** shop piece, board, collage, "shop joined" (a new shop with 4 of its pieces).
- **For you ranking:** `0.5·fresh + 0.4·fit + 0.1·boost`.
  - Freshness decays over 7 days.
  - Fit is measured against taste anchors: the 40 newest wardrobe pieces, plus up to 20 shop pieces saved or clicked in
    the last 90 days.
  - Boosts: following the author +1, curated +0.5, a shop in your city +0.5.
  - At most 2 cards per author in any 10.
  - The ranked list is cached as ids only (up to 300) for each 12-hour window. Pages hold up to 30.
  - No AI calls.
- **Following:** newest first, not cached, sign-in required.
- **Visibility:** every page is re-checked against visibility and safety rules.
- **Code:** `feed.list` (public), `api/features/feed/*`.

**SO-03 Follow suggestions ("Worth following")** · v1 shipped · v2 pending

- **v1:**
  - Live shops, plus house or featured people with a public board, ranked by taste fit.
  - Shown when Following is empty. 6 by default, 24 at most.
  - Excludes yourself, people you already follow, and blocks in either direction.

**SO-04 Public profile `/@handle`** · v1 shipped · v2 pending

- **What it shows:** avatar, cover, name, bio, links, a featured board or collage, public boards, public looks.
- **What a visitor can do:** follow, report, block, and share with `?ref=`.
- **Rules:**
  - The page exists only when the profile is live: published, not banned, not a guest.
  - A profile hidden by moderation, or a block either way, answers the same not-found.
  - Unpublished profiles are `noindex`.
- **Code:** `web/proxy.ts` rewrites to `/u/[username]`; `profile.getPublic`; table `public_profile`.

**SO-05 Profile editor `/profile`** · v1 shipped · v2 pending

- **What a person can edit:**
  - Name (60 characters) and bio (160, or 1000 for shops), autosaved.
  - A handle, with a live availability check.
  - Avatar and cover.
  - Up to 8 links: Instagram, TikTok, Pinterest, YouTube, Facebook, Maps, email, phone, website.
  - The featured board.
- **Also:** publish or unpublish, preview, copy the link.
- **Handle rules:** 3–30 characters of lowercase letters, digits, `_` and single inner dots; a reserved list is blocked.
- **Publishing** requires a handle, and every public change queues moderation.

**SO-06 Follow** · v1 shipped · v2 pending

- **v1:**
  - One-way, with no approval. Available on mastheads, piece pages, the shop directory, feed cards and suggestions.
  - Private: nobody sees anyone else's lists or counts, except that a shop sees its own count.
  - Only live profiles, never yourself. 60 per hour.
  - A status check covers up to 60 handles. Blocking removes follows.
- **v1 gap:** the weekly digest email in the spec is not built.

**SO-07 Directories** · v1 shipped · v2 pending

- **v1:** the public `/shops` lists live shops with logo, city, piece count, 3 newest photos and Follow. There is no
  people directory.

**SO-08 Public share links** · v1 shipped · v2 pending

- **Boards and collages:** `/share/board/[id]`. Needs a public board and a live owner profile. Shows the featured collage
  render or a read-only canvas, then the pins, each with a report menu.
- **Looks:** `/share/outfit/[id]`. Needs the look shared; checked for moderation and blocks.
- **Try-ons:** `/share/try-on/[id]`. Completed and shared only; images width-capped; never the original photos.
- **Outfit checks:** `/share/outfit-check/[id]`. Non-members are sent into the outfit-check onboarding flow.
- **Pieces:** `/share/item/[id]`, see WR-22.
- **Rules for every link:**
  - Opt-in; switching sharing off and on keeps the URL.
  - "By @name" appears only if the owner's profile is published.
  - Each page has a canonical URL and an OG card.
  - Share sheets offer native share, copy, X and WhatsApp.

**SO-09 OG cards** · v1 shipped · v2 pending

- **v1:** 1200×630 cards rendered with takumi for the brand, a board, a piece, a look, an outfit check, a profile and a
  try-on. A private or unknown target gets the brand card, and only Styld's own CDN images are used (`web/app/api/og/**`).

**SO-10 SEO landing pages, sitemap, robots** · v1 shipped · v2 pending

- **Landing pages:** `/virtual-try-on`, `/outfit-check`, `/wardrobe-organizer`, `/ai-stylist`, statically generated;
  any other slug is 404.
- **Sitemap:** the home page, the landings, `/shops`, pricing, membership, legal, and every published profile and live
  shop (up to 5000, cached 1 hour).
- **Robots:** blocks app sections but leaves `/share/` crawlable, so link previews work.

**SO-11 House account `@styld`** · v1 shipped (thin) · v2 pending

- **v1:** seeded at boot, published and curated as house, so its editorial boards reach For you. The 15–20 boards it
  needs were an unfinished owner task.

**SO-12 Owner protections for unpublished profiles** · v1 shipped · v2 pending

- **v1:** with an unpublished profile:
  - the person's boards cannot go public, and their public reads answer not-found;
  - their shared looks leave their profile;
  - their follows drop out of other people's reads.
- `DELIVERY.md` lists these "unpublished-owner protections" for social.

---

## safety

**SA-01 Reports** · v1 shipped · v2 pending

- **What can be reported:** a pin, board, collage, look, profile, picture or try-on.
- **Reasons:** spam, nudity, harassment, hate, violence, self-harm, IP, other; plus an optional note.
- **Limits:** 10 reports per hour. One open report per person and target. Your own content cannot be reported.
- **Auto-hide:** 3 distinct reporters hide content until an admin reviews it; never a whole profile.
- **Alerts:** a Telegram alert to the operator, at most one per target per hour.
- **v1 gaps:** no report action on the featured pin, try-on shares, or the board and look cards on a profile.
- **Code:** `safety.report`, `reportProfile`; table `content_report`.

**SA-02 Blocks** · v1 shipped · v2 pending

- **What a person can do:** block someone from their profile menu, and unblock under Account → Blocked accounts.
- **Effect:** the two people see each other's profiles and boards as 404, and both drop out of each other's feed,
  suggestions and follows.
- **Follows:** removed by the block and not restored by an unblock.
- **Privacy:** the blocked person is never told.
- **Limit:** 60 per hour.
- **Code:** `safety.block`, `unblock`, `blockStatus`, `listBlocked`; table `user_block`.

**SA-03 Automatic AI moderation** · v1 shipped · v2 pending

- **Triggers:** making a board public or renaming it while public; pinning to a public board; re-rendering a public
  collage; sharing a look, try-on or piece; changing a profile.
- **What is checked:** up to 3 images at 1024 px, plus text.
- **Outcomes:**
  - `minor_sexual` is removed at once; other labels flag the content.
  - A failed check, or the daily budget of 3000 being spent, marks the content "unchecked", which hides it until a
    person reviews it.
  - Unchanged content is not re-checked for 30 days.
- **Cost and model:** free to people; Gemini Flash, never rerouted.
- **Not moderated:** outfit-check shares and `update_shop` edits.
- **Code:** `api/features/safety/moderation.service.ts`, worker `moderate`; table `moderation_state`.

**SA-04 Owner notices** · v1 shipped · v2 pending

- **v1:** "Under review" and "removed" notices on your own board, with counts of affected pins and collages, and in the
  profile editor (`safety.myNotices`). Owners always see their own content. No notice on looks or try-ons.

**SA-05 Curation and feed approval** · v1 shipped · v2 pending

- **v1:**
  - Pending content opens from direct links but is never feed-eligible; only approved boards and collages enter the
    feed.
  - For you carries people's boards only from house or featured profiles, or boards an admin featured. Shop pieces are
    not moderated.
  - The operator side is OP-14 and OP-15.

---

## billing

**BI-01 Plan and prices** · v1 shipped · v2 pending

- **v1:**
  - Member: monthly or yearly (a 17% saving); 500 credits a month; unlimited wardrobe.
  - Dodo product ids per mode. Live mode only in prod unless `DODO_LIVE_MODE` says otherwise.
  - `sync-dodo-copy.ts` pushes product copy to Dodo.

**BI-02 Credit wallet** · v1 shipped · v2 pending

- **Pools:** subscription credits and purchased credits. Subscription credits are spent first.
- **Monthly grant:** made lazily on spend, on usage reads and on webhooks, once per UTC month. The subscription pool is
  capped at twice the monthly grant.
- **What counts as a plan:** status `active` with `period_end` in the future or null. Lapsed subscribers see their
  balance but cannot spend it; this is an open decision.
- **Storage:** rows locked per write. A ledger insert prevents double processing. `credit_balance` has a non-negative
  check.
- **Tables:** `subscription`, `credit_balance`, `credit_transaction` (types: grant, purchase, usage, refund, referral,
  admin).

**BI-03 Paywalls and quota errors** · v1 shipped · v2 pending

- **Server middleware:**
  - `withUsageGuard` charges one use.
  - `requireActiveSubscription` checks the plan only.
  - `reserveCredits` charges N, for scans and extraction.
  - `assertClosetCapacity` enforces the cap.
- **One error:** FORBIDDEN `quota_exceeded`, with `quotaType` set to credits, no_subscription, fair_use or closet_full.
- **Web:**
  - The `MembershipGate` dialog and `LockedChip`, with copy for each feature. The CTA goes straight to monthly checkout.
  - A fallback toast: no plan or a full closet goes to `/pricing`, no credits to `/account/subscription`.
  - The stylist has its own inline paywall.
- **Event:** `paywall_hit`, sent from the server and the client.

**BI-04 Checkout and return** · v1 shipped · v2 pending

- **Starting checkout:** `authClient.dodopayments.checkoutSession({slug})`, signed in only. The server writes the user
  id into the metadata and ignores the browser's value.
- **Return page:** `/subscription/success` calls `subscription.confirmCheckout`. That fetches the subscription from
  Dodo, checks it belongs to the caller, and applies it the same way the webhook does.
- **Waiting:** the page polls every 2 seconds; after 20 seconds it says "still processing". Failed, cancelled and
  expired checkouts get a declined state.
- **Afterwards:** back to the path saved before checkout (30 minutes).
- **Open:** pack purchases probably show subscription wording, because nothing adds `?type=credits`.

**BI-05 Billing portal** · v1 shipped · v2 pending

- **v1:** "Manage billing" opens the Dodo customer portal. The Dodo customer is created lazily, at checkout.

**BI-06 Dodo webhooks** · v1 shipped · v2 pending

- **Logging:** every event goes to `webhook_event` (received, then processed or failed). A handler error answers 400 so
  Dodo retries.
- **Subscription events:**
  - `subscription.active` upserts the subscription; on first activation it grants credits, rewards the referral and
    sends `subscribed`.
  - `renewed` grants the month's credits. `on_hold`, `failed`, `plan_changed` and `updated` upsert;
    `cancelled` and `expired` set the status.
- **Payment events:**
  - `payment.succeeded` credits each pack × quantity, keyed `payment_id:product_id`. Other brands' payments are ignored.
  - `payment.failed` is logged only.
- **Matching a user:** metadata user id, then the Dodo customer, then the email. An unmatched paid event goes to Sentry
  and Telegram.

**BI-07 Subscription page `/account/subscription`** · v1 shipped · v2 pending

- **v1:** plan, price and reset date. Credits as total, monthly and purchased, shown red at 5 or fewer. This month's
  usage per feature, the credit packs and the automations card. Non-members see "View plans".

**BI-08 Credit packs** · v1 shipped · v2 pending

- **v1:** 250, 750 and 2500 credits. Members only in the UI. They never expire.

**BI-09 Pricing and membership pages** · v1 shipped · v2 pending

- **v1:** `/pricing` has a monthly/yearly switch and a paywall banner for `?reason=no_subscription`. `/membership` is a
  read-only page of what membership includes and costs, with no checkout; it is the only link AI hosts get.

**BI-10 Refunds** · v1 shipped · v2 pending

- **v1:** `refundCredit` (with an idempotency key) and `compensateCredit`. Refunds always go to the subscription pool.
  Workers refund failed jobs and unused reservations.

**BI-11 Sidebar usage widget** · v1 shipped · v2 pending

- **v1:** the credit count for members (red at 5 or fewer); "free plan" and an upgrade link for others.

**BI-12 Automations and budget** · v1 shipped · v2 pending

- **Switches:**
  - Auto product shots, on by default: 5 credits each, charged without asking.
  - Detect garments, on by default: free, but needs a plan. Checked when the job runs.
- **Monthly automation budget:** 250 credits by default; empty means no limit; at most 100,000.
- **Silent skips:** when automations are off, over budget, out of credits or without a plan, the work is skipped and
  nothing is said. Refunds give the budget back.
- **v1 gap:** scan shots ignore these settings (SC-04).

**BI-13 Comped premium** · v1 shipped · v2 pending

- **v1:** an admin grant (OP-11), or `grant-premium.ts`, makes an active subscription with no Dodo id, ending in 2099,
  plus this month's credits. The MCP reviewer seed also gets premium.

**BI-14 Batch automations** · v1 API only · v2 pending

- **v1:**
  - `activity.runProductShotBatch`: 1–25 pieces.
  - `runWeekTryOnBatch`: 1–10 planned outfits in the next 7 days; needs a model photo.
  - Both stop when credits run out. The `activity.suggestions.*` copy is not rendered anywhere.

---

## mcp

**MC-01 Endpoint and transport** · v1 shipped · v2 done

- **v1:**
  - Streamable HTTP at `/mcp`, with the alias `/mcp/app`. Server `styld` 4.0.0.
  - A new server per request. 2026-07-28 clients are served per request, 2025 clients with `legacy: "stateless"` SSE
    framing.
  - Server instructions: the first paragraph is at most 512 characters, the whole at most 2048.
  - Code: `api/mcp/create-handler.ts`, `mount.ts`.
- **v2:**
  - A stateless server per request, with `@modelcontextprotocol/server` 2.4.0. 2026-07-28 clients go through
    `createMcpHandler`; older eras get a per-request JSON transport, never `legacy: 'stateless'`.
  - `GET /mcp` answers 405.
  - Evidence: native, with SDK 1.x and 2.x clients.

**MC-02 Signed-out browsing** · v1 shipped · v2 pending

- **Without a token:** initialize, `tools/list`, resources and the 4 public tools work, at 60 requests per minute per
  IP.
- **Account tools without a token:** 401 with `WWW-Authenticate` naming the resource metadata and scopes.
- **Bad tokens:** refused even on public tools.
- **Advertising:** `_meta.securitySchemes` lists noauth plus oauth2 for public tools.
- **v2:** every call needs a token. The challenge headers match v1 (native and preview).

**MC-03 OAuth 2.1 issuer** · v1 shipped · v2 done

- **v1:**
  - Better Auth `mcp()` and `cimd()`, plus a 7-hunk patch: varying loopback ports, lenient narrowing, `native` for
    loopback, no `client_credentials`, 200 for revoking an unknown token, automatic `offline_access`, only http(s)
    redirects.
  - Access tokens last 15 minutes. Refresh rotates, with a 30-second replay window. DPoP is stripped.
  - Discovery documents are served with CORS `*`. Every call re-checks the grant.
- **v2:**
  - Its own Yielded issuer: DCR, an exact CIMD allowlist, PKCE S256, rotating refresh with family revocation on replay,
    revoke, RFC 9728 metadata.
  - Opaque 600-second tokens checked against D1. No replay grace window.
  - Recorded deviations are in `ARCHITECTURE.md`.

**MC-04 Dynamic client registration** · v1 shipped · v2 done

- **v1:**
  - `POST /api/auth/oauth2/register`, 10 per hour per IP.
  - Unsupported grants and scopes are narrowed. Kept for Cursor, Windsurf, mcp-remote and Claude Code.
- **v2:**
  - `POST /oauth/mcp/register`, rate limited per IP. Public clients only.
  - Redirects must be https or loopback http, matched exactly; custom schemes are refused.
  - Grants are narrowed to `authorization_code` + `refresh_token`.

**MC-05 Scopes** · v1 shipped · v2 partial

- **v1:**
  - `openid profile email offline_access styld:read styld:write`.
  - A read grant runs only read tools plus `send_feedback`. Old identity-only grants keep full access.
- **v2:** `styld:read` and `styld:write`. A missing scope answers 403 `insufficient_scope`. There are no identity scopes.

**MC-06 Consent page** · v1 shipped · v2 partial

- **v1:** `/consent` shows the client name and redirect host, warns about local redirects, and lists scopes in plain
  language, including "Stay connected".
- **v2:** consent works and is exercised in the OAuth journey. The Gallery-styled copy is not done.

**MC-07 Tools: account and wardrobe** · v1 shipped · v2 partial

- **v1 tools:** `whoami` (plan, credits, caps, prices), `get_style_profile`, `search_items`, `get_wardrobe_context`,
  `get_item`, `add_item_from_url`, `update_item`, `delete_item`, `request_image_upload`, `add_pieces`, `own_this`.
- **Built in v2:**
  - `account_get` ≈ `whoami`, but without plan or credits.
  - `piece_search` ≈ `search_items`.
  - `piece_get` ≈ `get_item`.
  - `piece_add` ≈ `add_item_from_url`, with no analysis.
  - `piece_update` ≈ `update_item`.
  - `piece_delete` ≈ `delete_item`.
  - `upload_create` ≈ `request_image_upload`.
- **Not built:** `get_style_profile`, `get_wardrobe_context`, `add_pieces`, `own_this`.
- **Owner decision:** noun_verb names replace v1's published names.
- **Inputs:** closed; unknown keys are rejected.

**MC-08 Tools: discovery, boards, outfits, calendar** · v1 shipped · v2 pending

- **Public:** `browse_feed`, `search_shop_pieces`, `view_board`, `view_profile`.
- **Boards:** `save_to_board`, `follow`, `make_collage`, `read_collage_card`, `list_my_boards`, `get_board`,
  `add_to_board`, `compose_board`, `edit_board`, `save_board_card`, `remove_from_board`, `delete_board`.
- **Outfits:** `create_outfit`, `get_outfit`, `list_outfits`, `list_collections`, `modify_collection_items`,
  `update_collection`, `delete_collection`. Writes take `expectedVersion` and an idempotency key, and their receipts
  survive deletion.
- **Calendar:** `get_calendar` (62 days at most), `place_on_calendar`, `plan_week`, `update_placement`,
  `remove_placement`.

**MC-09 Tools: paid pipelines, jobs, cards, feedback, shops** · v1 shipped · v2 pending

- **Paid:** `check_outfit` (2), `try_on` (5), `scan_closet_photos` (1 per photo, up to 5), `add_scanned_items` (free),
  `generate_ai_outfit` (1), `recommend_outfits` (flag, 1), `generate_product_shot` (5 each, up to 8).
- **Jobs:** `get_jobs`.
- **Cards and tray:** `show_pieces`, `show_outfit`, `read_card_status`, `open_wardrobe_panel`, `browse_wardrobe_panel`,
  `read_outfit_panel`, `read_selection_panel`.
- **Feedback:** `send_feedback`.
- **Shops:** CA-10.
- **Counts:** 61 tools with Jev enabled. The published lock predates the R4 tools. There are no MCP prompts.

**MC-10 Resources and MCP Apps views** · v1 shipped · v2 pending

- **Resources:** `ui://styld/card/v2.html`, `wardrobe/v4.html` (the fullscreen tray) and `discover/v1.html`. The legacy
  `card/v1` and `wardrobe/v3` are still served.
- **The bundle:** one React bundle with a strict, no-network CSP and the host's theme; no logo and no upsell.
- **Images:** sent as WebP bytes, never URLs: tray 192 px / 32 KB, card 400 px / 40 KB, preview 640 px / 72 KB.
- **Live cards:** poll every 4 s, then 8 s, then 15 s, for at most 10 minutes.
- **Paid buttons:** carry their price. A free plan sees "Part of Styld membership" and a `/membership` link.
- **Not built:** an options card for `recommend_outfits`.
- **v2:** `resources/templates/list` returns `[]`.

**MC-11 Agent-facing rules** · v1 shipped · v2 partial

- **v1:**
  - **Errors:** `CODE: message\nHow to fix: …`, plus structured `{code, message, recovery, retryable}`, across 21 codes.
  - **Links:** every entity carries its private `url`; signed `/cdn/` URLs are scrubbed.
  - **Job envelope:** `{kind, id, status, creditsCharged, pollAfterSeconds}`.
  - **Paid operations:** a durable claim per idempotency key, split into prepare and execute. An unresolved claim fails
    closed (`OPERATION_UNRESOLVED`). `maxCostCredits` below the price gives `COST_LIMIT_EXCEEDED`.
  - **Copy:** names membership but never urges a purchase, and never links to checkout (an OpenAI directory rule).
  - **Agent images:** fetched through an SSRF guard.
- **v2:**
  - Errors carry `{code, message, recovery, retryable}`, set as `isError`.
  - Every result carries the piece's app `url`; private image URLs never appear.
  - Mutations replay by `operationId`. The image import is guarded.
  - Missing: cost authorisation and the job envelope, both waiting on paid work.

**MC-12 Connected agents** · v1 shipped · v2 pending

- **v1:**
  - Account → Connected agents lists the name, connection date, last use and scopes.
  - Revoke deletes the consent and marks every token for that client revoked.
  - With no agents, the card points to `/connect`.
  - Code: `agents.list`, `agents.revoke`.
- **v2:** OAuth revoke works (native). There is no list or revoke UI.

**MC-13 Connect instructions** · v1 shipped · v2 partial

- **v1:** `/connect` has steps for Claude and ChatGPT, a copyable server URL, things to try, free vs paid, privacy and
  revoke, and a Claude Code command. Its playbook link `/skill.md` is probably a 404. Mounted on the chat index and the
  dashboard.
- **v2:** the Account row "Use Styld in ChatGPT or Claude" with the MCP URL and a copy button. There is no `/connect`
  page.

**MC-14 MCP rate limits and telemetry** · v1 shipped · v2 pending

- **v1:**
  - **Limits:** 60 per minute per user for agents, 90 for card polling, 60 per IP anonymous. Over the limit: −32029 with
    HTTP 429.
  - **Events:** `mcp_tool_called` and `mcp_protocol_request`, with grant, hashed client, era, `ui_rendered`, credits and
    latency, never arguments.
  - **Dashboard:** its definition is committed but the dashboard was never created.

**MC-15 Store submission, reviewer seed, ChatGPT plugin** · v1 prepared · v2 pending

- **v1:**
  - `docs/mcp-submission.md` has example prompts and a review walk.
  - The `MCP_REVIEWER_*` seed creates a member with a board and 3 pieces.
  - `integrations/chatgpt/` holds a draft Agent Plugins package (`plugin.json`, `mcp.json`, a get-started skill) that
    was never submitted.
  - Decided against: `describe_api`/`call_api` (removed 2026-08-24) and a `run_code` sandbox (deferred).
- **v2:** real ChatGPT and Claude.ai connection is an owner check that is still open.

---

## operations

**OP-01 Transactional email** · v1 shipped · v2 partial

- **v1:**
  - **Service:** Cloudflare Email REST, sending HTML and text.
  - **Templates:** sign-in code (with the link), welcome (ON-05), referral invite.
  - **Unused templates:** email verification and password reset.
  - **Refusals:** `.invalid` addresses; bounced or suppressed recipients throw.
- **v2:** sign-in and registration code emails in en/sl through the same API. They count bounced or suppressed
  recipients as failures and refuse `.invalid`. Welcome and invite emails are not built.

**OP-02 Notifications for people** · v1 absent · v2 pending

- **v1:**
  - No inbox, push or digest; the weekly digest and web push were deferred.
  - What exists: toasts, the "N running" indicator (SY-09) and moderation notices (SA-04).

**OP-03 Operator alerts on Telegram** · v1 shipped (config) · v2 pending

- **v1:**
  - **Fires on:** uncaught errors, permanent job failures, a catalog feed failing (silenced for 7 days), unmatched
    payments, user reports, moderation flags, and the moderation budget running out.
  - **Dedupe:** 6 hours per key.
  - **Config:** `OPS_TELEGRAM_*`.

**OP-04 Home `/dashboard`** · v1 shipped · v2 pending

- **v1:**
  - A dateline with weather (Open-Meteo, only with location granted, cached 30 minutes), a greeting, and "Use Styld in
    ChatGPT/Claude".
  - Under 10 pieces: an add-a-piece or browse-the-shop card, then the feed.
  - From 10 pieces: the wheel (OU-11), today's look (OU-08), then the feed.
  - Code: `dashboard.getOverview`, `updateLocation`, `updateLocationPermission`; table `user_settings`.

**OP-05 Dashboard AI suggestions** · v1 API only · v2 pending

- **v1:** `dashboard.getSuggestions` needs a plan and costs 0. It is cached per person, day and locale (6 hours). No web
  caller.

**OP-06 Admin overview `/admin`** · v1 shipped · v2 pending

- **KPIs:** users (total, new, active in 30 days, shops excluded), MRR, AI cost, API calls, content counts.
- **Unit economics:** credits spent against AI cost.
- **Charts:** cost by feature and its trend, content activity, subscriptions, revenue, user growth, job success
  rates, the onboarding funnel, and credit inflow and outflow, over 7–90 days.
- **Estimates:** MRR comes from active rows. Pack revenue is inferred from credits. "Trialing" is always 0.

**OP-07 Admin users list** · v1 shipped · v2 pending

- **v1:**
  - **Search and filters:** name or email; hide anonymous, premium only, onboarding status.
  - **Sorts:** created, last active, items, AI cost, storage. Up to 100 per page.
  - **Badges, plus inline actions:** role change, unban, impersonate.

**OP-08 Admin user detail** · v1 shipped · v2 pending

- **Account:** info and storage, sign-in providers, billing, referrals.
- **Money:** token usage, cost per feature, the credit ledger, admin actions taken.
- **Profile:** onboarding status, AI notes, preferences, "clear onboarding".
- **Activity and content:** an activity timeline matched to token cost; tabs for wardrobe, try-ons, outfit checks and
  scans; conversations (SY-10).

**OP-09 Admin jobs `/admin/jobs`** · v1 shipped · v2 pending

- **v1:** counts per queue across the 15 queues (OP-20). Failed jobs show their payload and stack, and can be retried,
  removed or retried all.

**OP-10 Admin webhooks `/admin/webhooks`** · v1 shipped · v2 pending

- **v1:** a read-only log of Dodo events, filtered by status and type, with a payload viewer. Rows are not deduplicated.

**OP-11 Admin billing interventions** · v1 shipped · v2 pending

- **Grant or deduct credits:**
  - 1–100,000 credits, with a reason of 3–500 characters.
  - Grants go to the purchased pool. Deductions take purchased credits first, and are rejected when the balance is too
    low.
- **Premium:** grant gives a comp with no end date; revoke cancels and keeps the credits.
- **Onboarding:** "clear onboarding" resets it.
- Everything here is logged.

**OP-12 Admin actions log** · v1 shipped · v2 pending

- **v1:** a paged `admin_action` trail of board/profile features, content removals and restores, credit and premium
  changes, onboarding resets, referral reward or cancel, report dismissals, bans, unbans and role changes.

**OP-13 Agent feedback triage `/admin/feedback`** · v1 shipped · v2 pending

- **v1:**
  - `send_feedback` writes to `mcp_feedback`: 30 a day per person; repeats on the same day are folded together; kept
    180 days.
  - Filter by status and gap type; mark handled or reopen.

**OP-14 Admin moderation queue** · v1 shipped · v2 pending

- **v1:**
  - Up to 500 open reports and 200 AI flags, grouped by item, most reported first.
  - Remove, restore or dismiss, with an optional note of up to 500 characters.

**OP-15 Admin curation** · v1 shipped · v2 pending

- **v1:** search by handle; set a profile to house, featured or none; feature or unfeature public boards.

**OP-16 Admin prompts** · v1 shipped · v2 pending

- **v1:**
  - Guidance for 9 features: chat, clothing analysis, titles, outfit-check analysis and fixes, body type, inspiration,
    item extraction, try-on.
  - Create, revise (always a new version), roll back, compare against the active version, and view history.
  - Exactly one version is active per feature; reads are cached for 5 minutes.
  - Tables: `system_prompts`, `record_version`.

**OP-17 Referrals** · v1 shipped · v2 pending

- **Code and link:** an 8-character code per person, without I, O, 0 or 1. The share link is `/pricing?ref=CODE`.
- **Attribution:** the `ref` cookie lasts 30 days and is recorded on every sign-up path. Self-referral is blocked, and a
  person can be referred only once.
- **Reward:** +3 purchased credits each, on the referee's first subscription. Exactly once, through a
  `WHERE status='pending'` flip. Packs don't count.
- **Invites:** up to 5 invite emails a day.
- **Pages:** `/account/referrals`, plus `/admin/referrals` (totals, top 10, recent, reward or cancel).
- **Open:** whether 3 credits survived the ×5 redenomination.

**OP-18 Analytics** · v1 shipped · v2 pending

- **Server events (PostHog):** `api_request`, `signup`, `$identify {acquired_via}`, `host_connected`, `subscribed`,
  `paywall_hit`, `taste_picks_saved`, `pin_saved`, `piece_added`, `board_published`, `mcp_feedback_sent`, and
  exceptions. Batched 20 events or 10 seconds.
- **Browser events:** sent through the `/_ph` proxy: `wheel_*`, `onboarding_step_completed`, `paywall_hit`, `catalog_*`,
  `discover_*`, `follow_toggled`, `profile_viewed`, `share_page_viewed`, `shops_directory_viewed`. They carry no PII.
- **No consent banner.**
- **v2:** analytics are pending. Telemetry is EX-06.

**OP-19 AI platform** · v1 shipped · v2 pending

- **Providers:** Gemini by default, through a LiteLLM passthrough on dev and prod. LiteLLM text rerouting. Alibaba for
  try-on. Vercel AI Gateway for Jev only. Anthropic, Groq and xAI are wired but unused.
- **Cost tracking:** `ai_token_usage` stores feature, model, tokens, image count and USD. Prices come from `pricing.ts`,
  and a test fails when a promotional price expires. PostHog `$ai_generation`.
- **Admin:** cost trend, cost against credits, the credit economy.

**OP-20 Background jobs** · v1 shipped · v2 partial

- **v1 queues** (BullMQ on Redis; 3 attempts with backoff; `UnrecoverableError` stops retries but still refunds):
  - Wardrobe and scans: `analyze-image`, `scan`, `style-read`, `detect-garments`, `extract-items`.
  - Outfits: `try-on-generation`, `outfit-render`, `outfit-compose`, `outfit-check`.
  - Catalog: `catalog-sync`, `catalog-embed`, `catalog-classify`.
  - Studio and safety: `pin-image`, `collage-render`, `moderate`.
- **Schedule:** one cron, the catalog sync. Boot sweeps cover stale syncs, embedding and classification, pin images,
  missing renders, unmoderated content, backfills and stale renders.
- **Failure reporting:** a final failure goes to Sentry, PostHog and Telegram.
- **v2:**
  - One Cloudflare Queue with a dead-letter queue, carrying piece processing and the finishing step of account deletion.
  - Bounded attempts, then the piece is marked failed.
  - Paid work moves to an Alchemy Domain saga.

**OP-21 Health and error tracking** · v1 shipped · v2 partial

- **v1:** `GET /health` checks the database and Redis. Sentry on the server and web (through `/monitoring`). JSON logs
  on Railway. `/api-reference` is hidden in prod.
- **v2:** a health endpoint, and native Cloudflare traces and logs through the bounded seam in `@styld/observability`.

**OP-22 Gateway, image serving, scripts** · v1 shipped · v2 partial

- **v1:**
  - **Gateway (Caddy):** `/rpc`, `/api/auth`, `/mcp`, `/out`, `/cdn` (imgproxy, with signed URLs and box crops) and
    `/_ph`.
  - **Scripts:** backfill embeddings, grant premium, Dodo copy sync, a catalog-ingest dry run.
  - **`packages/asset-gen`:** offline marketing images.
- **v2:**
  - One public origin through the edge Worker.
  - `/cdn/pieces/:id/{thumb|full}` checks ownership and serves private WebP through the Images binding.

---

## experience

**EX-01 Languages en/sl** · v1 shipped · v2 partial

- **v1:**
  - `next-intl`. The locale comes from the `NEXT_LOCALE` cookie; changing it reloads the page.
  - Both catalogs have the same 44 namespaces (a parity test).
  - Terms: boards are "zbirke", collage "kolaž", pin "kartica".
- **v2:**
  - x18n ICU catalogs for en and sl, holding v1's 2690 keys plus the newer ones. Rendering receives the locale.
  - The language picker saves the choice.
  - Slovenian copy for the new screens is waiting for owner review.

**EX-02 PWA, mobile, Safari** · v1 shipped · v2 partial

- **v1:**
  - **Manifest:** standalone, starting at `/dashboard`. No service worker, offline mode or push.
  - **Apple:** `appleWebApp`, `viewportFit: cover`, cream theme.
  - **Mobile:** safe-area utilities, no overscroll, no tap highlight. Pill nav: Home, Shop, Boards, Wardrobe.
  - **Safari:** 16 px inputs so iOS doesn't zoom. A `cookieStore` guard, though the language switch misses it.
- **v2:**
  - Gallery shell: a 64 px top bar and a tab bar of built sections on mobile, top nav on desktop.
  - A theme colour and favicon only. There is no manifest, Apple web-app meta or icon set yet.

**EX-03 Legal pages** · v1 shipped (English body) · v2 pending

- **v1:** `/privacy` and `/terms`, "updated October 2026". The privacy page has a translated section on ChatGPT and
  Claude.
- **v2:** the privacy page must describe the account deletion that v2 now has (ID-11).

**EX-04 Product tours** · v1 shipped · v2 pending

- **v1:**
  - driver.js, loaded lazily.
  - Tours: `orientation` (auto once, replayable from Help), `new-look`, `outfit-check`, `scan`, `studio-board`.
  - Steps without a visible anchor are skipped. Completion is stored per tour version in localStorage.
  - The scan guide replaces the scan tour on a first visit.

**EX-05 Empty, error and loading states** · v1 shipped · v2 partial

- **v1 convention** (`DESIGN.md` "Copy and chrome"): every data region has a skeleton shaped like its content, an empty
  state with one action, an error that says what broke, and the full state. Route `loading.tsx` and `error.tsx` files;
  error copy keyed by code.
- **v2:** the same four states on the screens built so far (wardrobe, piece, sign-in, account). Each new screen brings
  its own.

**EX-06 Browser telemetry and consent** · v1 shipped · v2 new in v2 (consent)

- **v1:** PostHog through `/_ph`, with exception capture. Sentry through `/monitoring`, traces sampled at 0.2 in prod.
  No consent banner.
- **v2:** a telemetry consent banner, plus the browser relay into native Cloudflare telemetry (`styld-telemetry`).

**EX-07 Feature flags** · v1 shipped · v2 pending

- **v1, environment only:**
  - Server: `JEV_ENABLED`, `JEV_BUDGET_USD`, `SEGMENTATION_FIRST_ENABLED`, `AI_LANGUAGE_MODEL`, `TRY_ON_IMAGE_MODEL`,
    `PRODUCT_SHOT_BACKFILL_LIMIT`, `OPS_TELEGRAM_*`, `MCP_REVIEWER_*`, `ADMIN_EMAILS`.
  - Web: `NEXT_PUBLIC_AUTH_GOOGLE`.
  - Per person: auto product shots, auto detection, the automation cap.
  - No PostHog flags.

**EX-08 Rate limits** · v1 shipped · v2 partial

- **v1** (Redis fixed windows, failing open):
  - Sign-in: 10 per 15 minutes per IP. Forgot-password: 5 per hour. DCR: 10 per hour.
  - Signed-out catalog: 60 per minute. Follows: 60 per hour. Board visibility: 30 per 10 minutes. Pin saves: 120 per
    hour. Reports: 10 per hour. Blocks: 60 per hour. Feedback: 30 per day. Moderation: 3000 per day globally.
  - The limiter's `forgot-password` key doesn't match Better Auth's `/forget-password` path, and code sends aren't
    matched by any key.
- **v2:** code requests and DCR are limited (an attempt limiter plus the RateLimit binding). The rest arrive with
  their features.

**EX-09 Navigation** · v1 shipped · v2 partial

- **v1:**
  - Sidebar and mobile pill nav: Home, Shop, Boards, Wardrobe. Chat, profile and account are reached from menus.
  - The impersonation banner (ID-10), the usage widget (BI-11) and the "N running" indicator (SY-09).
- **v2:** Home, Wardrobe and You. Only built sections appear, and there are no placeholders.

---

## v1 gaps v2 should not inherit

These are behaviours v1 lacked or got wrong. Each is a decision for v2, not something to copy.

- **Data and privacy:**
  - No account deletion, although the privacy page promises it. v2 has it (ID-11).
  - No telemetry consent. v2 has it (EX-06).
  - Abandoned guest users are never cleaned up (ID-04).
- **Charging:**
  - Scans are charged per photo, but a scan that fails in the worker is not refunded (SC-01).
  - Members pay 5 credits for an automatic shot on the free manual add (SC-07). Scan shots ignore the automation
    settings (SC-04).
  - A try-on cache hit may still be charged (OU-06).
  - The week try-on batch refund key, `week-tryon:<outfitId>`, misses a second failure.
- **Missing controls:**
  - Scans cannot be cancelled or retried (SC-01).
  - The canvas has no undo (ST-06), and collages cannot be exported (ST-11).
  - No session list or revoke (ID-05), no password reset, no email change.
- **Limits and validation:**
  - Wishlist pieces count toward the free cap (WR-19).
  - The model-photo upload link has no type allowlist (OU-07).
  - The auth rate-limit keys don't match the real paths (EX-08).
- **Safety coverage:**
  - Outfit-check shares and shop edits are not moderated (SA-03).
  - Report actions are missing on several public surfaces (SA-01).
- **Dead or misleading parts:**
  - Dormant code: catalog AI classification (CA-03), `dashboard.getSuggestions` (OP-05), batch automations (BI-14),
    `retryFailedItem` and `splitItems` (WR-07, WR-08).
  - Unused data: the `subscription_usage` and `profile_tile` tables, and the `purchase_price` and `purchase_date`
    columns.
  - Copy with nothing behind it: the calendar quick prompts (SY-07) and most `calendar.*` strings.
  - Hard-coded English and stale copy: the Studio outfit ideas panel (ST-13).
- **The stylist** is never told the person's language (SY-03).

## Open questions about v1

These need an owner answer or a production check before v2 copies the behaviour.

1. **Production versus this baseline.** With PR #93 unmerged, production may lack R1–R5: MCP v4, signed-out browsing,
   the assistant panel and LiteLLM routing.
2. **Jev in production.** Whether `JEV_ENABLED` was set there decides whether OU-05, SY-06 and `recommend_outfits` were
   live.
3. **Referral reward.** Whether 3 credits survived the ×5 redenomination (OP-17).
4. **Lapsed members' purchased credits.** Whether they can be spent; the code calls this open (BI-02).
5. **Outfit check entry.** Whether its missing nav entry is deliberate (OU-10).
6. **Sharing rules.** Whether looks should keep working without a published profile while boards need one (OU-02,
   ST-12).
7. **Shop boards.** Whether they really need moderation approval to enter the feed (SA-05).
8. **Not live-tested in v1:** Google sign-in, real payment webhooks, PostHog ingestion, admin moderation and curation,
   and real ChatGPT/Claude host walks.

## Sources

- **Code:** v1 at `dddf9d44` (`apps/`, `packages/`, `docs/`, `integrations/`), read from a `git archive` export.
- **Handover notes:** v1's `docs/handover/2026-10-26-launch.md` and `2026-10-27-open-prs.md`.
- **Method:** four read-only inventory passes, one per slice: identity, billing and admin; wardrobe, scans and shops;
  studio, outfits and social; stylist, MCP and platform. Each feature was traced through its page, procedure, service
  and table.
- **v2 status** comes from `STATUS.md` and `DELIVERY.md` at `07e677e`.
