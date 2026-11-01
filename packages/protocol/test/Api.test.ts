import { Schema, SchemaAST } from 'effect'
import { HttpApi, type HttpApiEndpoint } from 'effect/http-api'
import { describe, expect, test } from 'vitest'
import { StyldApi } from '../src/index.ts'

/** Every endpoint of the API, named `group.endpoint`. */
const endpoints: Array<{ readonly name: string; readonly endpoint: HttpApiEndpoint.Top }> = []
HttpApi.reflect(StyldApi, {
  onGroup: () => undefined,
  onEndpoint: ({ group, endpoint }) => endpoints.push({ name: `${group.identifier}.${endpoint.name}`, endpoint }),
})

/** Whether a write's payload names its operation. */
const takesOperationId = (endpoint: HttpApiEndpoint.Top) =>
  [...endpoint.payload.values()].some(
    (entry) =>
      'schemas' in entry &&
      entry.schemas.some((schema) => {
        const encoded = SchemaAST.toType(schema.ast)
        return (
          SchemaAST.isObjects(encoded) &&
          encoded.propertySignatures.some(({ name, type }) => name === 'operationId' && !SchemaAST.isOptional(type))
        )
      }),
  )

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

  test('every write takes an operation id, so a repeat answers the first request instead of doing it twice', () => {
    const writes = endpoints.filter(({ endpoint }) => endpoint.method !== 'GET')
    expect(writes.length).toBeGreaterThan(40)
    expect(writes.filter(({ endpoint }) => !takesOperationId(endpoint)).map(({ name }) => name)).toEqual([])
  })
})
