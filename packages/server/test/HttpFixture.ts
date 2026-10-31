import { Effect } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

/** An HTTP client that answers from a table of URLs, and 404 for any other. */
export const serving = (routes: Record<string, () => Response>) =>
  HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(request, (routes[request.url] ?? (() => new Response(null, { status: 404 })))()),
    ),
  )
