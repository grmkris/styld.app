import { Schema } from 'effect'
import { HttpApi, type HttpApiEndpoint } from 'effect/http-api'
import { describe, expect, test } from 'vitest'
import { StyldApi } from '../src/index.ts'

/** Every endpoint of the API, named `group.endpoint`. */
const endpoints: Array<{ readonly name: string; readonly endpoint: HttpApiEndpoint.Top }> = []
HttpApi.reflect(StyldApi, {
  onGroup: () => undefined,
  onEndpoint: ({ group, endpoint }) => endpoints.push({ name: `${group.identifier}.${endpoint.name}`, endpoint }),
})

describe('StyldApi', () => {
  test('every error an endpoint declares says how it reads to an assistant', () => {
    expect(endpoints.length).toBeGreaterThan(50)
    const unguided = endpoints.flatMap(({ name, endpoint }) =>
      [...endpoint.error]
        .filter((error) => Schema.resolveAnnotations(error)?.guide === undefined)
        .map((error) => `${name}: ${Schema.resolveAnnotations(error)?.identifier ?? 'an error'}`),
    )
    expect(unguided).toEqual([])
  })
})
