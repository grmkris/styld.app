import { describe, expect, test } from 'vitest'
import { trayCards } from '../src/capture/Captures.ts'
import type { CaptureRow, DetectionRow } from '../src/capture/Store.ts'

// The review tray's cards for the guided camera's front and back shots, which are cut out separately and become one
// piece once both are: until then the back never shows as a second piece of its own (owner's scan, 5 November 2026).

const at = new Date(0)

const capture = (id: string, status: CaptureRow['status'], pairing: Partial<CaptureRow> = {}): CaptureRow => ({
  id,
  accountId: 'ac_1',
  kind: 'photo',
  source: 'camera',
  status,
  uploadId: null,
  garmentId: null,
  originalKey: `${id}.jpg`,
  contentType: 'image/jpeg',
  bytes: 1,
  side: null,
  pairsWith: null,
  route: null,
  provider: null,
  providerFileId: null,
  frameCount: null,
  durationMs: null,
  width: null,
  height: null,
  credits: 1,
  attempt: 0,
  importId: null,
  trackingStartedAt: null,
  createdAt: at,
  updatedAt: at,
  ...pairing,
})

const detection = (id: string, captureId: string): DetectionRow => ({
  id,
  captureId,
  accountId: 'ac_1',
  status: 'review',
  cutoutKey: `${id}.png`,
  sourceKey: `${captureId}.jpg`,
  backCutoutKey: null,
  confidence: 0.9,
  preselected: true,
  suggestedType: 'jeans',
  suggestedAlternative: null,
  suggestedColours: ['blue'],
  suggestedSeasons: [],
  suggestedRainproof: false,
  suggestedCategory: null,
  suggestedOccasions: [],
  suggestedPattern: null,
  whole: 0.9,
  groupOf: null,
  duplicateOf: null,
  matching: null,
  matchClaimedAt: null,
  createdAt: at,
})

const back = (status: CaptureRow['status']) => capture('cp_back', status, { side: 'back', pairsWith: 'cp_front' })

const shown = (cards: ReturnType<typeof trayCards>) =>
  cards.map(({ capture: { id, status }, detections }) => [id, status, detections.map(({ row }) => row.id)])

describe('the tray with a camera’s front and back', () => {
  test('a back cut out before its front shows as still processing, not as a second piece', () => {
    const open = {
      captures: [back('review'), capture('cp_front', 'processing')],
      detections: [detection('dt_back', 'cp_back')],
    }
    expect(shown(trayCards(open))).toEqual([
      ['cp_back', 'processing', []],
      ['cp_front', 'processing', []],
    ])
  })

  test('once the front is cut out the back shows as it is, until it becomes the front’s back', () => {
    const open = {
      captures: [back('review'), capture('cp_front', 'review')],
      detections: [detection('dt_back', 'cp_back'), detection('dt_front', 'cp_front')],
    }
    expect(shown(trayCards(open))).toEqual([
      ['cp_back', 'review', ['dt_back']],
      ['cp_front', 'review', ['dt_front']],
    ])
  })

  test('a back whose front failed shows on its own, so the person can keep it', () => {
    const open = {
      captures: [back('review'), capture('cp_front', 'failed')],
      detections: [detection('dt_back', 'cp_back')],
    }
    expect(shown(trayCards(open))).toEqual([
      ['cp_back', 'review', ['dt_back']],
      ['cp_front', 'failed', []],
    ])
  })
})
