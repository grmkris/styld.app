import { Effect, Layer } from 'effect'
import { Boards } from '../boards/Boards.ts'
import { type D1Binding, Database } from '../kernel/Db.ts'
import { Media } from '../kernel/Media.ts'
import { Looks } from '../looks/Looks.ts'
import { CheckQueue, Checks } from '../safety/Checks.ts'
import { PieceChanged } from '../safety/PieceChanged.ts'
import { Worn } from '../worn/Worn.ts'
import { Curation } from './Curation.ts'
import { Discovery } from './Discovery.ts'
import { Profiles } from './Profiles.ts'
import { PublicPages } from './Public.ts'
import { Social } from './Social.ts'

// The services of what people make and show each other: checks, looks, worn days, profiles, public pages, social,
// discovery, curation and boards, each from its own layer, built once over the application's database, media and
// check queue. The content judge and the call counter come from the composition's providers.

/** What the modules are built over. */
export interface ModuleBindings {
  readonly database: D1Binding
  readonly media: Media['Service']
  readonly checksQueue: CheckQueue['Service']
}

/** Every module service, layered by what each needs. */
export const socialModules = (bindings: ModuleBindings) =>
  Layer.mergeAll(Boards.layer, Social.layer, Discovery.layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(Looks.layer, PublicPages.layer, Profiles.layer, Curation.layer, Worn.layer, PieceChanged.layer),
    ),
    Layer.provideMerge(Checks.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        Database.layer(bindings.database),
        Media.layer(bindings.media),
        CheckQueue.layer(bindings.checksQueue),
      ),
    ),
  )

/** The module services, built once, for the parts of the composition that take services rather than layers. */
export const socialServices = (bindings: ModuleBindings) =>
  Effect.all({
    checks: Checks,
    pieceChanged: PieceChanged,
    looks: Looks,
    boards: Boards,
    worn: Worn,
    profiles: Profiles,
    publicPages: PublicPages,
    social: Social,
    discovery: Discovery,
    curation: Curation,
  }).pipe(Effect.provide(socialModules(bindings)))
