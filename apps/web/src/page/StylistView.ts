import { cdn, type PieceImagesById } from '../Cdn.ts'
import { textLength, prices } from '@styld/protocol'
import { format, languageOf, type Locale, type MessageKey } from '@styld/i18n'
import type { Chat, ChatMessage, ReplyPart, WardrobeAnalysis, WardrobeArea } from '@styld/protocol'
import { Array, Match, Option } from 'effect'
import { AsyncData, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { actionButton } from '../ActionButton.ts'
import { textArea, textField } from '../Fields.styles.ts'
import { secondaryAction } from '../Actions.styles.ts'
import { backIcon, forwardIcon, loader } from '../Icon.ts'
import { wardrobeRouter, lookRouter, pieceRouter } from '../route.ts'
import { block, line } from '../Skeleton.styles.ts'
import { styled } from '../Styled.ts'
import { barStart, round } from './PageBar.styles.ts'
import { chip } from '../Controls.styles.ts'
import { factDot, swatchDot } from './PieceFields.styles.ts'
import { colourName, groupName } from './WardrobeWords.ts'
import { intlLocale } from '../Locale.ts'
import {
  canSend,
  isWriting,
  latestId,
  Message,
  threadId,
  type Model,
  Opening,
  type SendProblem,
  Sending,
} from './Stylist.ts'
import { Button } from '@foldkit/ui'
import { hasStopped } from '../Polling.ts'
import { retryView } from './Retry.ts'
import * as styles from './StylistView.styles.ts'

const composerId = 'stylist-message'

/** The language Styld answers in: the page's, where it has one. */

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
  'stylist.starter.analyze',
]

/** A reply as plain text: a model that still writes **bold** loses the marks. */
const plain = (text: string) => text.replaceAll('**', '')

/** What the page knows besides the chat: the language, and the names and pictures of the person's pieces. */
type Inputs = {
  readonly locale: Locale
  readonly names: ReadonlyMap<string, string>
  readonly images: PieceImagesById
  readonly timeZone: string
  /** The render's stable now, so a chat from today says when today. */
  readonly referenceTime: number
}

const dayOf = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(at)

/** When a chat last moved, in the person's time zone: the time for today's ("Today, 14:05"), else the day ("31 Oct"),
 * so two chats that began alike can be told apart. */
const chatDate = (updatedAt: string, { locale, timeZone, referenceTime }: Inputs) => {
  const at = new Date(updatedAt)
  return dayOf(at, timeZone) === dayOf(new Date(referenceTime), timeZone)
    ? format(locale, 'stylist.chatToday', {
        time: new Intl.DateTimeFormat(intlLocale(locale), { hour: 'numeric', minute: '2-digit', timeZone }).format(at),
      })
    : new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', timeZone }).format(at)
}

/** A piece Styld shows: its cutout on the paper and its name, the link's words. Before the wardrobe is read the
 * link says only that it opens a piece. */
const shownPiece = (pieceId: string, { locale, names, images }: Inputs, h: HtmlBuilder<Message>): Html => {
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
            h.Src(cdn.pieceById(images, pieceId)),
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

const areaName = (area: WardrobeArea) => `stylist.analysis.areas.${area}` as const satisfies MessageKey

/** "Analyze my wardrobe": the server's exact counts as a card under the reply (T-14). Groups, colours as named dots,
 * what was worn lately with the most worn pieces, then the areas with too much and too little. */
const analysisView = (analysis: WardrobeAnalysis, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const areas = (key: MessageKey, list: ReadonlyArray<WardrobeArea>) =>
    list.length === 0
      ? h.empty
      : h.p(styled(h, styles.analysisLine()), [
          h.span(styled(h, styles.analysisTerm()), [format(locale, key, {})]),
          ' ',
          list.map((area) => format(locale, areaName(area), {})).join(', '),
        ])
  return h.section(
    [h.AriaLabel(format(locale, 'stylist.analysis.label', {})), ...styled(h, styles.analysis())],
    [
      h.p(styled(h, styles.analysisTotal()), [format(locale, 'stylist.analysis.pieces', { count: analysis.pieces })]),
      h.ul(
        styled(h, styles.analysisCounts()),
        analysis.groups.map(({ group, count }) =>
          h.keyed('li')(group, [], [`${format(locale, groupName(group), {})} ${String(count)}`]),
        ),
      ),
      analysis.colours.length === 0
        ? h.empty
        : h.ul(
            [h.AriaLabel(format(locale, 'stylist.analysis.colours', {})), ...styled(h, styles.analysisCounts())],
            analysis.colours.map(({ colour, count }) =>
              h.keyed('li')(colour, styled(h, styles.analysisColour()), [
                h.span([
                  h.AriaHidden(true),
                  h.DataAttribute('colour', colour),
                  ...styled(h, cx(swatchDot(), factDot())),
                ]),
                format(locale, 'stylist.analysis.colourCount', {
                  colour: format(locale, colourName(colour), {}),
                  count: String(count),
                }),
              ]),
            ),
          ),
      h.p(styled(h, styles.analysisLine()), [
        format(locale, 'stylist.analysis.worn', {
          days: analysis.worn.days,
          worn: analysis.worn.pieces,
          pieces: analysis.pieces,
        }),
        analysis.worn.never === 0
          ? ''
          : ` · ${format(locale, 'stylist.analysis.never', { count: analysis.worn.never })}`,
      ]),
      analysis.worn.most.length === 0
        ? h.empty
        : h.ul(
            [h.AriaLabel(format(locale, 'stylist.analysis.mostWorn', {})), ...styled(h, styles.pieces())],
            analysis.worn.most.map(({ pieceId }) => shownPiece(pieceId, inputs, h)),
          ),
      areas('stylist.analysis.tooMuch', analysis.surpluses),
      areas('stylist.analysis.tooLittle', analysis.gaps),
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
    Analysis: ({ analysis }) => analysisView(analysis, inputs, h),
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
        [h.Id(threadId), h.AriaLabel(chat.title), h.AriaLive('polite'), ...styled(h, styles.thread())],
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

/** A new chat: what to ask, as whole sentences that wrap, and the earlier chats to open again, each with its date. */
const startView = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return h.div(styled(h, styles.thread()), [
    h.p(styled(h, styles.lede()), [format(locale, 'stylist.intro', {})]),
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'stylist.startersLabel', {})), ...styled(h, styles.starters())],
      starters.map((key) => {
        const text = format(locale, key, {})
        return h.button(
          [
            h.Type('button'),
            ...styled(h, cx(chip(), styles.starter())),
            h.OnClick(Message.ClickedStarter({ text, locale: languageOf(locale) })),
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
                  chats.map(({ id, title, updatedAt }) =>
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
                          [
                            h.span(styled(h, styles.chatTitle()), [title]),
                            h.span(styled(h, styles.chatDate()), [chatDate(updatedAt, inputs)]),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    }),
  ])
}

/** The message being written and its send button, in reach above the phone's tab bar, with the price or why the last
 * one did not go. */
const composerView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const problem = Sending.guards.Failed(model.sending) ? Option.some(model.sending.problem) : Option.none()
  return h.div(styled(h, styles.composer()), [
    h.form(
      [h.OnSubmit(Message.SubmittedMessage({ locale: languageOf(locale) })), ...styled(h, styles.composerRow())],
      [
        h.textarea([
          h.Id(composerId),
          h.Rows(1),
          h.AriaLabel(format(locale, 'stylist.fieldLabel', {})),
          h.Placeholder(format(locale, 'stylist.placeholder', {})),
          h.Maxlength(textLength.chat),
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
      onNone: () =>
        h.p(styled(h, styles.price()), [format(locale, 'stylist.price', { credits: prices.stylistMessage })]),
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
            h.Href(wardrobeRouter({})),
            h.AriaLabel(format(locale, 'common.back', {})),
            ...styled(h, cx(round(), barStart())),
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
      // A chat or the list that did not load, or a reply no longer followed after reads that did not get through.
      Opening.guards.Failed(model.opening) ||
      AsyncData.isFailure(model.chats) ||
      (hasStopped(model.misses) && isWriting(model))
        ? retryView(format(locale, 'stylist.loadFailed', {}), locale, Message.ClickedRetryLoad(), h)
        : h.empty,
      Option.match(model.open, {
        onNone: () => (isReadingChat(model) ? readingView(h) : startView(model, inputs, h)),
        onSome: (chat) => threadView(chat, inputs, h),
      }),
      composerView(model, locale, h),
    ],
  )
})
