# Delivery status

Status: active, foundation deployed to an isolated workers.dev preview. Full parity is not achieved.

## Overnight run: sign-in, wardrobe, MCP — 2026-10-29

Plan: `/home/kristjan/.claude/plans/ticklish-popping-rivest.md` (owner-approved). One section per slice below.

- **S0 preflight.** The `RAILWAY_API_TOKEN` in the environment is refused by Railway (account, project and team token forms), so v1's Google client and email token could not be pulled; Google waits for the owner. Email needs no token: `styld.app` is in the same Cloudflare account as v2 and is already set up for sending, so v2 will use the `send_email` Worker binding (Alchemy `Email.SendEmail`, no DNS change; under `alchemy dev` it writes `.eml` files, which the native tests read). The deploy token can manage Queues; the Images API answered 403 (the Worker binding is tried at deploy). Non-browser clients (curl, Bun, a Python and an MCP user agent) reach the preview without Cloudflare's Error 1010, so MCP hosts can connect.
- **S1 spine.** New browser-safe `@styld/protocol` declares the typed API (`StyldApi`, effect HttpApi) once for the API Worker and the website; it may import only `@styld/auth`'s contract. `SessionHttp` (Yielded's `makeSessionHttpContract` on the `__Host-effect-auth-session` cookie) is the session requirement for endpoints; the API Worker implements it with Yielded's own session check and request middleware, so the typed API and the auth routes share one session rule. First endpoint: `GET /api/me`. The edge routes `/oauth` to the API Worker. Native test: `/api/me` refuses a signed-out request, returns the account after sign-in, and refuses after sign-out and after the account is disabled. Graph rules and tests cover the new package.

- **S2 OAuth issuer and MCP transport.** Styld is its own OAuth issuer for MCP, following the owner's myapps and goblin pattern on Yielded Auth: `OAuthServer.make('mcp')` (authorization code with PKCE S256, rotating refresh tokens, replay revokes the grant, RFC 9728 metadata) with one scope, `styld`. Grants, assertions and dynamically registered clients live in D1 (new migration). Dynamic client registration (RFC 7591) at `/oauth/mcp/register` admits public clients only, with exact https or loopback redirect URIs, narrows grant types instead of refusing them, and is rate-limited per IP; client metadata documents are accepted only from the exact hosted-client list in myapps (Claude, ChatGPT, Codex, VS Code). Authorization reads the website's own session cookie; without one it sends the visitor to `/login/connect` (page in S3). The edge now keeps the policy the API sets for a document it renders, so the consent page may post to the client's redirect. `/mcp` ports myapps' stateless transport: `@modelcontextprotocol/server` 2.4.0 loaded on first use, the 2026-07-28 era plus older eras on a per-request JSON transport, `GET` answered 405, a fresh server per request. Tools are noun_verb projections with closed inputs (an empty `Schema.Struct` would otherwise accept anything), refusals that name bad arguments without their values, and `{code, message, recovery, retryable}` errors; every call checks that the account is still enabled. First tool: `account_get`.
  - Evidence: unit tests (tool list and budgets, closed inputs, refusals, redirect policy, challenge, edge policy) and a native acceptance through the public edge: discovery, the 401 challenge, registration (custom scheme refused, grant types narrowed), the login redirect, sign-in, consent, the PKCE code exchange, the official SDK 2.x (2026-07-28) and 1.x (2025-11-25) clients listing and calling `account_get`, refresh rotation with replay ending the grant, revocation, and an account disabled mid-session losing access.
  - Deviations from myapps: opaque access tokens for up to 600 s checked against D1 (so revocation is immediate) instead of 900 s JWTs; no 30 s refresh grace; one scope instead of read/write. Yielded's default consent page is plain English HTML until S5 replaces it with Gallery copy from the catalogs; MCP and OAuth protocol text is excluded from x18n because it is written for assistants and OAuth clients.

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
