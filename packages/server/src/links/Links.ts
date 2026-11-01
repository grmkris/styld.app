import { LinkPicture, type ReadLink, Unavailable } from '@styld/protocol'
import { Context, Effect, Layer, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { Pacing } from '../kernel/Pacing.ts'
import { importedUpload, publicClient } from '../mcp/ImageImport.ts'
import { Wardrobe } from '../wardrobe/Wardrobe.ts'
import { pictureFromLink } from './LinkPicture.ts'

const LinkPictureJson = Schema.fromJsonString(LinkPicture)

const unavailable = () => Unavailable.make({})

/** What Styld fetches from the web for the person, at the account's `link` pace: a shop's product page and a photo's
 * address, each read into a received upload. The website, the assistants and Styld's tools share it. */
const make = Effect.gen(function* () {
  const wardrobe = yield* Wardrobe
  const pacing = yield* Pacing
  const http = yield* publicClient
  const fetched = <A, E, R>(work: Effect.Effect<A, E, R | HttpClient.HttpClient>) =>
    Effect.andThen(pacing.account('link'), work.pipe(Effect.provideService(HttpClient.HttpClient, http)))
  return {
    /** A shop's page read into an upload, answered once per operation id: a repeat neither reads the page again,
     * nor makes a second upload, nor counts against the pace. */
    readLink: Effect.fn('Styld.Links.readLink')(function* (input: ReadLink) {
      return yield* wardrobe.once(
        { operationId: input.operationId, command: 'readLink', input: input.url },
        {
          replay: (result) => Schema.decodeUnknownEffect(LinkPictureJson)(result).pipe(Effect.mapError(unavailable)),
          run: Effect.flatMap(fetched(pictureFromLink(wardrobe, input.url)), (picture) =>
            Effect.map(
              Schema.encodeEffect(LinkPictureJson)(picture).pipe(Effect.mapError(unavailable)),
              (result) => [picture, result] as const,
            ),
          ),
        },
      )
    }),
    /** The photo at an address as a fresh received upload of the person's. */
    photoFrom: Effect.fn('Styld.Links.photoFrom')(function* (address: string) {
      return yield* fetched(importedUpload(wardrobe, address))
    }),
  }
})

export class Links extends Context.Service<Links, Effect.Success<typeof make>>()('@styld/server/links/Links') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Links.of(service)),
  )
}
