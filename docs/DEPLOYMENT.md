# Deployment

The v2 stack is one Alchemy stack (`alchemy.run.ts`) deployed per **stage**. The stage's name decides the
deployment's facts (`packages/server/src/Resources.ts` › `stages`): `STYLD_ENV` and `VITE_STYLD_ENV`, whether search
engines may index it (the edge's `ROBOTS`), the Analytics Engine dataset its provider calls are counted in, and the
block of Workers RateLimit namespace ids its paces use. Any other stage name stops the plan.

| Stage          | Environment | Robots  | Analytics dataset           | Rate-limit namespaces | Deployed                                             |
| -------------- | ----------- | ------- | --------------------------- | --------------------- | ---------------------------------------------------- |
| `preview`      | preview     | noindex | `styld_preview_ai_calls`    | 2610281–2610289       | yes: the isolated workers.dev preview                |
| `production`   | production  | index   | `styld_production_ai_calls` | 2611001–2611009       | no: defined for the cutover, never created before it |
| `local`        | local       | noindex | `styld_local_ai_calls`      | 2619001–2619009       | `alchemy dev` on this machine                        |
| `local-native` | local       | noindex | `styld_local_ai_calls`      | 2619101–2619109       | the native suite, in workerd                         |

Only isolated v2 Cloudflare resources and the preview's workers.dev URL are authorized. Each stage has its own D1
database, R2 bucket (EU jurisdiction), queues and Durable Object namespaces; the API and SSR Workers have no public
URL, the edge Worker owns the workers.dev URL, and no custom domain is attached.

## State

Alchemy keeps the stack's state in the Cloudflare account's state store (`Cloudflare.state()`, Alchemy beta.85): a
Worker named `alchemy-state-store` with its token and encryption key in the account's Secrets Store, made on the first
deploy that uses it. Every operator's checkout plans against the same state; nothing is kept under `.alchemy/`. The
API token needs Workers, D1, R2, Queues, Secrets Store and Account Analytics permissions.

The preview was destroyed and deployed again on 2 November 2026 (release `54a6601`) and has been on the Cloudflare
state store since; any checkout plans against it. Stages deployed before C5 kept local state (`.alchemy/` in the
checkout that deployed them); none is left.

## Secrets and environment

The ignored `.env.preview.local` file (mode 600) holds the stage's secrets: `STYLD_AUTH_SECRET`,
`STYLD_AUTH_SESSION_KEYS`, `STYLD_AUTH_PROOF_KEYS`, `STYLD_AUTH_REQUEST_BINDING_KEYS`, `META_MUSE_API_KEY`,
`STYLD_AI_GATEWAY_API_KEY` (or `AI_GATEWAY_API_KEY`), `STYLD_LITELLM_URL`, `STYLD_LITELLM_KEY` and
`STYLD_ADMIN_EMAILS` (the admins' sign-in emails,
comma-separated: their assistants get the curation tools), `STYLD_HOUSE_EMAILS` (the house accounts' sign-in emails,
comma-separated; only they can be seeded, and unset means none can), `STYLD_GOOGLE_CLIENT_ID`, `STYLD_GOOGLE_CLIENT_SECRET` and `STYLD_AUTH_OAUTH_KEYS` (Sign in with Google: the owner
chose to reuse v1's OAuth client, the one exception to the rule below, and a dedicated keyring whose material is exactly
32 bytes; Google is offered only when all three are set, and the stage's `<origin>/api/auth/callback/google` must be
an authorised redirect on that client), and `STYLD_OPERATOR_TOKEN`, the operator's token for
administrative tasks from the operator's own tools, such as the v1 importer (`@styld/protocol` › Operator; at least 32
random bytes, made with `openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'`). `alchemy.run.ts` reads them at deploy
and binds them to the API Worker; `STYLD_ADMIN_EMAILS` unset means no admins, and `STYLD_OPERATOR_TOKEN` unset means no
operator, so no imports. The Worker keeps only the token's digest, and the operator's routes answer 404 to anything
but that token. `STYLD_DODO_API_KEY` and `STYLD_DODO_WEBHOOK_SECRET` (`whsec_<base64>`, the
webhook endpoint's signing secret) switch on the plans through Dodo Payments: test-mode values on the preview,
live-mode ones in production's file; with either unset the stage sells nothing (no plans, `/api/billing/*` answers
404). Which Dodo mode and products a stage uses are stage facts (`Resources.ts` `stages`, `billing.products`), passed
as `STYLD_DODO_BASE` and `STYLD_DODO_PRODUCT_WEEK`, `_MONTHLY`, `_YEARLY`, `_LIFETIME` only when both secrets are set:
test mode (local, local-native, preview) Week `pdt_0NrETRIgUh3xrUyRjyEj0`, Monthly `pdt_0NrEz2liX1IgFSWZolE8z`, Yearly
`pdt_0NrEz2tkNtmO0PD0FD5eQ`, Lifetime `pdt_0NrEz39MvC8AKJKfCaH5i`; live mode (production) Week
`pdt_0NrETRRmmoZUYS2pDknTg`, Monthly `pdt_0NrEz3KQr0QYLXvSL1brd`, Yearly `pdt_0NrEz3TWTGOn7dusahZie`, Lifetime
`pdt_0NrEz3c8ZxFnlKjVg0T7F`. Each mode's webhook endpoint is `<origin>/api/billing/dodo/webhook` and needs
payment.succeeded, refund.succeeded, dispute.lost and subscription.active, .renewed, .plan_changed, .cancelled,
.expired, .failed and .on_hold. The operator grants a lifetime membership by email (the owner, testers, the house
accounts, v1's hand-granted members; the list is the operator's, never the repository's):
`STYLD_URL=https://… bun --env-file=.env.<stage>.local tools/grant-membership.ts <email>`; granting again changes
nothing. `STYLD_RELEASE` (the commit) is
passed on the command line, as below. Keyrings are JSON with an `activeKeyId` and `keys`
of `{ id, material }`, material at least 32 random bytes as unpadded base64url. Never print the file, commit it, or use
v1 or production secrets in it. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` come from the environment (both:
a token alone falls back to the configured profile). Since 4 November 2026 every Styld stage lives in its own Cloudflare
account, `styld` (`849414470335f8f59091e26df5ae86c5`), which also holds the styld.app zone and its own v8 Alchemy state
store; the preview is `https://styldappv2-styldedge-preview-h42vz2fxetx2ymwx.styld.workers.dev`. Never deploy Styld to
the personal account (`bceaeae4788dce3493514fde194b4a7e`): its state store is v7 and shared with other projects, and
bootstrapping it to v8 breaks them. Set `CLOUDFLARE_ACCOUNT_ID=849414470335f8f59091e26df5ae86c5` before every deploy.

## Deploy the preview

After the owned changes are committed and `heavy --wait bun run check` is green:

```sh
STYLD_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy \
  --stage preview --env-file .env.preview.local --dry-run --no-input
STYLD_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy \
  --stage preview --env-file .env.preview.local --no-input --yes
```

Read the plan and final resource outcomes, not just the exit code (the pinned CLI has returned 0 on failed plans and
uploads). The deploy prints the edge `url` and the media bucket's name (`mediaBucket`). Read back Worker deployment
ids, bindings and public access settings, then:

```sh
STYLD_PREVIEW_URL="<edge url>" heavy --wait bun test tools/preview.native.test.ts
```

The readback fails unless `/api/health` names the commit being read back: HEAD of the checkout, or
`STYLD_EXPECTED_RELEASE=<sha>` when reading back an earlier deploy.

Cloudflare bot controls may answer Error 1010 to ad-hoc non-browser clients; use the browser acceptance path when
validating the public URL. The native suite (`heavy --wait bun run test:native`) runs the production Foldkit artifact in
workerd and includes Chromium acceptance; install the pinned browser with `heavy --wait bunx playwright install chromium`
if needed.

## House inspiration boards (the seed)

The house boards on `@styld.women` and `@styld.men` (`docs/archive/PLAN-house-boards-2026-11-04.md`) come from
`tools/seed/catalogue.yaml` and `tools/seed/manifest.yaml`, and are run by the operator with `tools/seed/Run.ts`. The
garments are generated with Meta Muse Image and judged by Muse Spark. Meta answers this box over IPv6 only, which the
tool's fetch uses. Every paid call is charged to `tools/seed/.out/ledger.json` before it is made, and a run stops
before the call that would pass `--max-usd` (default 5, across runs). The tool prints counts and ids, never keys.

1. **Dry run** (no network): counts, cached pictures, the cost of the rest, every board's garments and operation,
   the publish order, and the first of What's new under each Show me.

   ```sh
   bun tools/seed/Run.ts --manifest tools/seed/manifest.yaml --catalogue tools/seed/catalogue.yaml
   ```

2. **Test batch**: the manifest's ten test specs are generated and judged, with no import. Share
   `tools/seed/.out/test-batch.html` with `preview` and **wait for the owner's approval before `--full`**.

   ```sh
   bun --env-file=.env.preview.local tools/seed/Run.ts --manifest tools/seed/manifest.yaml --test-batch
   ```

3. **Full run**: generates what the catalogue needs and imports it into the house accounts as generated garments.
   Their provenance is written by the import, and they are never redrawn. Then it seeds the profiles and the boards
   in publish order, each pinned and laid out before it goes public. It waits for their checks and writes
   `tools/seed/.out/report.md`. A second run of the same catalogue generates, imports and changes nothing. The
   stage's `STYLD_HOUSE_EMAILS` must name the catalogue's emails.

   ```sh
   STYLD_URL="<edge url>" CLOUDFLARE_ACCOUNT_ID=<the stage's account> CLOUDFLARE_API_TOKEN=… R2_BUCKET="<mediaBucket>" \
     bun --env-file=.env.preview.local tools/seed/Run.ts --manifest tools/seed/manifest.yaml \
     --catalogue tools/seed/catalogue.yaml --full
   ```

4. **Curation**, signed in as an admin through the assistant's curation tools: `curation_house` for both handles,
   and the `curation_feature` calls the report lists for the featured boards.
5. **Taking boards down**: `--prune <seed id,…>` (with `--catalogue`) removes seeded boards, such as a fixture's or
   an entry the catalogue dropped.

The house garments stay generated (owner, 4 November 2026): there is no swap for a real photo.

## Rebuild and import (C5, and the production cutover)

The schema is the baseline migration and the migrations after it (`packages/db/migrations/`), which a deploy applies
in order. Alchemy records applied migrations in
`__alchemy_migrations` and refuses a database whose recorded history the files no longer contain
(`RewrittenMigrationHistoryError`), so a stage made before the baseline is **destroyed and deployed again**, never
migrated in place. Its D1 rows, R2 objects, Durable Objects (Wallets and Styld's chats, keyed by account id) and
queues go with it; v1's wardrobes are brought back by the importer. The production cutover runs the same steps against
`--stage production` with production's secrets.

1. **Export each v1 wardrobe** (read-only) into a private folder outside the repository, one folder per person.
   Needs v1's Railway Postgres URL and Tigris credentials in the environment; prints counts only.

   Tell the testers first: their v2-only data (boards, looks, photos, chats, sessions, assistant connections) goes,
   their v1 wardrobe comes back, the workers.dev URL may change, and afterwards they sign in with the usual email code
   (nothing is asked of them before the import).

   ```sh
   V1_DATABASE_URL=… V1_TIGRIS_ACCESS_KEY_ID=… V1_TIGRIS_SECRET_ACCESS_KEY=… V1_TIGRIS_BUCKET=… \
     bun tools/import-v1/Export.ts <their-email> ~/private/styld-v1/<person>
   ```

2. **Destroy the stage** (its state is in the Cloudflare state store, so any checkout can). It removes the edge, API
   and SSR Workers, the D1 database, the R2 bucket and its objects, the Durable Object namespaces and the queues.

   ```sh
   STYLD_RELEASE=destroy heavy --wait bunx alchemy destroy --stage preview --env-file .env.preview.local
   ```

   Read back that the account no longer lists `styldappv2-*-preview` Workers, the preview D1 database, bucket or
   queues.

3. **Deploy** this commit as above (the first deploy also makes the state store). Note the new edge `url` and
   `mediaBucket`, and read `/api/health` (its release is HEAD).

4. **Import each wardrobe by email**, as the operator: the importer reads `STYLD_OPERATOR_TOKEN` from the stage's
   env file, so no one signs in or copies anything out of a browser. The bundle goes through the R2 REST API with the
   API token that deploys:

   ```sh
   STYLD_URL="<edge url>" CLOUDFLARE_ACCOUNT_ID=<the stage's account> CLOUDFLARE_API_TOKEN=… R2_BUCKET="<mediaBucket>" \
     bun --env-file=.env.preview.local tools/import-v1/Import.ts ~/private/styld-v1/<person>
   ```

   The importer refuses placeholders and pictures that are not pictures into the report, uploads the bundle under
   `imports/<id>/`, and the server imports into the account the email signs in to, making it (verified email, no
   password) when there is none. Each piece has one receipt per v1 id, so running it again imports nothing twice.
   Pieces are cut out and described by Clef as they are imported, paid by Styld: the account's daily credits are not
   touched. The import queue runs one piece a delivery, two at once, under the Cloudflare Images rate that answered
   9529 at about ninety cut-outs a minute.

5. **Reconcile** each `report-<id>.json` in the private folder: `exported = ready + refused`, nothing failed or
   waiting (the last line says `reconciled`). A failed piece is re-run by running the importer again after the cause
   is fixed; a refusal is checked by hand against v1.

6. **Read back**: `STYLD_PREVIEW_URL=… heavy --wait bun test tools/preview.native.test.ts` (it checks that
   `/api/health`'s release is HEAD); each tester's wardrobe lists (every row decodes, or the list fails); no piece is left
   processing and the sweeps are idle in Workers Logs (`Styld.Sweep` lines with nothing moved); the Wallets hold no
   pending reservations (every hold settled). The private folders stay outside the repository; delete them once both
   testers confirmed their wardrobes.
