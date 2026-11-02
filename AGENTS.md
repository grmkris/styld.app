# Styld v2

Read `docs/DELIVERY.md`, `docs/ARCHITECTURE.md` and `docs/STATUS.md` before substantial work. This is a clean rewrite that ports only the v1 behaviour worth keeping, not a demonstration or compatibility proxy; `docs/ROADMAP.md` holds the owner's kept and parked scope and the iteration order.

## Ownership and workflow

Work on main. Commit each coherent green change using explicit paths. Preserve concurrent work. Never stash, reset, restore foreign edits, bypass hooks, or replace unfinished features with placeholders. Run expensive work through `heavy --wait`; retain real exit status. Follow the machine-wide instructions in the parent workspace.

Only isolated v2 Cloudflare resources and a workers.dev preview are authorized. Preserve v1, production DNS, mail records and provider resources. Do not copy production personal data into a public preview. Keep all secret values outside Git and tool output.

## Commands

```bash
bun install --frozen-lockfile
heavy --wait bun run check          # the full gate CI runs: format, agents (skills), vendor (hashes), icons, x18n,
                                    # i18n, graph, patterns, style tokens, suppressions, canaries, typecheck, lint,
                                    # Knip, jscpd, build, budgets, unit, native
bun run format                      # oxfmt; cheap gates run directly: format:check, graph:check, unused:check
heavy --wait bun run typecheck      # effect-tsrs: TypeScript and Effect diagnostics
heavy --wait bun run lint           # Oxlint with the checksum-verified tsrs-lint backend
heavy --wait bun run test:unit
heavy --wait bun run test:native    # builds, then workerd + Chromium acceptance through the real edge
STYLD_PREVIEW_URL=… heavy --wait bun test tools/preview.native.test.ts  # deployed readback; release must be HEAD
bun run translations:check          # x18n; bun run i18n:generate after catalog edits
bun run icons:generate              # after editing apps/web/src/icons.json (Phosphor, DESIGN.md › Icons)
bun run --cwd apps/web dev          # Vite dev server; with the page open, foldkit_* MCP tools inspect it
```

`heavy` exit 75 means the box is busy; retry it, never treat it as a failure, and never pipe it. Deploying the isolated preview and reading it back follows `docs/DEPLOYMENT.md`.

The `foldkit-devtools` MCP server (`.mcp.json`) reads the running app's Model, Message history and Command arguments, time-travels, and dispatches Messages decoded against `Message`. It sees a Runtime only while the dev server runs and the page is open in a browser tab; the plain Vite server has no API Worker, so session reads fail there. Everything it returns enters the agent's context, so credentials and private data stay out of browser state (the password form keeps them in the DOM, never the Model).

## Stack

Use exact manifest/lockfile pins: Bun, Effect 4, Alchemy v2, Foldkit with `@foldkit/ui` headless controls, Yielded Auth, Drizzle SQLite/D1, Domain on Durable Objects, R2, native Cloudflare telemetry. Alchemy owns infrastructure. The single public origin serves pages, API, auth, media and MCP.

The `@yielded/effect-tsrs` gate checks TS and Effect. The editor uses pinned tsrs. Oxlint's type-aware backend is checksum-verified tsrs-lint with no fallback. Oxfmt formats. New code has zero lint debt. Keep anti-slop provenance, graph boundaries, suppression census, Knip and native runtime tests effective.

Read installed library source before using unfamiliar APIs. Domain models follow the pinned `.agents/skills/alchemy-domain` instructions. `repos/foldkit/` is a read-only snapshot of Foldkit at the installed release tag; refresh it with `bun tools/vendored.ts --pull foldkit foldkit@<version>` and its skills with `repoagents skills` on every Foldkit upgrade, never edit it. Its maintainers' instructions are renamed to `repos/foldkit/FOLDKIT_AGENTS.md` and its agent folders excluded: read them for Foldkit conventions only; they never override this file. `FOLDKIT.md` is Foldkit's own convention file for app code, copied verbatim from the snapshot: read it before Foldkit work. The pull refreshes it and `vendor:check` rejects edits; where it disagrees with this file (its `git subtree` commands, for one), this file wins. Vendored skills change only through `repoagents skills`. Record deviations from reference applications with reasons; do not inherit their product-specific approval or deployment policy.

## Workspace map

- `apps/web`: the Foldkit website (SSR entry, browser entry, pages, zyzz styles, browser telemetry and consent) and the MCP Apps views (`src/assistant`).
- `packages/protocol`: the contract shared by the website, the API and MCP: `StyldApi` groups, errors with their assistant guides, ids and operation ids, text, limits, prices, garments.
- `packages/server`: the public edge Worker and the API Worker: `kernel/` (database, ids, receipts, media, visibility, pacing, metrics), `Modules.ts` (the module list) and one folder per module (`wardrobe`, `capture`, `photos`, `looks`, `outfits`, `boards`, `generation`, `stylist`, `social`, `safety`, `links`, `worn`, `imports`, `mcp`), `usage/` (credit holds), `jobs/` (queues and sweeps), `providers/` and `ai/` (every provider call), `Config.ts` and `Resources.ts` (deployment facts and stages); native tests and fakes in `test/`.
- `packages/imaging`: PNG and raster helpers shared by the browser and the Worker (model pictures, chroma, sheets, turns).
- `packages/db`: Drizzle schema, one file per owning module, and the one baseline D1 migration.
- `packages/domain`: the Alchemy Domain Wallet (the daily credit pool's holds), with story tests.
- `packages/auth`: Yielded Auth contract, email-code sign-in, D1 persistence, browser client and password attempt limiter.
- `packages/i18n`: en/sl ICU catalogs and the runtime formatter; `packages/observability`: the bounded telemetry seam.
- `tools/`: the gates (`bun run check`), operator scripts listed in `knip.config.ts` (`import-v1/`, `provider-live.ts`, `preview-capture.ts`, `ai-usage-report.ts`) and the preview readback (`preview.native.test.ts`); `repos/foldkit`: read-only Foldkit reference; `FOLDKIT.md`: Foldkit's conventions; `docs/`: status, delivery map, architecture, roadmap, handoff, deployment, the testers' guide, `archive/` for history.

## Skills

Load the matching skill before the work; vendored skills are pinned in `.agents/skills/sources.json`.

- Code: `effect` (any Effect code), `foldkit` (UI programs; `generate-program`, `audit-program`), `alchemy-domain` (Domain models), `learn-alchemy`, `durable-objects`, `workers-best-practices`, `wrangler`.
- UI: `zyzz` and `DESIGN.md` (styling), `hallmark` (new pages, only when asked), `frontend-design`, `good-css`, `make-interfaces-feel-better`, `mobile-native`, `apple-web-app`, `apple-design`, `break-ui`; motion: `animate`, `review-animations`, `find-animation-opportunities`, `animation-vocabulary`.
- Copy and catalogs: `x18n`, `x18n-check`, `x18n-setup`, `unslop`.
- Telemetry and performance: `styld-telemetry`, `web-perf`.
- Planning, tests and review: `grilling`, `domain-modeling`, `test-behaviour`, `investigate-a-failure`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`.

This file, `DESIGN.md` and the local skills win where a vendored skill disagrees (for example a skill that suggests Tailwind, React or plain CSS files).

## Architecture and testing

One authoritative writer for each invariant. The Domain Wallet owns credit holds; D1 rows driven by queues own work lifecycles (captures, pictures, turns, generation jobs) and every relational entity. Typed application operations are shared by HTTP/MCP/jobs. Domain `decide`/`evolve` are pure. Durable reactions and provider calls have explicit idempotency and unknown-outcome handling.

Browser code imports contracts, never server adapters. Foldkit views are pure, updates emit named Commands, request state uses explicit schemas. Rendering receives locale, version, time zone and a stable reference time. Catalogs stay reviewed in Git.

Logs/spans omit tokens, signed URLs, prompts, images and raw user bodies. Native traces carry safe operation/release/correlation metadata; sampled telemetry is not the usage ledger.

Tests verify behavior, real storage semantics and public contracts. In-memory, native workerd, deployed preview and live-provider acceptance are different evidence levels. Every kept feature must be mapped to v2 implementation and acceptance; test counts alone do not prove a feature.

Before completion, run multiple reviewer rounds for architecture/tooling, security/privacy/durable behavior, and the actual browser product. Resolve findings, rerun final integration gates and verify the deployed release. Keep `docs/STATUS.md` factual and all unfinished requirements visible.

## Definition of done

A change is done when `heavy --wait bun run check` passes on the commit, touched code has zero lint, Effect and suppression debt, behaviour has a test at the right evidence level, `docs/STATUS.md` states what changed and what remains, and, for anything user-facing or deployed, the preview is redeployed and its acceptance and readback recorded. Never claim a feature done without its acceptance evidence in `docs/DELIVERY.md`.
