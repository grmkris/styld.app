# Publication evidence, 3 November 2026

- Stable URL: https://styld-review-07c26b483ccc.pages.dev
- Deployment: https://2cf76bbf.styld-review-07c26b483ccc.pages.dev
- Published 46 static files plus Pages `_headers`; no Functions, bindings, domains or application resources.
- Manifest: 51 findings, 21 tickets, 35 screenshots; reviewed code `d73475c`.
- Review JSON SHA-256: `141581822851b269b408ca3c31ff339e2da41f6c51f0f2872389ca8b76c4cf04`.
- Initial statuses: all findings and tickets `not_started`, no acceptance claimed.

## Checks actually run

- Build validates stable contiguous IDs, all findings covered by tickets, one workstream per ticket, progress IDs,
  statuses, checklist indexes and screenshot references. Three deliberately invalid progress fixtures (verified
  without evidence, missing ticket, nonexistent criterion) were correctly refused.
- Focused Oxlint and the pinned `tsrs` compiler passed `client.ts` with no suppressions.
- Complete `heavy --wait bun run check` exited 0 on the working tree based on `264fb5e`: 753 unit tests in 119
  files, 29 native tests, format/architecture/lint/type/bundle gates passed. Later document review fixes changed
  only the stage summary, source metadata, tap-target CSS, 404 styling and these delivery notes.
- Local and public Chromium journeys passed: all counts; workstream links; finding-to-ticket navigation; Back;
  search; empty results; Reset; search restored after reload; direct links overriding conflicting filters;
  every original image decoded; reading with JavaScript disabled; no page or console errors.
- Public layout checks covered 320, 375, 390, 768, 1440 and 1920px, with no document overflow. Related ID targets
  measured at least 44px in each dimension. Screenshots were visually inspected at phone and desktop sizes.
- Live HTTP 200, CSP with the inline script hash, `font-src 'self'`, noindex/nofollow/noarchive, nosniff,
  no-referrer and frame denial headers were read back. The browser ran under this deployed CSP.

## Review outcome

Hallmark's independent finish reviewer found two issues: stage copy could become inconsistent with updated
progress, and related-ID links had small tap targets. Both are resolved: the stage heading and note now live in
`progress.json.overview`, documented in the update workflow; related links have 44px targets. Architecture and
publication review found no additional isolation/security blocker.

Hallmark's rendered app-screen scan passed with zero failures or reflex findings. Four numeric-type warnings
were false positives: the selectors use the shared tabular-nums rule. Static source scanning flags seven emoji
occurrences in the original evidence (trash, magnifier and sparkle icons being discussed), plus source punctuation.
These are preserved quotations, not the tracker's iconography; preserving the user's report takes precedence
over rewriting that evidence to satisfy the style scanner. No decorative emoji were added to the UI.

This is browser and publishing evidence for the document. It is not live-provider, authenticated Styld,
physical-phone or acceptance evidence for any of the findings. No message was sent to Eva.
