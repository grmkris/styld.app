import { CurrentAccount, type DeleteCategory, type RenameCategory } from '@styld/protocol'
import { Context, Effect, Layer } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { WardrobeStore } from './Store.ts'
import { spelled } from './Shared.ts'

// The person's own categories under a type (owner, 2026-11-03, T-12). A category lives on its pieces: renaming moves
// them to the new name, deleting leaves them under the type alone, and one with no pieces is gone.

const make = Effect.gen(function* () {
  const store = yield* WardrobeStore
  return {
    /** Rename one of the person's categories under a type, once per operation id: its pieces move to the new name,
     * and join a category already called so. */
    rename: Effect.fn('Styld.Categories.rename')(
      function* (input: RenameCategory) {
        const { accountId } = yield* CurrentAccount
        const { operationId, ...change } = input
        const write = Effect.gen(function* () {
          const to = yield* spelled(accountId, change.type, change.to)
          return {
            statements: [store.recategorise(accountId, change.type, change.name, to, yield* nowDate)],
            result: to,
          }
        })
        yield* store.recorded(
          { accountId, operationId, command: 'renameCategory', input: change },
          { write, answer: () => Effect.void },
        )
      },
      Effect.provideService(WardrobeStore, store),
    ),
    /** Delete one of the person's categories under a type, once per operation id: its pieces stay, under the type
     * alone. */
    delete: Effect.fn('Styld.Categories.delete')(function* (input: DeleteCategory) {
      const { accountId } = yield* CurrentAccount
      const { operationId, ...change } = input
      const write = Effect.map(nowDate, (at) => ({
        statements: [store.recategorise(accountId, change.type, change.name, null, at)],
        result: change.name,
      }))
      yield* store.recorded(
        { accountId, operationId, command: 'deleteCategory', input: change },
        { write, answer: () => Effect.void },
      )
    }),
  }
})

/** The person's categories, for HTTP and, later, MCP; both provide `CurrentAccount`. */
export class Categories extends Context.Service<Categories, Effect.Success<typeof make>>()(
  '@styld/server/wardrobe/Categories',
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Categories.of(service)),
  )
}
