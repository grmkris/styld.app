import { format, type Locale, type MessageKey } from '@styld/i18n'
import type { Chat, ChatLocale, ChatMessage, ReplyPart } from '@styld/protocol'
import { Array, Match, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { textField } from '../Fields.styles.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { backIcon, forwardIcon, loader } from '../Icon.ts'
import { askRouter, lookRouter, pieceRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { round } from './PageBar.styles.ts'
import { chip, chips } from './AskView.styles.ts'
import { canSend, isWriting, Message, type Model, Opening, type SendProblem, Sending } from './Stylist.ts'
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

const partView = (part: ReplyPart, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Match.valueTags(part, {
    Pieces: ({ pieceIds }) =>
      h.ul(
        [h.AriaLabel(format(locale, 'stylist.shownPieces', {})), ...styled(h, styles.pieces())],
        pieceIds.map((pieceId) =>
          h.keyed('li')(
            pieceId,
            [],
            [
              h.a(
                [h.Href(pieceRouter({ pieceId })), h.AriaLabel(format(locale, 'stylist.openPiece', {}))],
                [
                  h.img([
                    h.Src(`/cdn/pieces/${pieceId}/thumb`),
                    h.Alt(''),
                    h.Loading('lazy'),
                    ...styled(h, styles.pieceImage()),
                  ]),
                ],
              ),
            ],
          ),
        ),
      ),
    Look: ({ lookId, name }) =>
      h.a(
        [h.Href(lookRouter({ lookId })), ...styled(h, secondaryAction())],
        [format(locale, 'stylist.openLook', { name })],
      ),
  })

const replyView = (text: string, parts: ReadonlyArray<ReplyPart>, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.reply()), [
    text.length === 0 ? h.empty : h.p(styled(h, styles.replyText()), [plain(text)]),
    ...parts.map((part) => partView(part, locale, h)),
  ])

const messageView = (message: ChatMessage, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(message.id, message.role === 'person' ? styled(h, styles.person()) : [], [
    message.role === 'person' ? message.text : replyView(message.text, message.parts, locale, h),
  ])

/** The reply being written, with what it says so far, or the note that it did not come. */
const replyingView = (chat: Chat, locale: Locale, h: HtmlBuilder<Message>): Html => {
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
              replyView(text, parts, locale, h),
              h.p(
                [h.Role('status'), ...styled(h, styles.status())],
                [loader(h), format(locale, 'stylist.writing', {})],
              ),
            ],
          ),
    ],
  )
}

const threadView = (chat: Chat, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.ol(
    [h.AriaLabel(chat.title), h.AriaLive('polite'), ...styled(h, styles.thread())],
    [...chat.messages.map((message) => messageView(message, locale, h)), replyingView(chat, locale, h)],
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
          ...styled(h, cx(textField(), styles.field())),
        ]),
        h.button(
          [
            h.Type('submit'),
            h.AriaLabel(format(locale, 'stylist.send', {})),
            h.Disabled(!canSend(model)),
            ...styled(h, styles.send()),
          ],
          [Sending.guards.Sending(model.sending) ? loader(h) : forwardIcon(h)],
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
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
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
        onSome: (chat) => threadView(chat, locale, h),
      }),
      composerView(model, locale, h),
    ],
  ),
)
