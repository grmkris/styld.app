# Handoff — 31 October 2026

Styld v2 is a working product on an isolated preview, not yet on styld.app. In the last two days the boards, public
profiles and social plan (M0–M8) was built, reviewed three times and deployed. Alongside it, another session built
capture, clean pictures, turns, video scans and the in-app stylist (Styld). On 31 October the owner held a product
brainstorm that changes the priorities (below). The next session should reconcile the plan with that brainstorm before
building more.

## Start here

- **Repository:** `/home/kristjan/code/styldappv2` (`grmkris/styld.app`), branch `main`. Read `CLAUDE.md`,
  `docs/ROADMAP.md` (the owner's kept and parked scope), `docs/STATUS.md` (what changed, with evidence and open lists),
  `docs/DELIVERY.md` (the acceptance matrix), `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md`.
- **Preview:** https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev. `/api/health` names
  the running release (34b6449 at the time of writing, plus docs-only commits on main).
- **The plan behind M0–M8:** `~/.claude/plans/let-s-start-planning-go-soft-nova.md`. Design: the Gallery 2 prototype in
  `docs/design/gallery-2/`.
- **The 31 October brainstorm:** myplan note "04 Styld v2 product wrap-up — 31 October 2026"
  (https://myplan.lol/n/doc_2b9abdwck5zn303cvsxycsb7yc). The owner also has the raw transcript of that conversation and
  will hand it over directly. It is a private conversation: take product decisions from it, never copy its text into
  the repository, the preview or any public place.

## What is built

**Wardrobe and capture** (the capture session's area; details in STATUS and ROADMAP):

- Adding pieces from photos, the "hold it up" and "lay out" cameras, and video scans, through a review tray.
- Cut-outs, generated clean pictures, the hanger turn, and "Already in your wardrobe?" matching.
- Six top-level categories with subcategories.

**Boards (M1–M2):**

- A board is a grid of pins (pieces, looks, pictures) with one collage on top, edited by hand.
- Assistants build and arrange boards through MCP (`board_*`, `pin_*`, `picture_pin`, `collage_*`, `board_show`).

**Profiles, checks and public pages (M3):**

- A profile with a handle, published by choice. Public pages at `/@handle`, `/boards/:id`, `/looks/:id` and
  `/pieces/:id`, readable signed out, with link previews.
- Everything made public is checked by a model first: Clef-flash for pictures and Llama Guard 3 for words. Unsure stays
  out of discovery; failed is hidden, with a notice to the owner. A public piece shows only its cut-out or clean
  picture, never the original photo.

**People (M4):** Save, Follow (one-way, private), Block (both ways), Report (three reporters hide), and a "From people
you follow" feed on Home.

**Discovery (M5):**

- Explore: Edits from Styld, featured boards and people, then the newest boards, with mood chips.
- Search for people and boards. Admin-only curation tools for assistants, for accounts in `STYLD_ADMIN_EMAILS`.
- The five-tab navigation (Home, Explore, Ask, Wardrobe, Boards), and a landing page that shows public boards.

**Wishlist and links (M6):**

- A Wishlist tab in Wardrobe: Save to wishlist on someone's public piece, and Got it.
- Add from a link, on the website (a capture in the review tray) and for assistants (`link_import`, a piece directly).
  Shopify-style shops work; many large shops refuse Cloudflare's network, and Styld then asks for a photo.

**Generated pictures (M7):**

- On a board, "Make with Styld": one picture from words, or a mood board of 2–4 pictures from one sentence. Matching
  pieces are pinned and the collage is laid out.
- A Workers AI model plans, and Meta Muse Image paints. One credit per picture, held first, consumed once the picture
  is on the board, given back otherwise. Pictures are marked Generated.
- A live run made 3 pictures in 82 seconds for about $0.04. Assistant tools: `picture_generate`, `moodboard_make`,
  `generation_get`.

**Review (M8):**

- Three read-only reviewers: security, privacy and durability; architecture and tooling; a browser walk at phone and
  desktop sizes in English and Slovenian. They found about 40 problems.
- All high and medium ones are fixed and read back on the preview. STATUS has the list, the fixes and what stays open.

**Styld, the stylist chat** (the capture session's area): `/ask/stylist`, on Workers AI and a Durable Object, one
credit per message.

## The 31 October brainstorm, against what exists

The brainstorm's core is "shopping your own wardrobe": help people enjoy and reuse what they own.

**What it asks for:**

- **Browsing:** the wardrobe browsed like a shop, with finer garment types and filters.
- **My Gallery:** the person's own outfit photos, linked to their pieces.
- **Templates:** one board concept with task templates: one item many outfits, considering a purchase, and travel. All
  three share Make an outfit, Shuffle with an anchor, Add another outfit, Add from wardrobe, and export as an image.
- **Try-on:** a separate experiment history, after a quality test.
- **Publishing:** optional, per photo or board, with clickable garment details.
- **Delivery order:** the private styling workflow first, public discovery later.

The brainstorm inspected the repository at a850ba1 (30 October), 250 commits before the social work, so its "social is
parked" reading is out of date.

**What already fits:**

- Boards with real cut-outs and a collage.
- Private by default, with each board published by choice.
- Generated pictures marked as such and used only decoratively.
- Public piece pages reached from a board.

**What conflicts with what is live (to settle with the owner):**

1. **Wishlist:** it is a separate Wardrobe tab. The brainstorm makes it a board use case, the purchase template.
2. **Publishing a profile:** this shows its Pieces tab, the wardrobe, by default (`wardrobe_shown`). The brainstorm says
   publishing a post must not publish the whole wardrobe.
3. **Add from a link:** this puts the product into the wardrobe's review tray. The brainstorm says a possible purchase
   must not become owned.
4. **Order:** the public layer was built first (follow, feed, Explore, curation). The brainstorm wants the private
   workflow proven first.
5. **Generation:** "Make a mood board" generates pictures from a sentence. The brainstorm's priority is outfits anchored
   on real pieces, with decorative generation only as an extra.

**Not built yet:**

- My Gallery.
- The three templates, and outfit groups with Make, Shuffle and Keep.
- Exporting a board as an image.
- Finer garment types and filters.
- Brand, product-link and size fields on pieces.
- Try-on history.
- Clickable public garment details with brand and link.

**The brainstorm's recommended order:**

1. Wardrobe browsing and piece pages.
2. The "one item, many outfits" template on the existing board editor.
3. My Gallery.
4. The purchase and travel templates, and a try-on quality spike.
5. Public publishing, creators, and shops later.

**The brainstorm's own open decisions:**

- Where My Gallery and try-on sit in the navigation.
- The garment taxonomy, and whether custom categories exist.
- How several outfit groups lay out, and what Shuffle keeps.
- Where liked public posts live.
- Which public fields are shown, and what happens to a post when a linked piece changes.
- How weather is obtained for travel.

## Waiting on the owner

- **Profile name (privacy):** new profiles no longer start with the email sign-up name, which is the start of the email
  address. A profile published without a name shows its handle. This reverses an M3a decision; confirm it or revert it.
- **Curation access:** add the owner's email to `STYLD_ADMIN_EMAILS` in `.env.preview.local`. Never print that file;
  it holds secrets.
- **Hands-on checks:**
  - a board link pasted into WhatsApp or Slack, to see the preview card;
  - the board and curation tools in ChatGPT and Claude;
  - marking `@styld` as the house account, and filling its wardrobe so Explore has Edits from Styld.
- **Slovenian copy:** a review of the whole catalog. The screens people see now say "ti".

## Open technical work (STATUS has the full list)

- **Discovery rule:** one rule shared by Explore, search and the feed. Today the feed reads the link-level rules, so
  boards from a profile the check was unsure of can reach feeds, and Explore filters after its limit.
- **Missing tests:** native credit readback in the generation acceptance; tests that call the social, discovery and
  generation assistant tools.
- **Small fixes:**
  - page titles that name the board, piece or person;
  - focus kept inside sheets;
  - the collage editor's tray thumbnails;
  - sign-in links that return to the page;
  - signed-out pages that call session endpoints before redirecting.
- **Kept scope not built:**
  - a composed link-preview image;
  - follows and blocked lists on the website;
  - others' public pieces as credited pins;
  - a "people I follow" search filter;
  - the Save animation.
- **Checks:** calibration against real photos, and metering of check costs.
- **Lows:** link previews do not apply blocks; redirect bodies are not cancelled.

## How to work here

- **Branch and commits:** work on `main`, with one coherent green commit at a time, staged by explicit path. Never
  stash, reset or restore others' edits; never `git add -A`.
- **Worktrees:** keep feature work in `~/code/styldappv2.wt/<name>` (detached), then `git rebase main` and
  `git merge --ff-only <sha>` from the main checkout. Run `bun install --frozen-lockfile` in a new worktree.
- **Gates:** run `heavy --wait bun run check` once per batch, with cheaper checks per commit; exit 75 means the box is
  busy, so retry. Never pipe `heavy`. Never edit a worktree while its gate runs, because native runs in watch mode.
- **Native ports:** the native suite uses fixed ports 1337–1340, and so does another project on this box
  (media-studio). Check `ss -ltnp | grep -E ':(1337|1338|1339|1340)'` before starting one. Under heavy box load the
  gallery browser journey can time out; rerun before treating it as a failure.
- **Preview deploys:** these run only from the main checkout, where Alchemy's state lives, and only when its tree has
  no uncommitted work from anyone, because the build reads working files. The steps are in `docs/DEPLOYMENT.md`:
  build, dry-run, deploy, then read back `/api/health` and run `tools/preview.native.test.ts`.
- **Live readbacks:** sign in as the preview test account `@kris.preview` through Playwright storage state at
  `/tmp/styld-preview-state.json`. Never print it.
- **Coordination:** another Claude session works in this repository (it was named `universal-scan-capture-flow`; check
  `ListAgents`). Message it before generating a migration or touching shared files: `StyldWorker.ts`,
  `protocol/Api.ts`, the catalogs, `db/index.ts`, and `capture/*`.
- **Spending:** Muse costs about $0.01 a picture. Video generation spend needs the owner's approval.

## Suggested first task for the next session

1. Read the transcript and the wrap-up together. Settle the five conflicts and the brainstorm's open decisions with the
   owner, one real choice at a time.
2. Write the outcome into `docs/ROADMAP.md` as the owner's new direction and iteration order, replacing what it
   supersedes, and list in STATUS any live behaviour that has to change.
3. Plan the first iteration, likely wardrobe browsing and the "one item, many outfits" template, then build it in small
   green commits.
