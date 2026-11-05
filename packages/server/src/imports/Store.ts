import { accountOfEmail, createEmailAccount, type NewEmailAccount } from '@styld/auth'
import { Context, Effect, Layer } from 'effect'
import { Database, fenced, first, query } from '../kernel/Db.ts'
import { importedRows } from './Imported.ts'
import { receiptRows } from '../kernel/Receipts.ts'

/** An import's rows: the account it goes into (written through auth's statements), and its pieces
 * (`Imported.ts`). */
const importStore = (db: Database['Service']) => ({
  ...receiptRows(db),
  ...importedRows(db),
  /** The enabled account this verified email signs in to. */
  accountOf: (email: string) => query(() => accountOfEmail(db, email)).pipe(Effect.map(first)),
  /** Make the account for an email that has none, as one batch: an address taken meanwhile fails it. */
  createAccount: (account: NewEmailAccount) =>
    fenced(() => db.batch(createEmailAccount(db, account))).pipe(Effect.asVoid),
})

/** The import's store over the application's one database. */
export class ImportStore extends Context.Service<ImportStore, ReturnType<typeof importStore>>()(
  '@styld/server/imports/ImportStore',
) {
  static readonly layer = Layer.effect(this, Effect.map(Database, importStore))
}
