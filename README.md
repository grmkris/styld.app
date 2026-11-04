# Styld

Styld is a wardrobe app. You film your clothes rail or photograph your pieces, and Styld turns each garment into a
clean, shop-style picture you can browse, combine into looks and pin to boards. It runs at https://styld.app in
English and Slovenian.

Demo video: (link added at submission)

This repository is Styld v2, written during the Meta Global AI Developer Hackathon (26 October to 4 November 2026).
[Built during the hackathon](#built-during-the-hackathon) says what is new and what came from v1.

## What it does

- **Scan your clothes.** Film a rail or a pile for up to fifteen minutes, or take photos. The phone cuts a long video
  into parts. Meta SAM 3.1 finds every garment and tracks it through the video, and Styld cuts each one out of the
  sharpest, fullest frame it appears in. A garment seen in several parts becomes one card. A photo costs 1 credit and
  half a minute of video 5.
- **Pressed pictures.** Meta Muse Image 1.0 redraws the cut-out as a pressed, shop-style picture, for free. The real
  photo is kept and is one swipe away. A back is drawn only from a real photo of the back. A redraw, with an optional
  hint, costs 1 credit.
- **Turn a piece.** For 5 credits, Muse Image draws a strict side view from the front picture and Veo 3.1 Lite
  animates the piece turning on a hanger.
- **Wardrobe, looks and boards.** Browse by group, type and filter, build looks, and pin pieces, looks and pictures to
  boards with a collage. Muse Image paints a board's stickers from words (1 credit). The house boards
  (`@styld.women`, `@styld.men`) use garments generated with Muse Image, always labelled Generated.
- **Try on.** In the Lab, a person picks one of their own Gallery photos, confirms "This is me", and chooses up to nine
  pieces or a look. Muse Image redraws them wearing those pieces, for 2 credits. This is the only original photo Styld
  ever sends out.
- **Styld chat.** A chat at `/ask/stylist` that reads your wardrobe and looks through the same tools the MCP server
  offers, plus two of its own (`pieces_show`, `wardrobe_analyze`). A message costs 1 credit.
- **Claude and ChatGPT.** An MCP server at `https://styld.app/mcp`, with Styld as its own OAuth issuer. Assistants can
  read and edit the wardrobe and make looks and boards, and MCP Apps views show the wardrobe and boards inside the chat.
- **Accounts and credits.** Sign in with an email code or with Google. Everyone gets 100 free credits a day, and no
  card is asked for. Premium Week ($4.99 once, through Dodo Payments) raises that to 500 a day for 7 days.

## How Styld uses Meta's models

**SAM 3.1** finds the garments.

- Photos go inline and videos through Meta's Files API, and Styld reads the streamed Responses answer line by line.
  A video is streamed from storage to Meta without being held in memory, with its metadata blanked on the way, and
  deleted at Meta once tracked ([`providers/Meta.ts`](packages/server/src/providers/Meta.ts),
  [`capture/VideoPipeline.ts`](packages/server/src/capture/VideoPipeline.ts)).
- Styld asks for "clothing", plus "shoes", "bag" or "hat" for those kinds, and drops a mask that an earlier prompt's
  mask already covers ([`capture/GarmentRules.ts`](packages/server/src/capture/GarmentRules.ts)).
- SAM returns a mask raster of at most 1024 px on its long side, so Styld scales each mask to its box
  ([`providers/SamStream.ts`](packages/server/src/providers/SamStream.ts)). A guided filter then refines the edge
  within 3 px of SAM's ([`capture/Matte.ts`](packages/server/src/capture/Matte.ts)), and a video's cut-out comes from
  its best-ranked frame ([`capture/FrameRanking.ts`](packages/server/src/capture/FrameRanking.ts)).

**Muse Image 1.0** draws the pictures ([`providers/Muse.ts`](packages/server/src/providers/Muse.ts)).

- Edits: pressed pictures and backs from the cut-out, or from the photo after a refusal
  ([`capture/CleanPrompt.ts`](packages/server/src/capture/CleanPrompt.ts),
  [`capture/Drawing.ts`](packages/server/src/capture/Drawing.ts)); side views for turns
  ([`capture/TurnPrompt.ts`](packages/server/src/capture/TurnPrompt.ts)); and try-on from the person's photo plus up
  to nine pieces.
- Generations from words alone: board stickers and the house garments
  ([`generation/Painter.ts`](packages/server/src/generation/Painter.ts)).
- Muse draws each garment on flat green, or magenta for a green garment. Styld keys the background out, unmixes the
  edge colour so no fringe remains, and rejects a key that failed ([`Chroma.ts`](packages/imaging/src/Chroma.ts)).

Choices worth knowing:

- Styld calls the Standard model `muse-image-1.0`. Contributor variants would let Meta train on people's garments.
- Every Muse request switches off Muse's own image search, web search and shell tools, so only the pictures Styld
  sends reach it.
- Muse takes at most ten pictures in one request, so a try-on sends the person's photo and at most nine pieces.
- Every provider call goes through one wrapper (`providerCall` in [`providers/Call.ts`](packages/server/src/providers/Call.ts))
  with a deadline, a cost counter and an idempotency rule. A request that was sent but got no answer may have been
  billed, so Styld records an unknown outcome and never resends it on its own. Credits are held before paid work, and
  a known failure or a lost answer gives them back ([`usage/Holds.ts`](packages/server/src/usage/Holds.ts)).
- List prices Styld counts ([`providers/Costs.ts`](packages/server/src/providers/Costs.ts), read 29 to 31 October
  2026): Muse Image $0.01 a picture, SAM $0.0025 a photo and $0.0002 a video frame.

Not everything is Meta. Text tasks and the Styld chat use DeepSeek V4.1 Flash through a LiteLLM route
([`ai/LanguageModel.ts`](packages/server/src/ai/LanguageModel.ts)). Reading a garment's type, colours and sleeves, and
judging outfits, uses Cloudflare's Clef-flash on Workers AI ([`providers/Clef.ts`](packages/server/src/providers/Clef.ts)).
The turn video uses Veo 3.1 Lite through the Vercel AI Gateway ([`providers/Veo.ts`](packages/server/src/providers/Veo.ts)).

## Built during the hackathon

The hackathon ran from 26 October to 4 November 2026. This repository's first commit is from 28 October 2026 and its
latest from 4 November 2026. At the time of writing it has more than 900 commits, all by one author.

Size on 4 November 2026:

- 71,960 lines of TypeScript in `apps/` and `packages/`, not counting tests, generated modules or the translation
  catalogs, and 5,993 lines of tooling in `tools/`.
- 32,321 lines of tests in 206 files: 110 unit test files, 33 story tests, 33 scene tests, 28 native acceptance
  suites and 2 native tests.

Styld v1 existed before the event. It is a separate codebase with a handful of users, on a different stack, and it is
not in this repository. v2 is a rewrite from scratch that does not import v1's code. Code comments name the v1 behaviour
they keep. What v2 carried over from v1:

- The English and Slovenian catalogs started from v1's wording (2,296 strings per language). About 850 unused v1
  strings have been deleted since.
- The chroma-key checks in [`Chroma.ts`](packages/imaging/src/Chroma.ts) port v1's rules. The edge unmixing is new.
- The pressed-picture prompt keeps v1's product-shot rules ([`CleanPrompt.ts`](packages/server/src/capture/CleanPrompt.ts)).
- Product rules: the thirteen garment colours, report reasons and limits, and reserved handles.
- Google sign-in reuses v1's OAuth client and callback path, so the redirect registered for styld.app keeps working.
- [`tools/import-v1/`](tools/import-v1) brings v1 accounts' wardrobes into v2. It only reads from v1.
- The visual design ([`DESIGN.md`](DESIGN.md)) follows a prototype built in v1's repository on 30 October 2026,
  during the event.

[`docs/migration/v1-features.md`](docs/migration/v1-features.md) lists every v1 feature and what v2 did with it. The
provider experiments (from 27 October: model access, segmentation comparisons, prompt tests) ran in a separate private
workspace. Their findings are recorded in `docs/` and in code comments.

## Architecture

- **One public origin.** An edge Worker serves the static assets and routes `/api`, sign-in, media, OAuth and `/mcp`
  to the API Worker, and pages to the Foldkit server-rendering Worker, over service bindings.
- **The API Worker** is a list of modules over one kernel ([`Modules.ts`](packages/server/src/Modules.ts)). Each
  table in D1 has one owning module, and other modules write to it only through statements the owner exports.
- **Storage and jobs.** D1 through Drizzle, R2 for media, and Queues for captures, pictures, turns and generation
  jobs. A Durable Object per account holds the daily credit wallet (Alchemy Domain), and each chat is a Yielded Agent
  thread on its own Durable Object.
- **Stack.** Cloudflare Workers, with the infrastructure declared through Alchemy v2 ([`alchemy.run.ts`](alchemy.run.ts)).
  Effect 4 for services, typed errors and schemas, Foldkit for the web app, Yielded Auth for sign-in.
- **Evidence levels.** Unit tests (some over real SQLite), Foldkit story and scene tests, native tests that run the
  real Workers in workerd with Chromium through the edge, and a readback of the deployed release
  ([`tools/preview.native.test.ts`](tools/preview.native.test.ts)).
- **Gates.** `bun run check` runs format, typecheck (TypeScript and Effect diagnostics), lint, Knip, duplicate-code
  detection, translations, build, bundle budgets, unit tests and the native suite.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) records the decisions in force.

## Running it

```sh
bun install --frozen-lockfile
bun run check                    # every gate CI runs
bun run --cwd apps/web dev       # the Vite dev server for the web app
```

Deploying needs a Cloudflare account and provider keys (Meta, the LiteLLM route, the Vercel AI Gateway, and
optionally Google and Dodo). [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) covers the stages, the deploy and the readback.

## Docs for engineers

- [Status](docs/STATUS.md): what is live, the gates, what is built, open items
- [Delivery map](docs/DELIVERY.md): each kept feature and the tests and readbacks that prove it
- [Architecture](docs/ARCHITECTURE.md): the decisions in force
- [Roadmap](docs/ROADMAP.md): remaining scope
- [Handoff](docs/HANDOFF.md) and [Deployment](docs/DEPLOYMENT.md): how to resume, deploy, rebuild and import
- [Testing guide](docs/TESTING-GUIDE.md): what testers try and how to report a problem
- [Agent instructions](AGENTS.md): workflow, commands and the workspace map

## License

Styld's own code is under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for noncommercial use, no
commercial use. Vendored third-party code in `repos/` and `.agents/skills/`, and the dependency patches in `patches/`,
keep their own licences.
