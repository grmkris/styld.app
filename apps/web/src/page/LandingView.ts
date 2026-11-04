import { format, type Locale } from '@styld/i18n'
import {
  freeCredits,
  landingAnswerPieces,
  landingAssistantPieces,
  type LandingFilmName,
  landingRailPieces,
  memberDailyCredits,
  planNames,
  plans,
} from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { signInHref } from '../route.ts'
import { styled } from '../Styled.ts'
import { Film, Message, type Model, PlayRail, PlayWhileSeen, StartFilm, tallQuery, WatchChat } from './Landing.ts'
import { landingMedia } from './LandingMedia.ts'
import * as styles from './LandingView.styles.ts'

// The signed-out Home (Landing.ts): the hero, one screen per feature, then the ending.

type Inputs = { readonly locale: Locale }

/** A screen's poster in the shape of the screen, under its film. Its description names the film; the media themselves
 * say nothing to assistive technology. */
const film = (name: LandingFilmName, label: string, video: Html, h: HtmlBuilder<Message>) => {
  const media = landingMedia.film(name)
  return h.figure(
    [
      h.Role('img'),
      h.AriaLabel(label),
      ...styled(h, name === 'hero' ? cx(styles.film(), styles.heroFilm()) : styles.film()),
    ],
    [
      h.picture(
        [h.AriaHidden(true)],
        [
          h.source([h.Attribute('media', tallQuery), h.Srcset(media.posterTall)]),
          h.img([
            h.Src(media.posterWide),
            h.Alt(''),
            ...(name === 'hero' ? [h.Fetchpriority('high')] : [h.Loading('lazy')]),
            h.Decoding('async'),
            ...styled(h, styles.filmMedia()),
          ]),
        ],
      ),
      video,
    ],
  )
}

const looping = (h: HtmlBuilder<Message>) => [
  h.Muted(true),
  h.Loop(true),
  h.Playsinline(true),
  h.Preload('none'),
  h.AriaHidden(true),
  ...styled(h, styles.filmMedia()),
]

const startFree = (locale: Locale, h: HtmlBuilder<Message>, pinned = false): Html =>
  h.a(
    [
      h.Href(signInHref),
      ...styled(
        h,
        pinned ? cx(primaryAction(), styles.noWrap(), styles.pinnedAction()) : cx(primaryAction(), styles.noWrap()),
      ),
    ],
    [format(locale, 'landing.start', {})],
  )

const words = (id: string, title: string, line: string, h: HtmlBuilder<Message>, paper = false): Html =>
  h.div(styled(h, paper ? cx(styles.words(), styles.paperWords()) : styles.words()), [
    h.h2([h.Id(id), ...styled(h, styles.title())], [title]),
    h.p(styled(h, styles.line()), [line]),
  ])

const hero = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const media = landingMedia.film('hero')
  return h.section(
    [h.AriaLabelledBy('landing-title'), ...styled(h, cx(styles.screen(), styles.hero()))],
    [
      film(
        'hero',
        format(locale, 'landing.hero.film', {}),
        Film.guards.Still(model.film)
          ? h.empty
          : h.video([...looping(h), h.OnMount(StartFilm({ tall: media.tall, wide: media.wide }))]),
        h,
      ),
      h.div(styled(h, cx(styles.words(), styles.heroWords())), [
        h.h1([h.Id('landing-title'), ...styled(h, styles.title())], [format(locale, 'landing.hero.title', {})]),
        h.p(styled(h, styles.line()), [format(locale, 'landing.hero.lede', {})]),
      ]),
      h.div(styled(h, styles.actions()), [
        // One code signs in and signs up, so Start free and Sign in go to the same page: the first is for someone new.
        startFree(locale, h),
        h.a(
          [h.Href(signInHref), ...styled(h, cx(secondaryAction(), styles.quietAction(), styles.noWrap()))],
          [format(locale, 'landing.signIn', {})],
        ),
      ]),
    ],
  )
}

/** A feature's screen around its film. */
const filmScreen = (name: 'shop' | 'outfits' | 'tryOn', locale: Locale, h: HtmlBuilder<Message>): Html => {
  const media = landingMedia.film(name)
  const id = `landing-${name}`
  return h.section(
    [h.AriaLabelledBy(id), ...styled(h, styles.screen())],
    [
      film(
        name,
        format(locale, `landing.${name}.film`, {}),
        h.video([...looping(h), h.OnMount(PlayWhileSeen({ tall: media.tall, wide: media.wide }))]),
        h,
      ),
      words(id, format(locale, `landing.${name}.title`, {}), format(locale, `landing.${name}.text`, {}), h),
    ],
  )
}

/** The rail: the pieces hang in profile from an oak rod; the player (`RailPlayer.ts`) turns them, slides them and tours
 * the rail. Assistive technology hears the rail's description; the pieces themselves are for the pointer. */
const rail = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-rail-title'), ...styled(h, cx(styles.screen(), styles.paperScreen()))],
    [
      h.div(
        [
          h.Role('img'),
          h.AriaLabel(format(locale, 'landing.rail.film', {})),
          h.OnMount(PlayRail({ sprites: landingRailPieces.map((piece) => landingMedia.sprite(piece)) })),
          ...styled(h, styles.rack()),
        ],
        [
          h.div(styled(h, styles.rod())),
          ...landingRailPieces.map((piece) =>
            h.keyed('button')(
              piece,
              [
                h.Type('button'),
                h.Tabindex(-1),
                h.AriaHidden(true),
                h.DataAttribute('rail-piece', piece),
                ...styled(h, styles.garment()),
              ],
              [
                h.span(styled(h, styles.wire())),
                h.canvas([h.Width('384'), h.Height('448'), ...styled(h, styles.garmentCanvas())]),
              ],
            ),
          ),
        ],
      ),
      words(
        'landing-rail-title',
        format(locale, 'landing.rail.title', {}),
        format(locale, 'landing.rail.text', {}),
        h,
        true,
      ),
    ],
  )

const answerPieces = (
  pieces: ReadonlyArray<(typeof landingAnswerPieces)[number] | (typeof landingAssistantPieces)[number]>,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    styled(h, styles.answerPieces()),
    pieces.map((piece) =>
      h.keyed('img')(piece, [
        h.Src(landingMedia.piece(piece)),
        h.Alt(''),
        h.Loading('lazy'),
        h.Decoding('async'),
        ...styled(h, styles.answerPiece()),
      ]),
    ),
  )

/** Ask Styld: a question and Styld's answer with four of the visitor's pieces. */
const ask = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-ask'), ...styled(h, cx(styles.screen(), styles.paperScreen()))],
    [
      h.div(
        [
          ...(model.playing.ask ? [h.DataAttribute('play', '')] : []),
          h.OnMount(WatchChat({ chat: 'ask' })),
          ...styled(h, styles.chat()),
        ],
        [
          h.p(styled(h, styles.question()), [format(locale, 'landing.ask.question', {})]),
          h.div(styled(h, styles.answer()), [
            h.p(styled(h, styles.answerText()), [format(locale, 'landing.ask.answer', {})]),
            answerPieces(landingAnswerPieces, h),
          ]),
        ],
      ),
      words('landing-ask', format(locale, 'landing.ask.title', {}), format(locale, 'landing.ask.text', {}), h, true),
    ],
  )

/** Styld inside ChatGPT or Claude: the visitor's question in that chat, and Styld's card with pieces from their
 * wardrobe, drawn as Styld's own view rather than as either assistant's screen. */
const assistants = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-assistants'), ...styled(h, cx(styles.screen(), styles.paperScreen()))],
    [
      h.div(
        [
          h.Role('img'),
          h.AriaLabel(format(locale, 'landing.assistants.film', {})),
          ...(model.playing.assistants ? [h.DataAttribute('play', '')] : []),
          h.OnMount(WatchChat({ chat: 'assistants' })),
          ...styled(h, cx(styles.chat(), styles.host())),
        ],
        [
          h.p(
            [h.AriaHidden(true), ...styled(h, cx(styles.question(), styles.hostQuestion()))],
            [format(locale, 'landing.assistants.question', {})],
          ),
          h.div(
            [h.AriaHidden(true), ...styled(h, styles.card())],
            [
              h.p(styled(h, styles.cardName()), ['Styld']),
              h.p(styled(h, styles.cardLine()), [format(locale, 'landing.assistants.card', {})]),
              answerPieces(landingAssistantPieces, h),
            ],
          ),
        ],
      ),
      words(
        'landing-assistants',
        format(locale, 'landing.assistants.title', {}),
        format(locale, 'landing.assistants.text', {}),
        h,
        true,
      ),
    ],
  )

const questions = ['who', 'app', 'cost', 'delete'] as const

/** The ending: the plans and the questions, with Start free still resting at the bottom. */
const ending = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabel(format(locale, 'landing.price.title', {})), ...styled(h, styles.ending())],
    [
      h.div(styled(h, styles.price()), [
        h.p(styled(h, styles.priceLead()), [
          format(locale, 'landing.price.lead', {
            free: freeCredits,
            price: plans.week.price,
            daily: memberDailyCredits,
          }),
        ]),
        h.dl(
          styled(h, styles.prices()),
          planNames.map((plan) =>
            h.div(styled(h, styles.priceRow()), [
              h.dt(styled(h, styles.priceTerm()), [format(locale, `account.plans.${plan}`, {})]),
              h.dd(styled(h, styles.priceText()), [
                format(locale, `account.plans.${plan}Price`, { price: plans[plan].price }),
              ]),
            ]),
          ),
        ),
      ]),
      h.div(
        [h.Role('group'), h.AriaLabel(format(locale, 'landing.faq.title', {})), ...styled(h, styles.questions())],
        questions.map((question) =>
          h.keyed('details')(question, styled(h, styles.questionItem()), [
            h.summary(styled(h, styles.questionSummary()), [format(locale, `landing.faq.${question}`, {})]),
            h.p(styled(h, styles.questionAnswer()), [
              format(locale, `landing.faq.${question}Answer`, {
                free: freeCredits,
                daily: memberDailyCredits,
                week: plans.week.price,
                monthly: plans.monthly.price,
                yearly: plans.yearly.price,
                lifetime: plans.lifetime.price,
              }),
            ]),
          ]),
        ),
      ),
    ],
  )

/** The landing: the hero, then the feature screens and the ending carrying Start free with them. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, { locale }, h) =>
  h.main(
    [h.Id('main')],
    [
      hero(model, locale, h),
      h.div(styled(h, styles.screens()), [
        h.div(styled(h, styles.pinned()), [startFree(locale, h, true)]),
        filmScreen('shop', locale, h),
        filmScreen('outfits', locale, h),
        filmScreen('tryOn', locale, h),
        rail(locale, h),
        ask(model, locale, h),
        assistants(model, locale, h),
        ending(locale, h),
      ]),
    ],
  ),
)
