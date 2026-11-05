import { cdn } from '../../Cdn.ts'
import { format, type Locale, type MessageKey } from '@styld/i18n'
import { type CheckStatus, Mood, type Pin, textLength, type Visibility } from '@styld/protocol'
import { Array, Match, Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../../ActionButton.ts'
import { primaryAction, secondaryAction, smallAction } from '../../Actions.styles.ts'
import { editIcon, loader, moreIcon, pasteIcon, tidyIcon } from '../../Icon.ts'
import { lookRouter, pieceRouter } from '../../route.ts'
import { styled } from '../../Styled.ts'
import { visuallyHidden } from '../../VisuallyHidden.styles.ts'
import { publicToggle } from '../PublicToggle.ts'
import { bottomSheet, sheetShown } from '../Sheet.ts'
import { pieceDescription } from '../WardrobeWords.ts'
import { round } from '../PageBar.styles.ts'
import { chip, chosen } from '../../Controls.styles.ts'
import { Message, type Model, nameFieldId, Publishing, Removal, Rename } from './Chrome.ts'
import { generatedMark } from './MakeView.ts'
import * as styles from './PageView.styles.ts'
import { lookMosaic } from './PickerView.ts'
import { boardImage } from './Table.ts'
import { unpinButton } from './Unpin.ts'

// The board page's chrome: its title, its public switch and ⋯ button in the bar, and the ⋯ sheet.

/** Who sees the board as the server last said, for the switch and the pins the sheet lists. */
type Sharing = {
  readonly locale: Locale
  readonly visibility: Visibility
  readonly check: Option.Option<CheckStatus>
}

/** What the ⋯ sheet shows besides the chrome's own: the board's name, its pins and whether the table's rows apply. */
type SheetInputs = Sharing & {
  readonly name: string
  readonly pins: ReadonlyArray<Pin>
  readonly publicPins: ReadonlyArray<string>
  readonly pinsFailed: boolean
  readonly canChangePins: boolean
  readonly canTidy: boolean
  readonly canPaste: boolean
}

/** A pinned thing on the board; one the board shows others without (no picture of its own yet, or Styld's check held
 * it back) says so under it. */
const pinView = (
  pin: Pin,
  asking: boolean,
  heldBack: boolean,
  disabled: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    pin.id,
    [...styled(h, styles.pin())],
    [
      ...pinContent(pin, asking, disabled, locale, h),
      heldBack ? h.p(styled(h, styles.heldBack()), [format(locale, heldBackReason(pin), {})]) : h.empty,
    ],
  )

/** Why others do not see a pin: a piece needs its own picture and Styld's check; a look, to be shared; anything else
 * waits on the check. */
const heldBackReason = (pin: Pin): MessageKey =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PiecePin: () => 'board.heldBack' as const,
      LookPin: ({ look }) => (look.shared ? ('board.heldBackCheck' as const) : ('board.heldBackLook' as const)),
      PicturePin: () => 'board.heldBackCheck' as const,
    }),
  )

const pinContent = (
  pin: Pin,
  asking: boolean,
  disabled: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Match.value(pin).pipe(
    Match.tagsExhaustive({
      PiecePin: ({ id, piece }) => [
        h.a(
          [h.Href(pieceRouter({ pieceId: piece.id })), ...styled(h, styles.pinLink())],
          [
            h.span(styled(h, styles.pinFrame()), [
              h.img([
                h.Src(cdn.piece(piece)),
                h.Alt(pieceDescription(piece, locale)),
                h.Loading('lazy'),
                ...styled(h, styles.cutout()),
              ]),
            ]),
          ],
        ),
        unpinButton(
          {
            pinId: id,
            label: format(locale, 'board.unpin', { name: pieceDescription(piece, locale) }),
            question: 'board.unpinAsk',
          },
          asking,
          disabled,
          locale,
          h,
        ),
      ],
      PicturePin: ({ id, image, generated }) => [
        h.span(styled(h, styles.pinFrame()), [
          h.img([
            h.Src(boardImage({ image }, 'thumb')),
            h.Alt(format(locale, 'board.picture', {})),
            h.Loading('lazy'),
            ...styled(h, styles.photo()),
          ]),
        ]),
        generated ? generatedMark(locale, h) : h.empty,
        unpinButton(
          { pinId: id, label: format(locale, 'board.unpinPicture', {}), question: 'board.unpinPictureAsk' },
          asking,
          disabled,
          locale,
          h,
        ),
      ],
      LookPin: ({ id, look }) => [
        h.a(
          [h.Href(lookRouter({ lookId: look.id })), ...styled(h, styles.pinLink())],
          [
            h.span(styled(h, styles.pinFrame()), [lookMosaic(look, h)]),
            h.span(styled(h, styles.pinName()), [look.name]),
          ],
        ),
        unpinButton(
          { pinId: id, label: format(locale, 'board.unpin', { name: look.name }), question: 'board.unpinAsk' },
          asking,
          disabled,
          locale,
          h,
        ),
      ],
    }),
  )

const pinsView = (model: Model, inputs: SheetInputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return h.section(
    [h.AriaLabelledBy('board-pins'), ...styled(h, styles.head())],
    [
      h.div(styled(h, styles.pinsHead()), [
        h.h2([h.Id('board-pins'), ...styled(h, styles.pinsTitle())], [format(locale, 'board.pinsTitle', {})]),
      ]),
      inputs.pinsFailed
        ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.removeFailed', {})])
        : h.empty,
      Array.match(inputs.pins, {
        onEmpty: () =>
          h.div(styled(h, styles.empty()), [
            h.p(styled(h, styles.emptyTitle()), [format(locale, 'studio.emptyGridTitle', {})]),
            h.p([], [format(locale, 'board.pinsEmptyHint', {})]),
          ]),
        onNonEmpty: (pins) =>
          h.ul(
            styled(h, styles.grid()),
            Array.map(pins, (pin) =>
              pinView(
                pin,
                Option.contains(model.unpinning, pin.id),
                // Public, and this pin is not among those others see.
                inputs.visibility === 'public' && !inputs.publicPins.includes(pin.id),
                !inputs.canChangePins,
                locale,
                h,
              ),
            ),
          ),
      }),
    ],
  )
}

const removalView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    styled(h, styles.danger()),
    Removal.match(model.removal, {
      Idle: () => [
        h.p([], [format(locale, 'studio.dangerZoneHint', {})]),
        h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, 'studio.deleteBoard', {}),
              style: secondaryAction(),
              onClick: Message.ClickedDeleteBoard(),
            },
            h,
          ),
        ]),
      ],
      Confirming: () => [
        h.p([h.Role('alert')], [format(locale, 'studio.deleteConfirm', {})]),
        h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, 'studio.delete', {}),
              style: primaryAction(),
              onClick: Message.ClickedConfirmDelete(),
            },
            h,
          ),
          actionButton(
            {
              label: format(locale, 'studio.cancel', {}),
              style: secondaryAction(),
              onClick: Message.ClickedKeepBoard(),
            },
            h,
          ),
        ]),
      ],
      Deleting: () => [h.p([h.Role('status')], [loader(h)])],
      Failed: () => [
        h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.deleteFailed', {})]),
        h.div(styled(h, styles.actions()), [
          actionButton(
            {
              label: format(locale, 'studio.retry', {}),
              style: secondaryAction(),
              onClick: Message.ClickedConfirmDelete(),
            },
            h,
          ),
        ]),
      ],
    }),
  )

/** Who sees the board: private, or public on the published profile once Styld's check lets others. */
export const publicView = Submodel.defineView<Model, Message, Sharing>((model, { locale, visibility, check }, h) =>
  publicToggle(
    {
      id: 'board-public',
      isPublic: visibility === 'public',
      check: Option.getOrNull(check),
      work: Publishing.match(model.publishing, {
        Idle: () => 'idle' as const,
        Sending: () => 'sending' as const,
        Failed: ({ needsProfile }) => (needsProfile ? ('needsProfile' as const) : ('failed' as const)),
      }),
      // The title's status line says who sees it, and the check's word shows under it.
      describe: false,
      onToggle: (isPublic) => Message.ToggledPublic({ isPublic }),
    },
    locale,
    h,
  ),
)

/** The bar's ⋯, which opens the sheet. */
export const moreButtonView = Submodel.defineView<Model, Message, { readonly locale: Locale }>(
  (_model, { locale }, h) =>
    h.button(
      [
        h.Type('button'),
        h.AriaHasPopup('dialog'),
        h.AriaLabel(format(locale, 'board.more.title', {})),
        h.OnClick(Message.ClickedMore()),
        ...styled(h, round()),
      ],
      [moreIcon(h)],
    ),
)

/** The board's moods, which search finds it by: up to three of the six. */
const moodsView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.sharing()), [
    h.p(styled(h, styles.moodsLabel()), [format(locale, 'boards.moodsLabel', {})]),
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'boards.moodsLabel', {})), ...styled(h, styles.moods())],
      Mood.literals.map((mood) =>
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(String(model.moods.includes(mood))),
            h.OnClick(Message.ToggledMood({ mood })),
            ...styled(h, cx(chip(), chosen())),
          ],
          [format(locale, `boards.moods.${mood}`, {})],
        ),
      ),
    ),
  ])

/** A row of the ⋯ sheet. */
const moreRow = (label: string, icon: Html, message: Message, isDisabled: boolean, h: HtmlBuilder<Message>): Html =>
  h.li(
    [],
    [
      h.button(
        [h.Type('button'), h.Disabled(isDisabled), h.OnClick(message), ...styled(h, styles.moreRow())],
        [icon, label],
      ),
    ],
  )

/** The ⋯ sheet's body: what is done to the board rather than on its table, then its moods, its pins and deleting it. */
const moreBody = (model: Model, inputs: SheetInputs, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const { locale } = inputs
  return [
    h.ul(styled(h, styles.moreRows()), [
      moreRow(
        format(locale, 'board.more.rename', {}),
        editIcon(h),
        Message.ClickedRename({ name: inputs.name, fromSheet: true }),
        false,
        h,
      ),
      moreRow(
        format(locale, 'board.tidy', {}),
        tidyIcon(h),
        Message.ClickedMoreAction({ action: 'tidy' }),
        !inputs.canTidy,
        h,
      ),
      moreRow(
        format(locale, 'board.paste', {}),
        pasteIcon(h),
        Message.ClickedMoreAction({ action: 'paste' }),
        !inputs.canPaste,
        h,
      ),
    ]),
    moodsView(model, locale, h),
    pinsView(model, inputs, h),
    removalView(model, locale, h),
  ]
}

/** The ⋯ sheet, while it is shown. */
export const sheetView = Submodel.defineView<Model, Message, SheetInputs>((model, inputs, h) =>
  sheetShown(model.more)
    ? bottomSheet(
        {
          dialog: model.more,
          title: format(inputs.locale, 'board.more.title', {}),
          body: () => [h.div(styled(h, styles.sheetBody()), moreBody(model, inputs, h))],
          toParentMessage: (message) => Message.GotMoreMessage({ message }),
          locale: inputs.locale,
        },
        h,
      )
    : h.empty,
)

/** The board's name, which a tap turns into a field to rename it; Escape or Cancel leaves it as it was. */
export const titleView = Submodel.defineView<Model, Message, { readonly locale: Locale; readonly name: string }>(
  (model, { locale, name }, h) => {
    if (Rename.guards.Idle(model.rename))
      return h.div(styled(h, styles.head()), [
        h.h1(
          [],
          [
            h.button(
              [
                h.Type('button'),
                h.AriaDescribedBy('board-rename-hint'),
                h.OnClick(Message.ClickedRename({ name, fromSheet: false })),
                ...styled(h, styles.titleButton()),
              ],
              [h.span([], [name]), editIcon(h)],
            ),
          ],
        ),
        h.span(
          [h.Id('board-rename-hint'), ...styled(h, visuallyHidden())],
          [format(locale, 'board.more.renameHint', {})],
        ),
      ])
    const saving = Rename.guards.Saving(model.rename)
    return h.form(
      [h.OnSubmit(Message.SubmittedRename()), h.Attribute('novalidate', ''), ...styled(h, styles.head())],
      [
        h.div(styled(h, styles.nameForm()), [
          h.input([
            h.Id(nameFieldId),
            h.AriaLabel(format(locale, 'studio.boardName', {})),
            h.Value(model.nameDraft),
            h.Maxlength(textLength.boardName),
            h.Readonly(saving),
            h.Attribute('enterkeyhint', 'done'),
            h.OnInput((value) => Message.UpdatedNameDraft({ value })),
            h.OnKeyDownPreventDefault((key) =>
              key === 'Escape' ? Option.some(Message.ClickedCancelRename()) : Option.none(),
            ),
            ...styled(h, styles.nameField()),
          ]),
          actionButton(
            {
              label: format(locale, saving ? 'saveToBoard.saving' : 'studio.save', {}),
              style: cx(primaryAction(), smallAction()),
              type: 'submit',
              isDisabled: saving,
              leading: saving ? loader(h) : h.empty,
            },
            h,
          ),
          actionButton(
            {
              label: format(locale, 'common.cancel', {}),
              style: cx(secondaryAction(), smallAction()),
              onClick: Message.ClickedCancelRename(),
              isDisabled: saving,
            },
            h,
          ),
        ]),
        Rename.guards.Failed(model.rename)
          ? h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, 'studio.renameFailed', {})])
          : h.empty,
      ],
    )
  },
)
