import { format, type Locale } from '@styld/i18n'
import type { PublicBoard } from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { linkAction, secondaryAction } from '../../Actions.styles.ts'
import { actionRow, note, problem } from '../../Controls.styles.ts'
import { loader } from '../../Icon.ts'
import { boardRouter, signInReturningTo } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { Message, Model } from './TryIt.ts'

type Inputs = { readonly locale: Locale; readonly signedIn: boolean; readonly board: PublicBoard }

/** Try with my wardrobe, on a board that shows generated pieces: signed out, the way to sign in and come back; once
 * tried, how many pieces came from the wardrobe and the way to the new board. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, { locale, signedIn, board }, h): Html => {
  if (!board.generated) return h.empty
  const label = format(locale, 'tryBoard.action', {})
  if (!signedIn)
    return h.a(
      [h.Href(signInReturningTo(boardRouter({ boardId: board.id }))), ...styled(h, secondaryAction())],
      [label],
    )
  const trying = Model.guards.Trying(model)
  const button = actionButton(
    {
      label,
      style: secondaryAction(),
      isDisabled: trying,
      leading: trying ? loader(h) : h.empty,
      onClick: Message.ClickedTry({ boardId: board.id }),
    },
    h,
  )
  return h.div(
    styled(h, actionRow()),
    Model.match(model, {
      Idle: () => [button],
      Trying: () => [button],
      Tried: ({ tried }) => [
        h.p(
          [h.Role('status'), ...styled(h, note())],
          [format(locale, 'tryBoard.tried', { fromWardrobe: tried.fromWardrobe, of: tried.of })],
        ),
        h.a(
          [h.Href(boardRouter({ boardId: tried.boardId })), ...styled(h, linkAction())],
          [format(locale, 'tryBoard.open', {})],
        ),
      ],
      Failed: () => [button, h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'tryBoard.failed', {})])],
    }),
  )
})
