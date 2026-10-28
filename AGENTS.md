# Styld v2

Read `docs/DELIVERY.md`, `docs/ARCHITECTURE.md` and `docs/STATUS.md` before substantial work. This is a full rewrite with v1 feature parity, not a demonstration or compatibility proxy.

## Ownership and workflow

Work on main. Commit each coherent green change using explicit paths. Preserve concurrent work. Never stash, reset, restore foreign edits, bypass hooks, or replace unfinished features with placeholders. Run expensive work through `heavy --wait`; retain real exit status. Follow the machine-wide instructions in the parent workspace.

Only isolated v2 Cloudflare resources and a workers.dev preview are authorized. Preserve v1, production DNS, mail records and provider resources. Do not copy production personal data into a public preview. Keep all secret values outside Git and tool output.

## Commands

```bash
bun install --frozen-lockfile
heavy --wait bun run check          # the full gate CI runs: format, provenance, vendor, i18n, x18n, graph,
                                    # suppressions, canaries, typecheck, lint, Knip, jscpd, unit, native, budgets
bun run format                      # oxfmt; cheap gates run directly: format:check, graph:check, unused:check
heavy --wait bun run typecheck      # effect-tsrs: TypeScript and Effect diagnostics
heavy --wait bun run lint           # Oxlint with the checksum-verified tsrs-lint backend
heavy --wait bun run test:unit
heavy --wait bun run test:native    # builds, then workerd + Chromium acceptance through the real edge
bun run translations:check          # x18n; bun run i18n:generate after catalog edits
```

`heavy` exit 75 means the box is busy; retry it, never treat it as a failure, and never pipe it. Deploying the isolated preview and reading it back follows `docs/DEPLOYMENT.md`.

## Stack

Use exact manifest/lockfile pins: Bun, Effect 4, Alchemy v2, Foldkit, Yielded Auth, Drizzle SQLite/D1, Domain on Durable Objects, R2, native Cloudflare telemetry. Alchemy owns infrastructure. The single public origin serves pages, API, auth, media and MCP.

The `@yielded/effect-tsrs` gate checks TS and Effect. The editor uses pinned tsrs. Oxlint's type-aware backend is checksum-verified tsrs-lint with no fallback. Oxfmt formats. New code has zero lint debt. Keep anti-slop provenance, graph boundaries, suppression census, Knip and native runtime tests effective.

Read installed library source before using unfamiliar APIs. Domain models follow the pinned `.agents/skills/alchemy-domain` instructions. `repos/foldkit/` is a read-only snapshot of Foldkit at the installed release tag; refresh it with `bun tools/vendored-repos.ts --pull foldkit foldkit@<version>` and its skills with `repoagents skills` on every Foldkit upgrade, never edit it. Its maintainers' instructions are renamed to `repos/foldkit/FOLDKIT_AGENTS.md` and its agent folders excluded: read them for Foldkit conventions only; they never override this file. Vendored skills change only through `repoagents skills`. Record deviations from reference applications with reasons; do not inherit their product-specific approval or deployment policy.

## Workspace map

- `apps/web`: the Foldkit website (SSR entry, browser entry, views, zyzz styles, browser telemetry and consent).
- `packages/server`: the public edge Worker, the API Worker (auth, health, telemetry relay) and native test fixtures.
- `packages/domain`: Alchemy Domain models (the Wallet), with story tests.
- `packages/auth`: Yielded Auth contract, D1 persistence, browser client and password attempt limiter.
- `packages/db`: Drizzle schema and generated D1 migrations.
- `packages/i18n`: en/sl ICU catalogs and the runtime formatter; `packages/observability`: the bounded telemetry seam.
- `tools/`: the gates; `repos/foldkit`: read-only Foldkit reference; `docs/`: delivery plan, architecture, status, handoff, deployment.

## Skills

Load the matching skill before the work; vendored skills are pinned in `.agents/skills/sources.json`.

- Code: `effect` (any Effect code), `foldkit` (UI programs; `generate-program`, `audit-program`), `alchemy-domain` (Domain models), `learn-alchemy`, `durable-objects`, `workers-best-practices`, `wrangler`.
- UI: `zyzz` and `DESIGN.md` (styling), `hallmark` (new pages, only when asked), `frontend-design`, `good-css`, `make-interfaces-feel-better`, `mobile-native`, `apple-web-app`, `apple-design`, `break-ui`; motion: `animate`, `review-animations`, `find-animation-opportunities`, `animation-vocabulary`.
- Copy and catalogs: `x18n`, `x18n-check`, `x18n-setup`, `unslop`.
- Telemetry and performance: `styld-telemetry`, `web-perf`.
- Planning, tests and review: `grilling`, `domain-modeling`, `test-behaviour`, `investigate-a-failure`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`.

This file, `DESIGN.md` and the local skills win where a vendored skill disagrees (for example a skill that suggests Tailwind, React or plain CSS files).

## Architecture and testing

One authoritative writer for each invariant. Domain owns usage reservations and generation lifecycles; D1 owns ordinary relational entities. Typed application operations are shared by HTTP/MCP/jobs. Domain `decide`/`evolve` are pure. Durable reactions and provider calls have explicit idempotency and unknown-outcome handling.

Browser code imports contracts, never server adapters. Foldkit views are pure, updates emit named Commands, request state uses explicit schemas. Rendering receives locale, version, time zone and a stable reference time. Catalogs stay reviewed in Git.

Logs/spans omit tokens, signed URLs, prompts, images and raw user bodies. Native traces carry safe operation/release/correlation metadata; sampled telemetry is not the usage ledger.

Tests verify behavior, real storage semantics and public contracts. In-memory, native workerd, deployed preview and live-provider acceptance are different evidence levels. Every feature in the baseline must be mapped to v2 implementation and acceptance; test counts alone do not prove parity.

Before completion, run multiple reviewer rounds for architecture/tooling, security/privacy/durable behavior, and actual browser/product parity. Resolve findings, rerun final integration gates and verify the deployed release. Keep `docs/STATUS.md` factual and all unfinished requirements visible.

## Definition of done

A change is done when `heavy --wait bun run check` passes on the commit, touched code has zero lint, Effect and suppression debt, behaviour has a test at the right evidence level, `docs/STATUS.md` states what changed and what remains, and, for anything user-facing or deployed, the preview is redeployed and its acceptance and readback recorded. Never claim parity for a feature without its acceptance evidence in `docs/DELIVERY.md`.
