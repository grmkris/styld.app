import * as AuthClient from '@yielded/auth/Client'

import { AuthApi } from './config.ts'

/** Browser-safe transport definition. It owns one scoped credential lifetime;
 * callers should provide the layer for the lifetime of their Foldkit host. */
export const makeAuthClient = (baseUrl: string) =>
  AuthClient.make(AuthApi, {
    baseUrl,
    csrf: { header: 'x-effect-auth-csrf', value: '1' },
  })

export const authClientLayer = (baseUrl: string) => makeAuthClient(baseUrl).layerFetch
