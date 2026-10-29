import { StyldApi } from '@styld/protocol'
import * as HttpApiClient from 'effect/http-api/HttpApiClient'
import { csrfHeader } from './StyldClient.ts'

/** The typed client, built from the API's own declaration. Loaded on first use: Home and sign-in never need it. */
export const makeApi = (origin: string) =>
  HttpApiClient.make(StyldApi, { baseUrl: origin, transformClient: csrfHeader })
