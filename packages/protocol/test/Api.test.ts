import { Schema, SchemaAST } from 'effect'
import { HttpApi, type HttpApiEndpoint } from 'effect/http-api'
import { describe, expect, test } from 'vitest'
import { StyldApi } from '../src/index.ts'

/** Every endpoint of the API, named `group.endpoint`. */
const endpoints: Array<{ readonly name: string; readonly endpoint: HttpApiEndpoint.Top }> = []
HttpApi.reflect(StyldApi, {
  onGroup: () => undefined,
  onEndpoint: ({ group, endpoint }) => endpoints.push({ name: `${group.identifier}.${endpoint.identifier}`, endpoint }),
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

/** Writes that do not keep their operation id, each with why. Every other write answers a repeat from its receipt. */
const unkept = new Map([
  ['capture.check', 'reads a camera frame and stores nothing, so a repeat is the same reading'],
  ['account.deleteMe', 'ends the session it is asked in, so a repeat is signed out; deleting again changes nothing'],
  // Pending (C8): these take an id they do not keep yet; photos/, imports/ and capture/Turns.ts are another change's.
  ['photo.updatePhoto', 'pending'],
  ['photo.matchGarment', 'pending'],
  ['photo.offerGarment', 'pending'],
  ['photo.cutOut', 'pending'],
  ['import.startImport', 'pending'],
  ['capture.turnSheet', 'pending'],
])

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

  test('every write declares OperationConflict: its id is kept, and the same id with other input is refused', () => {
    const writes = endpoints.filter(({ name, endpoint }) => endpoint.method !== 'GET' && !unkept.has(name))
    const undeclared = writes.filter(({ endpoint }) =>
      [...endpoint.error].every((error) => Schema.resolveAnnotations(error)?.identifier !== 'OperationConflict'),
    )
    expect(undeclared.map(({ name }) => name)).toEqual([])
  })
})
