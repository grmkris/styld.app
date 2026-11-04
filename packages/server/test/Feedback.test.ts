import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, FeedbackId, maximumFeedbackPerDay, SendFeedback } from '@styld/protocol'
import { Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { Feedback } from '../src/mcp/Feedback.ts'
import { Database } from '../src/kernel/Db.ts'
import { localD1 } from './LocalD1.ts'

// Assistants' notes about Styld over real SQLite: the same note the same day is one row counted again, thirty a day at
// most, admins read and mark them, and they go after 180 days.

const over = () => {
  const database = localD1()
  database.sqlite.exec(
    `INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 'r', 'Ana', 0);`,
  )
  return Layer.mergeAll(
    Feedback.layer.pipe(Layer.provide(Database.layer(database))),
    Layer.succeed(CurrentAccount, { accountId: 'ac_1', via: 'assistant' as const }),
  )
}

const note = { kind: 'problem' as const, message: 'piece_add did not answer', tool: 'piece_add' }

describe('assistants’ notes', () => {
  it.effect('keep the same note once a day, counted, for admins to read and mark handled', () =>
    Effect.gen(function* () {
      const feedback = yield* Feedback
      yield* feedback.send(note)
      yield* feedback.send(note)
      yield* feedback.send({ kind: 'idea', message: 'Show outfits as a collage' })
      const open = yield* feedback.list('open')
      expect(
        open.map(({ message, count }) => [message, count]).toSorted(([a], [b]) => String(a).localeCompare(String(b))),
      ).toEqual([
        ['piece_add did not answer', 2],
        ['Show outfits as a collage', 1],
      ])
      const first = open.find(({ tool }) => tool === 'piece_add')
      yield* feedback.setStatus(FeedbackId.make(first?.id ?? ''), 'handled')
      expect((yield* feedback.list('handled')).map(({ id }) => id)).toEqual([first?.id])
      expect(yield* Effect.flip(feedback.setStatus(FeedbackId.make(`fb_${'x'.repeat(22)}`), 'open'))).toMatchObject({
        _tag: 'NotFound',
      })
    }).pipe(Effect.provide(over())),
  )

  it.effect('refuse past thirty a day', () =>
    Effect.gen(function* () {
      const feedback = yield* Feedback
      for (let at = 0; at < maximumFeedbackPerDay; at += 1) yield* feedback.send(note)
      expect(yield* Effect.flip(feedback.send(note))).toMatchObject({ _tag: 'LimitReached', limit: 'feedback' })
    }).pipe(Effect.provide(over())),
  )

  it.effect('are forgotten after 180 days', () =>
    Effect.gen(function* () {
      const feedback = yield* Feedback
      yield* feedback.send(note)
      yield* TestClock.adjust('181 days')
      expect(yield* feedback.sweep()).toBe(1)
      expect(yield* feedback.list('open')).toEqual([])
    }).pipe(Effect.provide(over())),
  )

  it('tells the assistant the note’s limits in the tool’s schema, not only when it refuses', () => {
    expect(Schema.toJsonSchemaDocument(SendFeedback).schema).toMatchObject({
      properties: { message: { type: 'string', maxLength: 1000, minLength: 2 } },
    })
  })
})
