import { Dialog } from '@foldkit/ui'
import { GarmentGroup, groupOf, PieceType } from '@styld/protocol'
import { Option, Schema } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { sheetFolds } from './Sheet.ts'

// A sheet of the person's own pieces to choose one from: the board's "Add your piece" and a Gallery photo's "Choose
// from your wardrobe" (Eva, 4 November: a photo offered only pieces of the kind Styld read, so a cardigan kept under
// outerwear could never be chosen for a garment read as a top). Group and type chips narrow it and a search reads
// every word a piece answers to; the page holding it keeps this state and says what a chosen piece does.

export const PiecePicker = Schema.Struct({
  sheet: Dialog.Model,
  group: Schema.Option(GarmentGroup),
  type: Schema.Option(PieceType),
  query: Schema.String,
})
export type PiecePicker = typeof PiecePicker.Type

export const initPicker = (id: string): PiecePicker => ({
  sheet: Dialog.init({ id, isAnimated: true }),
  group: Option.none(),
  type: Option.none(),
  query: '',
})

/** Where the sheet opens for a garment Styld read as `type`: that type in its group, or every piece when it read none. */
export const startingAt = (type: Option.Option<PieceType>) => ({ group: Option.map(type, groupOf), type })

/** The picker folded into a page whose model keeps it: its sheet's Messages, opening and closing it, and narrowing
 * what it offers. A new group clears the type, which belonged to the group before. */
export const pickerFolds = <Model, Message>(page: {
  readonly read: (model: Model) => PiecePicker
  readonly write: (model: Model, picker: PiecePicker) => Model
  readonly toParentMessage: (message: Dialog.Message) => Message
}) => {
  const sheet = sheetFolds<Model, Message>({
    read: (model) => page.read(model).sheet,
    write: (model, nextSheet) => page.write(model, modifyFields(page.read(model), { sheet: () => nextSheet })),
    toParentMessage: page.toParentMessage,
  })
  const narrowed = (model: Model, change: (picker: PiecePicker) => PiecePicker): Update.Return<Model, Message> => ({
    model: page.write(model, change(page.read(model))),
  })
  return {
    update: sheet.update,
    /** Opened as it was left. */
    open: sheet.open,
    /** Opened afresh on a group and type, with nothing typed. */
    openAt:
      (start: ReturnType<typeof startingAt>): Update.Step<Model, Message> =>
      (model) =>
        sheet.open(
          page.write(
            model,
            modifyFields(page.read(model), { group: () => start.group, type: () => start.type, query: () => '' }),
          ),
        ),
    close: sheet.close,
    selectedGroup: (model: Model, group: Option.Option<GarmentGroup>) =>
      narrowed(model, (picker) => modifyFields(picker, { group: () => group, type: () => Option.none() })),
    selectedType: (model: Model, type: Option.Option<PieceType>) =>
      narrowed(model, (picker) => modifyFields(picker, { type: () => type })),
    updatedQuery: (model: Model, query: string) =>
      narrowed(model, (picker) => modifyFields(picker, { query: () => query })),
  }
}
