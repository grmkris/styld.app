import { appSchema as coreSchema } from './schema.ts'
import { generationJobs, generationPictures } from './generation.ts'
import { blocks, follows, reports, saves, wishes } from './social.ts'
export {
  accounts,
  boardImages,
  boardItems,
  boardPins,
  boards,
  captureFrames,
  captures,
  contentChecks,
  detections,
  lookPieces,
  looks,
  oauthGrants,
  operationReceipts,
  piecePictures,
  pieceTurns,
  pieces,
  profiles,
  uploads,
  wornPieces,
} from './schema.ts'
export { generationJobs, generationPictures } from './generation.ts'
export { blocks, follows, reports, saves, wishes } from './social.ts'

/** Every table the application reads and writes. */
export const appSchema = {
  ...coreSchema,
  saves,
  follows,
  blocks,
  reports,
  wishes,
  generationJobs,
  generationPictures,
}
