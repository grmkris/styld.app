// The stage's media bucket (EU jurisdiction) through Cloudflare's R2 REST API, for the operator's scripts that put a
// bundle under `imports/<id>/` for the server to read (`import-v1/Import.ts`, `seed/Run.ts`): write and delete one
// object, with the API token that deploys. The token is sent only as the Authorization header and never printed.

export interface R2Stage {
  readonly cloudflareAccount: string
  readonly bucket: string
  readonly token: string
}

/** The bucket's objects: written and deleted one at a time, waiting a little when the API paces a burst. */
export const r2Bucket = ({ cloudflareAccount, bucket, token }: R2Stage) => {
  const objects = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccount}/r2/buckets/${bucket}/objects`
  const headers = { authorization: `Bearer ${token}`, 'cf-r2-jurisdiction': 'eu' }
  const objectCall = async (method: 'PUT' | 'DELETE', key: string, init: { body?: BodyInit; type?: string } = {}) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${objects}/${key.split('/').map(encodeURIComponent).join('/')}`, {
        method,
        headers: { ...headers, ...(init.type === undefined ? {} : { 'content-type': init.type }) },
        ...(init.body === undefined ? {} : { body: init.body }),
      })
      if (response.ok) return
      // The API paces bursts; a few waits get past it.
      if (response.status !== 429 || attempt >= 8) throw new Error(`R2 ${method} answered ${response.status}`)
      await Bun.sleep(1000 * 2 ** Math.min(attempt, 5))
    }
  }
  return {
    write: (key: string, body: Uint8Array | string, options: { readonly type: string }) =>
      objectCall('PUT', key, { body: typeof body === 'string' ? body : Uint8Array.from(body), type: options.type }),
    delete: (key: string) => objectCall('DELETE', key),
  }
}
