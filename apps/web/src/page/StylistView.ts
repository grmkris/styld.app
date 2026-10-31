import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { Chat, ChatLocale, ChatMessage, ReplyPart } from '@styld/protocol'
import { Array, Match, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { textArea, textField } from '../Fields.styles.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { backIcon, forwardIcon, loader } from '../Icon.ts'
import { askRouter, lookRouter, pieceRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { round } from './PageBar.styles.ts'
import { chip, chips } from './AskView.styles.ts'
import { canSend, isWriting, latestId, Message, type Model, Opening, type SendProblem, Sending } from './Stylist.ts'
import { Button } from '@foldkit/ui'
import * as styles from './StylistView.styles.ts'

const composerId = 'stylist-message'

/** The language Styld answers in: the page's, where it has one. */
const chatLocale = (locale: Locale): ChatLocale => (locale === 'sl' ? 'sl' : 'en')

const problemKey: { readonly [Problem in SendProblem]: MessageKey } = {
  busy: 'stylist.problem.busy',
  dailyLimit: 'stylist.problem.dailyLimit',
  unavailable: 'stylist.problem.unavailable',
  network: 'stylist.problem.network',
}

/** What to ask first, each sent with a tap. */
const starters: ReadonlyArray<MessageKey> = [
  'stylist.starter.today',
  'stylist.starter.together',
  'stylist.starter.missing',
]

/** A reply as plain text: a model that still writes **bold** loses the marks. */
const plain = (text: string) => text.replaceAll('**', '')

/** What the page knows besides the chat: the language, and the names of the person's pieces. */
type Inputs = { readonly locale: Locale; readonly names: ReadonlyMap<string, string> }

/** A piece Styld shows: its cutout on the paper and its name, the link's words. Before the wardrobe is read the
 * link says only that it opens a piece. */
const shownPiece = (pieceId: string, { locale, names }: Inputs, h: HtmlBuilder<Message>): Html => {
  const name = names.get(pieceId)
  return h.keyed('li')(
    pieceId,
    [],
    [
      h.a(
        [
          h.Href(pieceRouter({ pieceId })),
          ...(name === undefined ? [h.AriaLabel(format(locale, 'stylist.openPiece', {}))] : []),
          ...styled(h, styles.pieceLink()),
        ],
        [
          h.img([
            h.Src(`/cdn/pieces/${pieceId}/thumb`),
            h.Alt(''),
            h.Loading('lazy'),
            ...styled(h, styles.pieceImage()),
          ]),
          name === undefined ? h.empty : h.span(styled(h, styles.pieceName()), [name]),
        ],
      ),
    ],
  )
}

const partView = (part: ReplyPart, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  Match.valueTags(part, {
    Pieces: ({ pieceIds }) =>
      h.ul(
        [h.AriaLabel(format(inputs.locale, 'stylist.shownPieces', {})), ...styled(h, styles.pieces())],
        pieceIds.map((pieceId) => shownPiece(pieceId, inputs, h)),
      ),
    Look: ({ lookId, name }) =>
      h.a(
        [h.Href(lookRouter({ lookId })), ...styled(h, secondaryAction())],
        [format(inputs.locale, 'stylist.openLook', { name })],
      ),
  })

const replyView = (text: string, parts: ReadonlyArray<ReplyPart>, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.reply()), [
    text.length === 0 ? h.empty : h.p(styled(h, styles.replyText()), [plain(text)]),
    ...parts.map((part) => partView(part, inputs, h)),
  ])

const messageView = (message: ChatMessage, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(message.id, message.role === 'person' ? styled(h, styles.person()) : [], [
    message.role === 'person' ? message.text : replyView(message.text, message.parts, inputs, h),
  ])

/** The reply being written, with what it says so far, or the note that it did not come. */
const replyingView = (chat: Chat, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  if (chat.replying === undefined) return h.empty
  const { state, text, parts } = chat.replying
  return h.li(
    [],
    [
      state === 'failed'
        ? h.p([h.Role('status'), ...styled(h, styles.failed())], [format(locale, 'stylist.failed', {})])
        : h.div(
            [],
            [
              replyView(text, parts, inputs, h),
              h.p(
                [h.Role('status'), ...styled(h, styles.status())],
                [loader(h), format(locale, 'stylist.writing', {})],
              ),
            ],
          ),
    ],
  )
}

const threadView = (chat: Chat, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.ol(
        [h.AriaLabel(chat.title), h.AriaLive('polite'), ...styled(h, styles.thread())],
        [...chat.messages.map((message) => messageView(message, inputs, h)), replyingView(chat, inputs, h)],
      ),
      h.div([h.Id(latestId), ...styled(h, styles.latest())]),
    ],
  )

/** A chat being read, in the shape of one: a message, then the start of a reply. */
const readingView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.AriaHidden(true), h.DataAttribute('skeleton', ''), ...styled(h, styles.thread())],
    [
      h.span(styled(h, cx(block(), styles.personSkeleton()))),
      h.span(styled(h, line())),
      h.span(styled(h, cx(line(), styles.shortSkeleton()))),
    ],
  )

/** Whether the page is still finding out what to show: the chats on arrival, or the chat being opened. */
const isReadingChat = (model: Model) =>
  Opening.guards.Reading(model.opening) ||
  (model.draft.length === 0 && (AsyncData.isIdle(model.chats) || AsyncData.isLoading(model.chats)))

/** A new chat: what Styld is, what to ask, and the earlier chats to open again. */
const startView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.thread()), [
    h.p(styled(h, styles.lede()), [format(locale, 'stylist.intro', {})]),
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'stylist.startersLabel', {})), ...styled(h, chips())],
      starters.map((key) => {
        const text = format(locale, key, {})
        return h.button(
          [
            h.Type('button'),
            ...styled(h, chip()),
            h.OnClick(Message.ClickedStarter({ text, locale: chatLocale(locale) })),
          ],
          [text],
        )
      }),
    ),
    AsyncData.matchData(model.chats, {
      onEmpty: () => h.empty,
      onFailure: () => h.empty,
      onData: (chats) =>
        Array.isReadonlyArrayEmpty(chats)
          ? h.empty
          : h.section(
              [h.AriaLabelledBy('stylist-chats')],
              [
                h.h2(
                  [h.Id('stylist-chats'), ...styled(h, styles.sectionTitle())],
                  [format(locale, 'stylist.earlier', {})],
                ),
                h.ul(
                  styled(h, styles.chats()),
                  chats.map(({ id, title }) =>
                    h.keyed('li')(
                      id,
                      [],
                      [
                        h.button(
                          [
                            h.Type('button'),
                            ...styled(h, styles.chatLink()),
                            h.OnClick(Message.ClickedChat({ chatId: id })),
                          ],
                          [title],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    }),
  ])

/** The message being written and its send button, in reach above the phone's tab bar, with the price or why the last
 * one did not go. */
const composerView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const problem = Sending.guards.Failed(model.sending) ? Option.some(model.sending.problem) : Option.none()
  return h.div(styled(h, styles.composer()), [
    h.form(
      [h.OnSubmit(Message.SubmittedMessage({ locale: chatLocale(locale) })), ...styled(h, styles.composerRow())],
      [
        h.textarea([
          h.Id(composerId),
          h.Rows(1),
          h.AriaLabel(format(locale, 'stylist.fieldLabel', {})),
          h.Placeholder(format(locale, 'stylist.placeholder', {})),
          h.Maxlength(2000),
          h.Value(model.draft),
          h.OnInput((value) => Message.UpdatedDraft({ value })),
          ...styled(h, cx(textField(), textArea(), styles.field())),
        ]),
        // aria-disabled rather than disabled, so the button keeps focus while its message goes (DESIGN › Controls);
        // the form's submit is refused while nothing can be sent.
        Button.view(
          {
            type: 'submit',
            isDisabled: !canSend(model),
            toView: (attributes) =>
              h.button(
                [...attributes.button, h.AriaLabel(format(locale, 'stylist.send', {})), ...styled(h, styles.send())],
                [Sending.guards.Sending(model.sending) ? loader(h) : forwardIcon(h)],
              ),
          },
          h,
        ),
      ],
    ),
    Option.match(problem, {
      onNone: () => h.p(styled(h, styles.price()), [format(locale, 'stylist.price', {})]),
      onSome: (failed) =>
        h.p([h.Role('alert'), ...styled(h, styles.problem())], [format(locale, problemKey[failed], {})]),
    }),
  ])
}

/** Styld, the stylist in the app: a chat about the person's own wardrobe. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) => {
  const { locale } = inputs
  return h.main(
    [h.Id('main'), ...styled(h, styles.page())],
    [
      h.div(styled(h, styles.pageBar()), [
        h.a(
          [
            h.Href(askRouter({ q: Option.none() })),
            h.AriaLabel(format(locale, 'common.back', {})),
            ...styled(h, round()),
          ],
          [backIcon(h)],
        ),
        Option.isSome(model.open)
          ? actionButton(
              {
                label: format(locale, 'stylist.newChat', {}),
                style: secondaryAction(),
                isDisabled: isWriting(model),
                onClick: Message.ClickedNewChat(),
              },
              h,
            )
          : h.empty,
      ]),
      h.h1([], [format(locale, 'stylist.title', {})]),
      Opening.guards.Failed(model.opening) || AsyncData.isFailure(model.chats)
        ? h.div(
            [h.Role('alert')],
            [
              h.p([], [format(locale, 'stylist.loadFailed', {})]),
              actionButton(
                {
                  label: format(locale, 'common.tryAgain', {}),
                  style: secondaryAction(),
                  onClick: Message.ClickedRetryLoad(),
                },
                h,
              ),
            ],
          )
        : h.empty,
      Option.match(model.open, {
        onNone: () => (isReadingChat(model) ? readingView(h) : startView(model, locale, h)),
        onSome: (chat) => threadView(chat, inputs, h),
      }),
      composerView(model, locale, h),
    ],
  )
})
