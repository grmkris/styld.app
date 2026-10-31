import type { Piece } from '@styld/protocol'
import { Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Model } from './App.ts'
import { Message } from './Message.ts'
import * as PhotosView from './page/PhotosView.ts'
import * as PhotoView from './page/PhotoView.ts'

// My Gallery's two pages in the app's view (View.ts): the photos, and one photo, whose garments are matched to the
// wardrobe's pieces.

/** My Gallery: the person's own outfit photos. */
export const photosPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'photos',
    model: model.photos,
    view: PhotosView.view,
    viewInputs: { locale: model.context.locale, timeZone: model.context.timeZone },
    toParentMessage: (message) => Message.GotPhotosMessage({ message }),
  })

export const photoPage = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'photo',
    model: model.photo,
    view: PhotoView.view,
    viewInputs: {
      locale: model.context.locale,
      timeZone: model.context.timeZone,
      pieces: Option.getOrElse(AsyncData.getData(model.wardrobe.pieces), (): ReadonlyArray<Piece> => []),
    },
    toParentMessage: (message) => Message.GotPhotoMessage({ message }),
  })
