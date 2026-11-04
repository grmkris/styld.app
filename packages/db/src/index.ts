// The application's tables, one file per owning module (`tools/patterns-check.ts` names who writes each). Yielded
// Auth's own tables are declared in `@styld/auth/storage`; Drizzle Kit reads both for the migrations: the baseline, then
// each change since.

export {
  accountDeletions,
  accounts,
  authAttemptBuckets,
  oauthAssertions,
  oauthClients,
  oauthGrants,
} from './identity.ts'
export { operationReceipts } from './receipts.ts'
export { pieceProvenance, pieces, uploads } from './wardrobe.ts'
export {
  captureFrames,
  captures,
  detections,
  pieceBackPictures,
  piecePictures,
  pieceTurns,
  providerFiles,
} from './capture.ts'
export { outfitPhotos, photoGarments } from './photos.ts'
export { lookPieces, looks } from './looks.ts'
export {
  boardImages,
  boardItems,
  boardOutfitPieces,
  boardOutfits,
  boardPins,
  boards,
  boardTags,
  boardTranslations,
} from './boards.ts'
export { blocks, follows, profiles, profileTranslations, reports, saves, viewerPreferences } from './social.ts'
export { contentChecks } from './safety.ts'
export { wornPieces } from './worn.ts'
export { generationJobs, generationPictures, generationPicks } from './generation.ts'
export { thinkingDays } from './outfits.ts'
export { stylistChats } from './stylist.ts'
export { paidAttempts, pendingSettlements } from './usage.ts'
export { importedPieces, importCopies } from './imports.ts'
export { seededBoards } from './seed.ts'
export { styleNotes, tasteAnswers } from './taste.ts'
