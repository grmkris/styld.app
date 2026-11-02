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

Alchemy keeps the stack's state in the Cloudflare account's state store (`Cloudflare.state()`, Alchemy beta.84): a
Worker named `alchemy-state-store` with its token and encryption key in the account's Secrets Store, made on the first
deploy that uses it. Every operator's checkout plans against the same state; nothing is kept under `.alchemy/`. The
API token needs Workers, D1, R2, Queues, Secrets Store and Account Analytics permissions.

The preview was destroyed and deployed again on 2 November 2026 (release `54a6601`) and has been on the Cloudflare
state store since; any checkout plans against it. Stages deployed before C5 kept local state (`.alchemy/` in the
checkout that deployed them); none is left.

## Secrets and environment

The ignored `.env.preview.local` file (mode 600) holds the stage's secrets: `STYLD_AUTH_SECRET`,
`STYLD_AUTH_SESSION_KEYS`, `STYLD_AUTH_PROOF_KEYS`, `STYLD_AUTH_REQUEST_BINDING_KEYS`, `META_MUSE_API_KEY`,
`STYLD_AI_GATEWAY_API_KEY` (or `AI_GATEWAY_API_KEY`) and `STYLD_ADMIN_EMAILS` (the admins' sign-in emails,
comma-separated: they get the curation tools and may run imports). `alchemy.run.ts` reads them at deploy and binds
them to the API Worker; `STYLD_ADMIN_EMAILS` unset means no admins, so no imports. `STYLD_RELEASE` (the commit) is
passed on the command line, as below. Keyrings are JSON with an `activeKeyId` and `keys`
of `{ id, material }`, material at least 32 random bytes as unpadded base64url. Never print the file, commit it, or use
v1 or production secrets in it. `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` come from the environment (both:
a token alone falls back to the configured profile); the preview's account is `bceaeae4788dce3493514fde194b4a7e`.

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

## Rebuild and import (C5, and the production cutover)

The schema is one baseline migration (`packages/db/migrations/`). Alchemy records applied migrations in
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

4. **Import each wardrobe by email**. An admin's session (sign in on the new URL with an address in
   `STYLD_ADMIN_EMAILS` and copy the `Cookie` header of an `/api/` request); the bundle goes through the R2 REST API
   with the API token that deploys:

   ```sh
   STYLD_URL="<edge url>" STYLD_SESSION='<cookie header>' \
   CLOUDFLARE_ACCOUNT_ID=bceaeae4788dce3493514fde194b4a7e CLOUDFLARE_API_TOKEN=… R2_BUCKET="<mediaBucket>" \
     bun tools/import-v1/Import.ts ~/private/styld-v1/<person>
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
