import { Effect, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { catalogVersion } from '@styld/i18n'
import { Locale, localeEndpoint, parseLocale } from './Locale.ts'

export const Flags = Schema.Struct({
  locale: Locale,
  catalogVersion: Schema.Literal(catalogVersion),
  timeZone: Schema.String,
  referenceTime: Schema.Number,
  pathname: Schema.String,
})
export type Flags = typeof Flags.Type

export const LocaleSave = defineTaggedUnion({ Saved: {}, Saving: { locale: Locale }, Failed: {} })
export const Model = Schema.Struct({ context: Flags, localeSave: LocaleSave })
export type Model = typeof Model.Type
export const Message = defineMessageUnion({
  SelectedLocale: { value: Schema.String },
  SucceededSaveLocale: { locale: Locale },
  FailedSaveLocale: {},
})
export type Message = typeof Message.Type

export const SaveLocale = Command.define('SaveLocale', {
  args: { locale: Locale },
  messages: [Message.SucceededSaveLocale, Message.FailedSaveLocale],
  execute: ({ locale }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      yield* HttpClient.filterStatusOk(client).execute(
        HttpClientRequest.post(localeEndpoint).pipe(HttpClientRequest.bodyUrlParams({ locale })),
      )
      return Message.SucceededSaveLocale({ locale })
    }).pipe(Effect.catchTag('HttpClientError', () => Effect.succeed(Message.FailedSaveLocale()))),
})

export const init = (context: Flags): Update.Return<Model, Message, HttpClient.HttpClient> => ({
  model: { context, localeSave: LocaleSave.Saved() },
})

export const update = (model: Model, message: Message): Update.Return<Model, Message, HttpClient.HttpClient> =>
  Message.match(message, {
    SelectedLocale: ({ value }) => {
      const locale = parseLocale(value)
      if (locale === undefined || LocaleSave.guards.Saving(model.localeSave)) return { model }
      return { model: { ...model, localeSave: LocaleSave.Saving({ locale }) }, commands: [SaveLocale({ locale })] }
    },
    SucceededSaveLocale: ({ locale }) => ({
      model: { ...model, context: { ...model.context, locale }, localeSave: LocaleSave.Saved() },
    }),
    FailedSaveLocale: () => ({ model: { ...model, localeSave: LocaleSave.Failed() } }),
  })
