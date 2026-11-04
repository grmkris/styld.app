import { format, type Locale } from '@styld/i18n'
import { dailyCredits, type LandingHero, landingShopPieces, type LandingShopPiece, premiumWeek } from '@styld/protocol'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { cx } from 'zyzz'
import { primaryAction, secondaryAction } from '../Actions.styles.ts'
import { chip, chosen } from '../Controls.styles.ts'
import { pauseIcon, playIcon } from '../Icon.ts'
import { signInHref } from '../route.ts'
import { styled } from '../Styled.ts'
import {
  Film,
  filmId,
  Message,
  type Model,
  PlayWhileSeen,
  type ShopFilter,
  shopFilters,
  StartFilm,
  tallQuery,
} from './Landing.ts'
import { landingMedia } from './LandingMedia.ts'
import * as styles from './LandingView.styles.ts'

// The signed-out Home (Landing.ts): the hero's film and words, then the shared page below it.

type Inputs = { readonly locale: Locale; readonly hero: LandingHero }

/** The poster first, as a picture in the shape of the screen; the film over it while motion is allowed. Its words are
 * the film's description; the media themselves say nothing to assistive technology. */
const film = (model: Model, { locale, hero }: Inputs, h: HtmlBuilder<Message>): Html =>
  h.figure(
    [h.Role('img'), h.AriaLabel(format(locale, `landing.hero.${hero}.film`, {})), ...styled(h, styles.film())],
    [
      h.picture(
        [h.AriaHidden(true)],
        [
          h.source([h.Attribute('media', tallQuery), h.Srcset(landingMedia.hero(hero, 'poster-tall.webp'))]),
          h.img([
            h.Src(landingMedia.hero(hero, 'poster-wide.webp')),
            h.Alt(''),
            h.Fetchpriority('high'),
            h.Decoding('async'),
            ...styled(h, styles.filmMedia()),
          ]),
        ],
      ),
      Film.guards.Still(model.film)
        ? h.empty
        : h.keyed('video')(hero, [
            h.Id(filmId),
            h.Muted(true),
            h.Loop(true),
            h.Playsinline(true),
            h.Preload('none'),
            h.AriaHidden(true),
            h.OnMount(
              StartFilm({
                tall: landingMedia.hero(hero, 'loop-tall.mp4'),
                wide: landingMedia.hero(hero, 'loop-wide.mp4'),
              }),
            ),
            h.OnPlay(Message.PlayedFilm()),
            h.OnPause(Message.PausedFilm()),
            ...styled(h, styles.filmMedia()),
          ]),
    ],
  )

/** Pause, or Play once paused or refused; none while motion is unchecked or not allowed. */
const filmControl = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Film.match(model.film, {
    Waiting: () => h.empty,
    Still: () => h.empty,
    Playing: () => control(format(locale, 'landing.film.pause', {}), pauseIcon(h), h),
    Paused: () => control(format(locale, 'landing.film.play', {}), playIcon(h), h),
  })

const control = (label: string, icon: Html, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel(label),
      h.Title(label),
      h.OnClick(Message.ClickedFilmControl()),
      ...styled(h, styles.filmControl()),
    ],
    [icon],
  )

const startFree = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a([h.Href(signInHref), ...styled(h, primaryAction())], [format(locale, 'landing.start', {})])

const hero = (model: Model, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return h.section(
    [h.AriaLabelledBy('landing-title'), ...styled(h, styles.hero())],
    [
      film(model, inputs, h),
      h.div(styled(h, styles.words()), [
        h.h1(
          [h.Id('landing-title'), ...styled(h, styles.title())],
          [format(locale, `landing.hero.${inputs.hero}.title`, {})],
        ),
        h.p(styled(h, styles.lede()), [format(locale, `landing.hero.${inputs.hero}.lede`, {})]),
      ]),
      h.div(styled(h, styles.actions()), [
        // One code signs in and signs up, so Start free and Sign in go to the same page: the first is for someone new.
        startFree(locale, h),
        h.a(
          [h.Href(signInHref), ...styled(h, cx(secondaryAction(), styles.quietAction()))],
          [format(locale, 'landing.signIn', {})],
        ),
      ]),
      filmControl(model, locale, h),
    ],
  )
}

/** A feature screen's words: a head and one line. */
const featureWords = (id: string, title: string, text: string, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.featureWords()), [
    h.h2([h.Id(id), ...styled(h, styles.heading())], [title]),
    h.p(styled(h, styles.text()), [text]),
  ])

/** A tall clip that plays while it is seen; its poster until then, and for good under reduced motion. */
const clip = (name: 'scan' | 'outfits', style: ReturnType<typeof styles.photoClip>, h: HtmlBuilder<Message>): Html =>
  h.video([
    h.Poster(landingMedia.clip(name, 'webp')),
    h.Muted(true),
    h.Loop(true),
    h.Playsinline(true),
    h.Preload('none'),
    h.AriaHidden(true),
    h.DataAttribute('clip', name),
    h.OnMount(PlayWhileSeen({ src: landingMedia.clip(name, 'mp4') })),
    ...styled(h, style),
  ])

/** Each shop piece's name in the catalogs. */
const pieceNames = {
  'sweater-cream': 'landing.shop.pieces.sweaterCream',
  'shirt-white': 'landing.shop.pieces.shirtWhite',
  'top-stripe': 'landing.shop.pieces.topStripe',
  'turtleneck-black': 'landing.shop.pieces.turtleneckBlack',
  'jeans-light': 'landing.shop.pieces.jeansLight',
  'trousers-brown': 'landing.shop.pieces.trousersBrown',
  'skirt-ivory': 'landing.shop.pieces.skirtIvory',
  'dress-sage': 'landing.shop.pieces.dressSage',
  'coat-camel': 'landing.shop.pieces.coatCamel',
  'sneakers-white': 'landing.shop.pieces.sneakersWhite',
  'boots-black': 'landing.shop.pieces.bootsBlack',
  'loafers-tan': 'landing.shop.pieces.loafersTan',
  'bag-cognac': 'landing.shop.pieces.bagCognac',
} as const satisfies Record<LandingShopPiece, string>

const filterLabel = (filter: ShopFilter, locale: Locale) => format(locale, `landing.shop.${filter}`, {})

/** The grid shows at most this many pieces: two rows on a desktop, three on a phone. */
const shopShown = 6

/** The wardrobe as a shop: category chips over the cut-outs, each "Already yours" where a price would be. */
const shopGrid = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(styled(h, styles.shop()), [
    h.div(
      [h.Role('group'), h.AriaLabel(format(locale, 'landing.shop.filter', {})), ...styled(h, styles.chips())],
      shopFilters.map((filter) =>
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(String(model.shop === filter)),
            h.OnClick(Message.ClickedShopFilter({ filter })),
            ...styled(h, cx(chip(), chosen(), styles.shopChip())),
          ],
          [filterLabel(filter, locale)],
        ),
      ),
    ),
    h.ul(
      styled(h, styles.grid()),
      landingShopPieces
        .filter(({ category }) => model.shop === 'all' || category === model.shop)
        .slice(0, shopShown)
        .map(({ piece }) =>
          h.keyed('li')(piece, styled(h, styles.piece()), [
            h.img([
              h.Src(landingMedia.shopPiece(piece)),
              h.Alt(''),
              h.Loading('lazy'),
              h.Decoding('async'),
              ...styled(h, styles.cutout()),
            ]),
            h.span(styled(h, styles.pieceName()), [format(locale, pieceNames[piece], {})]),
            h.span(styled(h, styles.pieceTag()), [format(locale, 'landing.shop.price', {})]),
          ]),
        ),
    ),
  ])

const priceList = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-price'), ...styled(h, styles.price())],
    [
      h.h2([h.Id('landing-price'), ...styled(h, styles.heading())], [format(locale, 'landing.price.title', {})]),
      h.dl(styled(h, styles.prices()), [
        h.div(styled(h, styles.priceRow()), [
          h.dt(styled(h, styles.priceTerm()), [format(locale, 'landing.price.free', {})]),
          h.dd(styled(h, styles.priceText()), [format(locale, 'landing.price.freeText', { credits: dailyCredits })]),
        ]),
        h.div(styled(h, styles.priceRow()), [
          h.dt(styled(h, styles.priceTerm()), [format(locale, 'landing.price.premium', {})]),
          h.dd(styled(h, styles.priceText()), [
            format(locale, 'landing.price.premiumText', {
              price: premiumWeek.price,
              credits: premiumWeek.dailyCredits,
              days: premiumWeek.days,
            }),
          ]),
        ]),
      ]),
    ],
  )

const questions = ['who', 'app', 'cost', 'delete'] as const

const faq = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('landing-faq'), ...styled(h, styles.faq())],
    [
      h.h2([h.Id('landing-faq'), ...styled(h, styles.heading())], [format(locale, 'landing.faq.title', {})]),
      h.div(
        styled(h, styles.questions()),
        questions.map((question) =>
          h.keyed('details')(question, styled(h, styles.question()), [
            h.summary(styled(h, styles.questionSummary()), [format(locale, `landing.faq.${question}`, {})]),
            h.p(styled(h, styles.answer()), [
              format(locale, `landing.faq.${question}Answer`, { credits: dailyCredits, price: premiumWeek.price }),
            ]),
          ]),
        ),
      ),
    ],
  )

/** The landing: the hero, three feature screens, the price, the questions and the way in again. While the person holds
 * the motion (`data-held`), the clips below stay still too. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) => {
  const { locale } = inputs
  return h.main(
    [h.Id('main'), ...(model.held ? [h.DataAttribute('held', '')] : [])],
    [
      hero(model, inputs, h),
      h.div(styled(h, styles.page()), [
        h.section(
          [h.AriaLabelledBy('landing-add'), ...styled(h, styles.feature())],
          [
            featureWords(
              'landing-add',
              format(locale, 'landing.add.title', {}),
              format(locale, 'landing.add.text', {}),
              h,
            ),
            clip('scan', styles.photoClip(), h),
          ],
        ),
        h.section(
          [h.AriaLabelledBy('landing-shop'), ...styled(h, styles.feature())],
          [
            featureWords(
              'landing-shop',
              format(locale, 'landing.shop.title', {}),
              format(locale, 'landing.shop.text', {}),
              h,
            ),
            shopGrid(model, locale, h),
          ],
        ),
        h.section(
          [h.AriaLabelledBy('landing-outfits'), ...styled(h, styles.feature())],
          [
            featureWords(
              'landing-outfits',
              format(locale, 'landing.outfits.title', {}),
              format(locale, 'landing.outfits.text', {}),
              h,
            ),
            clip('outfits', styles.tableClip(), h),
          ],
        ),
        priceList(locale, h),
        faq(locale, h),
        h.section(
          [h.AriaLabelledBy('landing-final'), ...styled(h, styles.final())],
          [
            h.h2([h.Id('landing-final'), ...styled(h, styles.title())], [format(locale, 'landing.final', {})]),
            startFree(locale, h),
          ],
        ),
      ]),
    ],
  )
})
