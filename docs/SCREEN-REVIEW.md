# Screen review: handoff

Read this to resume the screen review loop: review every screen of the preview, fix what the reviewers find, review
again. The owner asked for it on 31 October 2026: "critically review each screen… make a plan to fix each screen, and
then keep iterating until we get the perfect score for each screen", with before and after for each screen, Styld's
chat working end to end, and observability verified from the browser to the back end. The record of what was done is
in `docs/STATUS.md` › "Screen fix pass, observability and mood board resume — 2026-10-31".

## Where it stands (1 November 2026)

- **Preview release `8542cb4`**, read back, `bun run check` green (unit 545, native 27/27).
- **Last full review: round 13, on `a33e15b`.** Mean 9.79 over 39 screens, 32 at 10. Of the seven below 10:
  - Fixed in `8542cb4`, but not reviewed since:
    - wardrobe 7: the page overflowed small phones;
    - other-person 9, stylist 9.5 and stylist-new 9.5: LOW findings each.
  - Still open, in code the wardrobe-styling session owns, which said it would fix them:
    - home and home@desktop, 9.5 each: Spin is live on a worn day before the outfit engine answers; the desktop Spin
      round has no hover and its press uses a 420 ms spring;
    - wardrobe-filters, 8: the sheet skips the shared sheet body (no 12px inset, no `70dvh` scroll, unreachable in
      landscape); its actions are not a full-width primary with 8px between;
    - a sideways-overflow check on `/wardrobe` at 360px in the gallery journey.
- **Scores by round** (mean, screens at 10):

  | Round | Release            | Mean | At 10    |
  | ----- | ------------------ | ---- | -------- |
  | 1     | `ef12334`          | 5.8  |          |
  | 4     | `f642277`          | 9.6  | 22 of 38 |
  | 7     | `53b580a`          | 9.91 | 33 of 38 |
  | 10    | `7a2ca4f`          | 9.87 | 35 of 39 |
  | 11    | `5060247` (M1)     | 9.78 | 31 of 38 |
  | 12    | `ff26df9` (M2, M3) | 9.74 | 29 of 38 |
  | 13    | `a33e15b`          | 9.79 | 32 of 39 |

  Rounds 11 and later reviewed screens another session was reshaping (four tabs, no Wishlist, garment types, Home's
  outfit engine), so each round found new surface. Expect the same after new features land.

- **Open for the owner** (reviewers list these per screen as "Needs an owner decision", unscored):
  - `DESIGN.md` still describes the pre-M1/M2 shape: five tabs, the Wishlist screen, the profile's Pieces tab.
  - Derby shoes file as Trainers; Flats could say lace-ups.
  - Chips where the roadmap says group tabs.
  - The filter sheet has no prototype.
  - Season and occasion take one choice each.
  - Ask's search does not lead to Explore.
  - Old boards carry generated pictures of people.
  - One apostrophe style for English copy.
  - Report and Block for someone signed out.
  - The Styld model. Workers AI's DeepSeek holds a model call open in about 5 of 13 save-as-a-look turns; a 45 s
    deadline and the queue's retry recover it (`f4260a3`), and a retried reply saves its look once (`0914383`).
    Next experiments: cap the answer's length, or another model.

## The harness

The harness lives outside the repository, in `/home/kristjan/code/meta-hackathon/out/styld-design/`. Run every
command from there.

| Path                            | What it is                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `capture.ts`                    | `bun capture.ts <dir> [id…]`: every screen (phone 390×844 @2x, desktop 1440×900 @2x), signed in and out, to `<dir>/<id>.jpg` and `<id>-full.jpg`, with `manifest.json` (status, page errors, console errors, 5xx). Given ids, it recaptures only those and merges the manifest. The screen list and the ids it opens are at its top. |
| `stylist-e2e.ts`                | Styld's chat end to end: English starter with pieces, where the page rests (`restAfterReply`), save as a look, earlier chats, Slovenian answer and its wording (`pogled`, `kabl`, a gender for Styld or the person), then deletes the look. Receipt in `stylist-e2e/receipt.json`, shots beside it.                                  |
| `follow-e2e.ts`                 | Follow from sign-in: a bare `#follow` link and a sign-in link opened in another tab follow nobody; Follow pressed signed out then the tab signed in follows once; an unfollow holds through reload and Back. It leaves the person as found. Receipt in `follow-e2e/receipt.json`.                                                    |
| `telemetry-e2e.ts`              | A browser walk that checks every API call carries `traceparent` and a correlation id, and that trace exports answer 204. Writes `telemetry-e2e.json`.                                                                                                                                                                                |
| `build_page.py`, `site/`        | `AFTER_DIR=after<N> python3 -I build_page.py`, then `preview site --name styld-before-after`: the before/after page, `https://netcup.tail5acf67.ts.net/styld-before-after/`. It reads `review/scores.json`, `changes.json` and `meta.json`.                                                                                          |
| `make_prompts.py`               | `python3 -I make_prompts.py <round> <sha> after<N> after<N-1> <prev-sha> [notes.json]`: the three reviewer briefs, `/tmp/round<N>-{A,B,C}.txt`, from `review/prompt-template.md`. `notes.json` maps `A`, `B`, `C` or `all` to extra lines under "What to review": walks' receipts, new screens, milestones another session landed.   |
| `record_scores.py`              | `python3 -I record_scores.py <round>`: adds a round's scores to `review/scores.json` from the `SCORES {…}` line ending each report. Prints the mean and the screens below 10.                                                                                                                                                        |
| `review/`                       | `round3-groups.json` (the three groups' screens), `prompt-template.md`, every round's reports `round<N>-{A,B,C}.md`, `scores.json`, `changes.json` (what changed, per screen, shown on the page), `meta.json` (the page's summary lines).                                                                                            |
| `before/`, `after1/`…`after14/` | Captures: `before` is `ef12334`, `after13` is `a33e15b`, and `after14` is `after13` with the screens `8542cb4` changed recaptured.                                                                                                                                                                                                   |
| `tools/`                        | `readback.ts` (`/api/health`), `list-looks.ts` and `clean-e2e-looks.ts` (find and delete leftover "E2E check" looks), and probes for a piece's Back, the wardrobe's width and Styld's focus.                                                                                                                                         |

The signed-in screens and the walks use the preview test account `@kris.preview` through the Playwright storage state at
`/tmp/styld-preview-state.json`. Never print it. `/tmp` empties on a reboot. To recreate it, sign in as the test
account in a Playwright browser (email code), then `context.storageState({ path: '/tmp/styld-preview-state.json' })`
with mode 600. Ask the owner for the account's email if it is not to hand.

## One round

1. **Deploy what is to be reviewed**, from the main checkout with a clean tree (Alchemy builds the working files),
   following `docs/DEPLOYMENT.md`. Read back `/api/health` (`bun tools/readback.ts`).
2. **Capture:** `bun capture.ts after<N>`. Check `manifest.json` for problems; look at any new screen yourself.
3. **Walk, one after another, never beside the capture**: Styld disables New chat while a reply is written, and the
   capture's `stylist-new` step then fails.
   - `bun stylist-e2e.ts`, then `bun tools/list-looks.ts`. If "E2E check" looks are left, run
     `bun tools/clean-e2e-looks.ts`.
   - `bun follow-e2e.ts`.
   - `bun telemetry-e2e.ts`.
4. **Recapture Styld after the walk**, so its screens show a reply written by this release:
   `bun capture.ts after<N> stylist stylist@desktop looks`.
5. **Brief and start three reviewers.** Run `make_prompts.py`, then start three general-purpose agents in the
   background, each told only "Your full brief is in /tmp/round<N>-<G>.txt. Read it first and follow it exactly…".
   They are read-only, judge captures and `git show <sha>:path`, and end with a `SCORES {…}` line.
   - **Rubric:** each screen starts at 10; HIGH −3, MEDIUM −1.5, LOW −0.5. A systemic issue counts once, on its worst
     screen. Owner decisions are listed and not scored.
   - **Groups:**
     - A: home, explore, landing, login, account, profile and the people pages;
     - B: Ask, Styld and the boards;
     - C: wardrobe, filters, looks, piece, add and review.
6. **Record:** `python3 -I record_scores.py <N>`.
7. **Fix.** Check each finding in the code first, then fix it at its cause. Commit each coherent fix on main by
   explicit paths, with cheap checks per commit (typecheck, lint, the touched tests, `translations:check`,
   `duplicates:check`, `unused:check`, `assistant-views:check` after style changes). Run `heavy --wait bun run check`
   once per batch, then deploy.
8. **Page:** add what changed to `review/changes.json`, update `meta.json`'s summary, then build and publish.
9. **Tell the owner on Telegram** (mygram `message_send`, plain text): the round's mean, what changed, what is open.

## What to watch for

- **Coordinate with the other session.** Another Claude session (`styld-v2-wardrobe-styling`; check `ListAgents`)
  builds features in worktrees and lands them on main. Message it before deploying or touching its files. Ask it to
  hold its deploys and keep code out of main's tree until you send "deploy read back"; it asks the same of you. Hand
  findings in its code to it with the report's path; fix only what is yours, or a one-line fix it agrees to.
- **Briefs need context the captures lack.** A sheet open, a sign-in return, where a reply rests, focus, time zones
  and retries need walk receipts or probes. Tell reviewers which, and that Styld's words are live model output.
- **Give each new feature screen its own capture.** For example, `wardrobe-filters` taps Filters. Add each to a group
  in `review/round3-groups.json`, and tell its reviewer it is new ("(round N: new)").
- **Gates.**
  - Chain checks with `&&`, never `;`: a lint failure once slipped into a commit that way.
  - jscpd's threshold is 0%: identical style blocks fail, so compose with `cx` instead.
  - Files have a 500-line limit and functions 80.
  - `assistant-views:check` fails after style changes the assistant's views bundle; run
    `bun run assistant-views:generate`.
  - After a catalog edit, `bun run i18n:generate`. Slovenian copy says _ti_, in the present, never picking a gender;
    a catalog test enforces it.
- **Telemetry.** Workers Logs (Cloudflare MCP, `workers/observability/telemetry/query`): join a browser trace by
  `annotations.styld.browser.trace_id` for browser spans and `styld.browser.trace_id` for the server's `styld.http`
  logs. A failed Styld reply logs `Styld.Stylist model failed` with `styld.stylist.failure` (`TimeoutError`,
  `AiError`). Model call latency is in Analytics Engine: `SELECT … FROM StyldV2AiCalls WHERE blob5 = 'chat'` (blob4
  model, blob6 outcome, double1 milliseconds).

## When resuming after the new features

1. Read `docs/STATUS.md`'s newest entries and `git log` since `8542cb4`, to see what landed and what is deployed.
2. Check the other session's state (`ListAgents`, then a message) and agree the preview: who deploys, and when.
3. Update the capture set in `capture.ts` and `review/round3-groups.json`. Drop removed screens. Add new ones, for
   example My Gallery's pages, a piece with a back, an account with accessories, an empty wardrobe, someone's profile
   with the More sheet open, and a board with the Make sheet on sticker.
4. Run round 14 as above, comparing with `after14` (`8542cb4`). The first thing to confirm is that round 13's open
   items are fixed.
