import { cdn } from '../Cdn.ts'
import { format, type Locale } from '@styld/i18n'
import { AsyncData, Submodel } from 'foldkit'
import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { photoRouter } from '../route.ts'
import { styled } from '../Styled.ts'
import type { Message, Model } from './PiecePhotos.ts'
import * as styles from './PhotosView.styles.ts'

/** The outfit photos a piece is confirmed in, newest first; nothing when there are none. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h): Html =>
  Option.match(AsyncData.getData(model.photos), {
    onNone: () => h.empty,
    onSome: (photos) =>
      photos.length === 0
        ? h.empty
        : h.section(
            [h.AriaLabelledBy('piece-photos')],
            [
              h.h2(
                [h.Id('piece-photos'), ...styled(h, styles.inPhotosTitle())],
                [format(locale, 'photos.inYourPhotos', {})],
              ),
              h.ul(
                styled(h, styles.inPhotos()),
                photos.map((photo) =>
                  h.keyed('li')(
                    photo.id,
                    [],
                    [
                      h.a(
                        [h.Href(photoRouter({ photoId: photo.id })), ...styled(h, styles.tile())],
                        [
                          h.img([
                            h.Src(cdn.photo(photo.id, 'thumb')),
                            h.Alt(''),
                            h.Loading('lazy'),
                            ...styled(h, styles.tileImage()),
                          ]),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
  }),
)
