# Eva review tracker

Shared document: https://styld-review-07c26b483ccc.pages.dev

This independent Cloudflare Pages document contains 51 findings, 21 original ticket drafts and 35 screenshots
from the 2 November 2026 review. It adds eight workstreams and preliminary code-review notes. The first easy-fix
batch is deployed to the isolated preview; `progress.json` records completed and partial scope. Priority and effort labels remain inputs to planning, not commitments.

The owner approved a public URL and the screenshots on 3 November. Anyone with the link can view them;
the random project name and noindex headers are not access controls. No message has been sent to Eva.

## Update the shared document

1. Edit `progress.json`, including `overview.label` and `overview.note` when the overall stage changes. Keep ticket and finding statuses independent: closing a ticket does not automatically
   prove every related finding resolved. Set the owner, date, note and acceptance evidence for each changed item. Every status change requires a note.
2. Append an entry to `updates`, with `date`, `text` and the affected `items` IDs. Update the top-level `updatedAt`.
3. Build and check the result. Commit the owned source files, then deploy with the command below. Redeployment
   updates the same URL. There are no browser-only status edits, database or account requirements.

```sh
python3 docs/research/eva-review-tracker/build.py
python3 docs/research/eva-review-tracker/deploy.py
```

The deploy command uses Bun, pinned Wrangler 4.154.0, the account/project in `deployment.json`, and an existing
`CLOUDFLARE_API_TOKEN` in the environment. It builds into a fresh temporary directory and uploads only those
assets. Run with network access. It does not deploy Styld, provision bindings or change DNS. The Pages project
was created once with production branch `main`; normal updates only deploy it.

## Source files

- `review.json`: all findings, ticket drafts, original priorities, screenshots and explicit checklists. Preserve
  original IDs and wording. New tickets use the next ID. Add tracked checklist criteria during planning where
  the original acceptance requirements are prose. Never silently rewrite the historical draft.
- `analysis.json`: the code snapshot, workstreams, preliminary effort, implementation observations and code
  pointers. Refresh the snapshot and affected notes when the code changes. These notes do not establish live
  reproduction or acceptance.
- `progress.json`: shared statuses, owners, notes, evidence and append-only update entries.
- `evidence/`: the 35 original PNGs, copied so the site can be rebuilt without the untracked original report.
- `template.html`, `styles.css`, `client.ts`, `build.py`: static document and progressive navigation/search.
  TypeScript is transpiled by Bun. `hanken.woff2` is Hanken Grotesk 5.3.0's Latin subset; see `FONT-LICENSE.txt`.
- `deployment.json`, `deploy.py`: isolated Pages destination and reproducible publishing command.

The source report is `../eva-product-review-2026-11-02/README.md`. Its introductory personal email and
machine-local recording paths are omitted. The original report remains untracked and is not uploaded.

## Progress and evidence

Allowed statuses: `not_started`, `planned`, `in_progress`, `blocked`, `ready_for_review`, `verified`, `deferred`.
Mark implementation awaiting acceptance as `ready_for_review`. Use `verified` only when the ticket's acceptance
requirements have been met at their required levels, then record a note and evidence. Evidence levels are
`unit`, `native`, `preview`, `live_provider`, `user_review`; each entry needs a date and summary, and may link to
an HTTPS receipt. The builder enforces evidence presence, not whether the evidence proves the product works.

`criteriaDone` contains zero-based indexes into a ticket's `criteria` list. All explicit criteria must be complete
before `verified`. A ticket whose acceptance is prose still requires human review against that prose. Finding
verification remains separate. Do not mark all findings resolved just because the app builds.

Every completed ticket must include **before and after screenshots**, at matching viewports, in its own
`comparisons` list. Store captures under `evidence/<batch>/`, with separate `before` and `after` paths relative
to `evidence/`, plus `title`, `width`, `height`, `date`, `level` and a `note` explaining the fixture and evidence
boundary. The builder checks both PNG files, matching widths and viewport heights and refuses `verified`
tickets without comparisons. Full-page image heights may differ as content changes. Use native test fixtures,
not private account data; identify emulated viewports separately from real-device or deployed evidence.
Partial tickets can include comparisons while remaining open.

```json
{
  "status": "ready_for_review",
  "owner": "Kris",
  "updatedAt": "2026-11-03",
  "note": "Describe what changed and which acceptance remains.",
  "evidence": [{"level": "native", "date": "2026-11-03", "summary": "Describe the behavior actually checked."}],
  "criteriaDone": []
}
```

The example is a data shape, not a claim that any work has been done.

## Validation

The builder checks IDs, finding coverage, workstream assignment, progress, explicit checklist indexes and image
references. `manifest.json` records counts, the code snapshot and a SHA-256 digest of the review data.

Before publishing an update, check search, workstream/status filters, reset, ticket/finding deep links, Back,
small-screen layout and the modified records. Keep all content readable without JavaScript. All fonts, CSS,
data and screenshots are served from the same Pages origin. A hashed-script CSP permits only the generated
navigation script; no analytics or external requests are included.
