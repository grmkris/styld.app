import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { MissingPiece, PublicBoard } from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { actionButton } from '../../ActionButton.ts'
import { linkAction, secondaryAction } from '../../Actions.styles.ts'
import { actionRow, note, problem } from '../../Controls.styles.ts'
import { loader } from '../../Icon.ts'
import { intlLocale } from '../../Locale.ts'
import { addPiecesRouter, boardRouter, signInReturningTo } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { colourName, kindName } from '../WardrobeWords.ts'
import { Message, Model } from './TryIt.ts'
import { addList } from './TryItView.styles.ts'

/** A kind of piece the wardrobe had none of, as the tried board's label words it: "No beige coat yet". */
const missingLine = (piece: MissingPiece, locale: Locale) => {
  const lower = (key: MessageKey) => format(locale, key, {}).toLocaleLowerCase(intlLocale(locale))
  const [colour] = piece.colours
  const type = lower(kindName(piece))
  return colour === undefined
    ? format(locale, 'tryBoard.missingKind', { type })
    : format(locale, 'tryBoard.missing', { type, colour: lower(colourName(colour)) })
}

/** Add these (owner, 4 November 2026): what the wardrobe lacked for the board, and the way to add clothes. */
const addThese = <M>(missing: ReadonlyArray<MissingPiece>, locale: Locale, h: HtmlBuilder<M>): Html =>
  missing.length === 0
    ? h.empty
    : h.div(styled(h, addList()), [
        h.p(styled(h, note()), [format(locale, 'tryBoard.addThese', {})]),
        h.ul(
          styled(h, addList()),
          missing.map((piece) => h.li([], [missingLine(piece, locale)])),
        ),
        h.a([h.Href(addPiecesRouter()), ...styled(h, linkAction())], [format(locale, 'today.addClothes', {})]),
      ])

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
        addThese(tried.missing ?? [], locale, h),
      ],
      Failed: () => [button, h.p([h.Role('alert'), ...styled(h, problem())], [format(locale, 'tryBoard.failed', {})])],
    }),
  )
})
