import { format, type Locale } from '@styld/i18n'
import { AsyncData, Submodel } from 'foldkit'
import type { Html } from 'foldkit/html'
import { styled } from '../Styled.ts'
import { lookCard } from './LooksView.ts'
import * as looksStyles from './LooksView.styles.ts'
import { Message, type Model } from './PieceLooks.ts'
import { retryView } from './Retry.ts'
import { inPhotosTitle } from './PhotosView.styles.ts'

/** The saved looks a piece is in, newest first, each a card that opens it; nothing when there are none. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h): Html =>
  AsyncData.matchData(model.looks, {
    onEmpty: () => h.empty,
    onFailure: () => retryView(format(locale, 'looks.loadFailed', {}), locale, Message.ClickedRetry(), h),
    onData: (looks) =>
      looks.length === 0
        ? h.empty
        : h.section(
            [h.AriaLabelledBy('piece-looks')],
            [
              h.h2([h.Id('piece-looks'), ...styled(h, inPhotosTitle())], [format(locale, 'looks.inYourLooks', {})]),
              h.ul(
                styled(h, looksStyles.grid()),
                looks.map((look) => lookCard(look, locale, h)),
              ),
            ],
          ),
  }),
)
