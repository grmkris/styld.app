import {
  ImportStarted,
  ImportStatus,
  type RemoveSeededBoard,
  SeedBoardStatus,
  type SeedBoardRequest,
  SeededBoard,
  SeededProfile,
  SeedPieces,
  type SeedProfile,
} from '@styld/protocol'
import { Schema } from 'effect'
import type { r2Bucket } from '../R2Rest.ts'

// The stage as the seed reaches it: the operator's import and seed endpoints through the public edge, with the
// stage's operator token, and its media bucket for the import's bundle. Answers are decoded with the contract's own
// schemas; a refusal is reported with what the server said.

/** The stage answered something other than success. */
class StageAnswered extends Schema.TaggedError<StageAnswered>()('StageAnswered', {
  status: Schema.Int,
  body: Schema.String,
  message: Schema.String,
}) {}

const byEmail = (email: string) => `email=${encodeURIComponent(email)}`

/** The operator's endpoints of the stage at `origin`. */
export const operatorApi = (origin: string, token: string) => {
  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<S['Type']> => {
    const response = await fetch(`${origin}/api/operator${path}`, {
      method,
      headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok)
      throw StageAnswered.make({
        status: response.status,
        body: text.slice(0, 500),
        message: `${method} ${path.split('?')[0] ?? ''} answered ${String(response.status)}`,
      })
    return Schema.decodeUnknownSync(schema)(text === '' ? undefined : JSON.parse(text))
  }
  return {
    startImport: (importId: string, operationId: string) =>
      call(ImportStarted, 'POST', `/imports/${importId}`, { operationId }),
    importStatus: (importId: string) => call(ImportStatus, 'GET', `/imports/${importId}`),
    pieces: (email: string) => call(SeedPieces, 'GET', `/seed/pieces?${byEmail(email)}`),
    profile: (request: SeedProfile) => call(SeededProfile, 'PUT', '/seed/profile', request),
    board: (seedId: string, request: SeedBoardRequest) => call(SeededBoard, 'POST', `/seed/boards/${seedId}`, request),
    status: (seedId: string, email: string) => call(SeedBoardStatus, 'GET', `/seed/boards/${seedId}?${byEmail(email)}`),
    remove: (seedId: string, request: RemoveSeededBoard) =>
      call(Schema.Undefined, 'DELETE', `/seed/boards/${seedId}`, request),
  }
}

export type OperatorApi = ReturnType<typeof operatorApi>
export type Bucket = ReturnType<typeof r2Bucket>
