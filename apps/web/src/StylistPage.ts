import type { Html, HtmlBuilder } from 'foldkit/html'
import { AsyncData } from 'foldkit'
import type { Model } from './App.ts'
import { Message } from './Message.ts'
import * as StylistView from './page/StylistView.ts'
import { pieceLabel } from './page/WardrobeWords.ts'

// Styld's chat page in the app: what it is given to draw, the wardrobe's names for the pieces it shows and the
// render's language, time zone and stable now.

const pieceNames = (model: Model): ReadonlyMap<string, string> =>
  AsyncData.isSuccess(model.wardrobe.pieces)
    ? new Map(model.wardrobe.pieces.data.map((piece) => [piece.id, pieceLabel(piece, model.context.locale)]))
    : new Map()

export const stylistPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'stylist',
    model: model.stylist,
    view: StylistView.view,
    viewInputs: {
      locale: model.context.locale,
      names: pieceNames(model),
      timeZone: model.context.timeZone,
      referenceTime: model.context.referenceTime,
    },
    toParentMessage: (message) => Message.GotStylistMessage({ message }),
  })
