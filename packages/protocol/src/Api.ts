import { SessionHttp } from '@styld/auth/config'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Me } from './Account.ts'

/** The signed-in person's account. */
export class AccountApi extends HttpApiGroup.make('account')
  .add(HttpApiEndpoint.get('me', '/me', { success: Me }))
  .middleware(SessionHttp.RequireSession)
  .prefix('/api') {}

/** Styld's typed HTTP API: declared once, served by the API Worker and called by the website. */
export class StyldApi extends HttpApi.make('styld').add(AccountApi) {}
