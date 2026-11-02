# Handoff — 2 November 2026

Styld v2 is a working product on an isolated workers.dev preview, not on styld.app. Feature work stopped on
1 November for a whole-repository cleanup: one pattern per concern, each with its gate, one baseline schema and a
preview rebuilt from scratch. The cleanup's code (C0–C6) is done, the preview was rebuilt on it, and C7 (gates and
docs) closes with this handoff. Next is C8, the review rounds and the release candidate the two testers get.
The previous handoff (31 October) is in `docs/archive/HANDOFF-2026-10-31.md`.

## Start here

- **Repository:** `/home/kristjan/code/styldappv2` (`grmkris/styld.app`), branch `main`. Read `CLAUDE.md`, then
  `docs/STATUS.md` (the preview, gates, what is built, open items, owner decisions), `docs/ARCHITECTURE.md` (decisions
  in force, the cleanup's patterns), `docs/DELIVERY.md` (feature → acceptance), `docs/ROADMAP.md` (remaining scope),
  `docs/DEPLOYMENT.md` (stages, state, the rebuild and import runbook).
- **Preview:** https://styldappv2-styldedge-preview-le7xsbk4pgfxkm7o.kristjan-grm11775.workers.dev, release `54a6601`
  per `/api/health`. The URL changed with the rebuild.
- **Cleanup plan:** `~/.claude/plans/i-activated-grilling-mode-frolicking-lovelace.md` (milestones C0–C8, exit
  criteria, the known bugs list).
- **Testers:** `docs/TESTING-GUIDE.md` is what the owner and the second tester read.

## Where things stand

- **Cleanup done:** a kernel under every module (`server/src/kernel/`), the API Worker as a module list
  (`Modules.ts`), one contract (errors with guides, ids, an `operationId` on every write, receipts), one credit policy
  (`usage/Holds.ts`; a lost provider answer refunds), one job runner and isolated sweeps (`jobs/`), one provider seam
  (`providers/`, `ai/LanguageModel.ts`), configuration as deployment facts only, fakes as layers, one garment pipeline,
  one baseline schema, stages, the v1 importer, and the website on one shell (`ServerData`, one operation-id maker,
  AsyncData loading).
- **Rebuild:** stage `preview` destroyed and deployed again with Alchemy state in Cloudflare. The owner's 74 v1 pieces
  imported as 73 plus 1 refused placeholder; the second tester's 313 were importing at the time of writing. Their
  report must reconcile (`exported = ready + refused`) and the readback in DEPLOYMENT step 6 be recorded in STATUS.
- **C7 (this round):** one vendored-hash gate, one `any` ban, one i18n parity owner, unused catalog keys as errors,
  cyclomatic complexity ≤ 20, explicit Knip entries for operator scripts (`tools/manual/`), split web and workers
  tsconfigs, the preview test checks the deployed release; STATUS, DELIVERY, ARCHITECTURE, ROADMAP and this file
  rewritten with their history archived in `docs/archive/`.
- **Frozen:** M4 template boards and export, M5 Before you buy, M6 Travel, M8 try-on test, M9 try-on. Their decisions
  are in the archived roadmap; their order comes from the testers' findings.

## What's next

1. **Finish the readback** of the rebuild: the second import's report, every wardrobe decodes, no pending holds,
   sweeps idle, `tools/preview.native.test.ts` (it now fails unless `/api/health` reports the commit read back).
2. **C8 review:** three reviewer rounds (architecture and tooling; security, privacy and durability: deletion paths,
   visibility, holds, unknown outcomes, rate limits; the browser product with `break-ui` and Slovenian). Fix, run the
   full gate, deploy, read back every DELIVERY row on phone and desktop in en and sl, including a forced provider
   failure and an unknown outcome in Workers Logs.
3. **Hand to the testers** with `docs/TESTING-GUIDE.md`; collect findings; decide the order of M4–M9 with the owner.
4. **Owner items** (STATUS › Owner decisions pending): gate 1's ratings, full-body photos for the try-on test, a worn
   photo for My Gallery's readback, the Flats/heels label, Styld's model and price.

## How to work here

- **Commits:** on `main`, one coherent green change at a time, staged by explicit path (`git commit -- <paths>`).
  Never stash, reset or restore others' edits; never `git add -A`.
- **Worktrees:** parallel work in a worktree (run `bun install --frozen-lockfile` there), then `git rebase main` and
  `git merge --ff-only` from the main checkout.
- **Gates:** cheap checks per commit; `heavy --wait bun run check` once per batch or milestone. Exit 75 means the box
  is busy; never pipe `heavy`; read the real exit code. Never edit a worktree while its native run is going.
- **Native ports:** the suite uses 1337–1340, as does another project on this box; check
  `ss -ltnp | grep -E ':(1337|1338|1339|1340)'` first. The gallery journey ("sideways scroll") can time out under box
  load: rerun it alone with `-t "lays out today"` before treating it as a failure.
- **Deploys:** `docs/DEPLOYMENT.md`. State lives in Cloudflare, but the build reads working files, so deploy only
  from a tree with no uncommitted work from anyone, with `STYLD_RELEASE` set to the commit, and read back after.
- **Schema:** one baseline migration; a later change is a new migration. Rewriting history means destroy, deploy and
  re-import (the runbook).
- **Secrets and data:** secrets only in the ignored `.env.preview.local` (never printed); v1 exports in a private
  folder outside the repository; no personal data or emails in the repository or logs.
- **Spending:** Muse about $0.01 a picture; video generation spend needs the owner's approval.
