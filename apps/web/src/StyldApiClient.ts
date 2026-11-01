import { sessionAccountClient, StyldApi } from '@styld/protocol'
import { Effect } from 'effect'
import * as HttpApiClient from 'effect/http-api/HttpApiClient'

/** The typed client, built from the API's own declaration; `SessionAccount`'s client half sends the website's CSRF
 * header. Loaded on first use: Home and sign-in never need it. */
export const makeApi = (origin: string) =>
  HttpApiClient.make(StyldApi, { baseUrl: origin }).pipe(Effect.provide(sessionAccountClient))
