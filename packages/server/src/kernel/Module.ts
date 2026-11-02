import type { Layer } from 'effect'
import type { Consumer } from '../jobs/Jobs.ts'
import type { Sweep } from '../jobs/Sweeps.ts'

// One module of the API Worker as the composition root lists it (`Modules.ts`): its services, its typed API groups,
// its plain routes, the queues it consumes and the sweeps it runs. Adding a module is one entry in that list.
//
// A module's layer is built over the kernel (`StyldWorker.ts` provides the database, media, queues, credits, pacing and
// providers once per runtime) and over the layers of the modules it uses, which it provides itself by reference: a
// layer is built once per build however many layers provide it, so every service has one instance. Its API groups,
// routes, consumers and sweeps read services from the whole application, whichever module owns them.

/** A module: the services it owns, and what of the Worker it serves. */
export interface Module<Services, Errors, Requires, Api, ApiRequires, Routes, ConsumerUses, SweepUses> {
  /** The services the module owns. */
  readonly layer: Layer.Layer<Services, Errors, Requires>
  /** The handlers of its typed API groups (`StyldApi`). */
  readonly api?: Layer.Layer<Api, unknown, ApiRequires>
  /** Its routes outside the typed API: images, files, public pages, OAuth, MCP, health. */
  readonly routes?: Layer.Layer<never, unknown, Routes>
  /** The queues it consumes. */
  readonly consumers?: ReadonlyArray<Consumer<ConsumerUses>>
  /** What it sweeps on the schedule. */
  readonly sweeps?: ReadonlyArray<Sweep<SweepUses>>
}

/** Define a module from the parts it has. */
export const module = <
  Services,
  Errors,
  Requires,
  Api = never,
  ApiRequires = never,
  Routes = never,
  ConsumerUses = never,
  SweepUses = never,
>(
  parts: Module<Services, Errors, Requires, Api, ApiRequires, Routes, ConsumerUses, SweepUses>,
) => parts

/** The services a module's consumers read from the application. */
export type ConsumerUsesOf<M> =
  M extends Module<infer _S, infer _E, infer _R, infer _A, infer _AR, infer _RR, infer Uses, infer _SU> ? Uses : never

/** The services a module's sweeps read from the application. */
export type SweepUsesOf<M> =
  M extends Module<infer _S, infer _E, infer _R, infer _A, infer _AR, infer _RR, infer _CU, infer Uses> ? Uses : never
