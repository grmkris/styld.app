import { format, type Locale } from '@styld/i18n'
import {
  freeCredits,
  landingAnswerPieces,
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
import {
  Film,
  Message,
  type Model,
  PlayWhileSeen,
  railId,
  showsFront,
  StartFilm,
  tallQuery,
  WatchChat,
  WatchRail,
} from './Landing.ts'
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

/** A rail piece's style once the rail is near: each with its own sprite. */
const withSprite = {
  'coat-camel': () => cx(styles.railPiece(), styles.coatCamel()),
  'sweater-cream': () => cx(styles.railPiece(), styles.sweaterCream()),
  'dress-sage': () => cx(styles.railPiece(), styles.dressSage()),
  'shirt-white': () => cx(styles.railPiece(), styles.shirtWhite()),
  'top-stripe': () => cx(styles.railPiece(), styles.topStripe()),
} as const

/** The rail: the pieces hang from an oak rod and swipe; the one in front turns to show its front. */
const rail = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-rail-title'), ...styled(h, cx(styles.screen(), styles.paperScreen()))],
    [
      h.div(
        [h.Role('img'), h.AriaLabel(format(locale, 'landing.rail.film', {})), ...styled(h, styles.railStage())],
        [
          h.div(styled(h, styles.railRod())),
          h.div(
            [h.Id(railId), h.AriaHidden(true), h.OnMount(WatchRail()), ...styled(h, styles.railRow())],
            landingRailPieces.map((piece, index) =>
              h.keyed('div')(piece, [
                ...(showsFront(model.rail, index) ? [h.DataAttribute('front', '')] : []),
                ...styled(h, model.rail.near ? withSprite[piece]() : styles.railPiece()),
              ]),
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

/** Ask Styld: a question and Styld's answer with four of the visitor's pieces. */
const ask = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-ask'), ...styled(h, cx(styles.screen(), styles.paperScreen()))],
    [
      h.div(
        [
          ...(model.chatShown ? [h.DataAttribute('play', '')] : []),
          h.OnMount(WatchChat()),
          ...styled(h, styles.chat()),
        ],
        [
          h.p(styled(h, styles.question()), [format(locale, 'landing.ask.question', {})]),
          h.div(styled(h, styles.answer()), [
            h.p(styled(h, styles.answerText()), [format(locale, 'landing.ask.answer', {})]),
            h.div(
              styled(h, styles.answerPieces()),
              landingAnswerPieces.map((piece) =>
                h.keyed('img')(piece, [
                  h.Src(landingMedia.answerPiece(piece)),
                  h.Alt(''),
                  h.Loading('lazy'),
                  h.Decoding('async'),
                  ...styled(h, styles.answerPiece()),
                ]),
              ),
            ),
          ]),
        ],
      ),
      words('landing-ask', format(locale, 'landing.ask.title', {}), format(locale, 'landing.ask.text', {}), h, true),
    ],
  )

const questions = ['who', 'app', 'cost', 'delete'] as const

/** The ending: the way in, the price and the questions. */
const ending = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-final'), ...styled(h, styles.ending())],
    [
      h.div(styled(h, styles.final()), [
        h.h2(
          [h.Id('landing-final'), ...styled(h, cx(styles.title(), styles.finalTitle()))],
          [format(locale, 'landing.final', {})],
        ),
        startFree(locale, h),
      ]),
      h.div(styled(h, styles.price()), [
        h.p(styled(h, styles.priceLead()), [
          format(locale, 'landing.price.lead', {
            free: freeCredits,
            price: plans.week.price,
            daily: memberDailyCredits,
          }),
        ]),
        h.dl(
          [h.AriaLabel(format(locale, 'landing.price.title', {})), ...styled(h, styles.prices())],
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

/** The landing: the hero, the feature screens carrying Start free with them, and the ending. */
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
        rail(model, locale, h),
        ask(model, locale, h),
      ]),
      ending(locale, h),
    ],
  ),
)
