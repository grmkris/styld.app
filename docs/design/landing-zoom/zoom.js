// Styld landing: the endless zoom sketch.
//
// A perfect endless zoom is a Droste picture. Each scene holds, in the same spot, a window that is the next scene at
// 1/SCALE of its size, turned by TURN degrees. Every level is its own layer over the whole stage, and each layer's
// `scale` goes from SCALE^-(L-1) to SCALE over L steps, one step per level. A step multiplies the scale by SCALE along
// an exponential curve, so the zoom keeps one speed, and `rotate` turns at a steady rate beside it. After L steps
// every layer is back where it started, so the loop has no seam. No layer is ever enlarged more than SCALE times, which
// keeps the cutouts sharp.
//
// Only the layers' markup, their keyframes and the words come from this script. In the app they would be rendered on
// the server with zyzz classes, and the zoom would run with no script at all.

const CUTOUTS = 'cutouts/' // the Gallery 2 prototype's cutouts with their paper keyed out (README)
const SCALE = 2.8 // each window is 1/SCALE of the table it lies on
const TURN = 7 // degrees each window is turned: the gentle spiral
const SECONDS = 3.6 // per level

const copy = {
  en: {
    title: 'Your clothes, laid out for every day.',
    lede: 'Photograph or film what you own. Styld cuts out each piece and lays out an outfit for the day, here and in ChatGPT or Claude.',
    start: 'Start your wardrobe',
    explore: 'Explore',
    signIn: 'Sign in',
    pause: 'Pause the animation',
    play: 'Play the animation',
    daysLabel: 'Outfits for each day of the week, each one lying on the table of the day before.',
    productLabel:
      'Styld’s screens, each one inside the last: today’s outfit, the camera, the wardrobe, a board and an assistant.',
    holdUpTitle: 'Hold pieces up',
    holdUpHint: 'Your camera takes each one',
    wardrobe: 'Wardrobe',
    pieces: { one: '# piece', other: '# pieces' },
    boardLabel: 'Weekend',
    ask: 'What should I wear on Saturday?',
    answer: 'Here’s an outfit from your wardrobe.',
    composer: 'Message',
    captions: [
      'An outfit every day, from clothes you own.',
      'Hold a piece up. Styld takes the picture and cuts it out.',
      'Your whole wardrobe, cut out on paper.',
      'Boards you lay out by hand.',
      'Ask ChatGPT or Claude what to wear.',
    ],
    featuresTitle: 'What Styld does',
    features: [
      ['Add pieces your way', 'Pick up to 30 photos, hold pieces up to the camera, or film your wardrobe.'],
      ['Clean pictures', 'Every piece is cut out. Where a cut-out is rough, Styld draws a clean picture beside the real one.'],
      ['In ChatGPT and Claude', 'Your wardrobe comes with you into the assistants you already use.'],
      ['Boards', 'Lay out pieces and pictures by hand, and share the ones you like.'],
    ],
    privacy: 'Privacy',
    terms: 'Terms',
    contact: 'Contact',
  },
  sl: {
    title: 'Tvoja oblačila, pripravljena za vsak dan.',
    lede: 'Fotografiraj ali posnemi, kar imaš. Styld izreže vsak kos in ti pripravi opravo za dan, tukaj ter v ChatGPT ali Claudu.',
    start: 'Začni svojo garderobo',
    explore: 'Razišči',
    signIn: 'Prijava',
    pause: 'Ustavi animacijo',
    play: 'Predvajaj animacijo',
    daysLabel: 'Oprave za vsak dan v tednu, vsaka položena na mizo prejšnjega dne.',
    productLabel: 'Zasloni Styld, vsak v prejšnjem: današnja oprava, kamera, garderoba, zbirka in pomočnik.',
    holdUpTitle: 'Pokaži kose kameri',
    holdUpHint: 'Kamera vsakega fotografira sama',
    wardrobe: 'Garderoba',
    pieces: { one: '# kos', two: '# kosa', few: '# kosi', other: '# kosov' },
    boardLabel: 'Vikend',
    ask: 'Kaj naj oblečem v soboto?',
    answer: 'Tukaj je oprava iz tvoje garderobe.',
    composer: 'Sporočilo',
    captions: [
      'Vsak dan oprava iz oblačil, ki jih imaš.',
      'Pokaži kos kameri. Styld ga fotografira in izreže.',
      'Vsa tvoja garderoba, izrezana na papirju.',
      'Zbirke, ki jih sestaviš sam.',
      'Vprašaj ChatGPT ali Claude, kaj obleči.',
    ],
    featuresTitle: 'Kaj naredi Styld',
    features: [
      ['Kose dodajaj po svoje', 'Izberi do 30 fotografij, pokaži kose kameri ali posnemi svojo garderobo.'],
      ['Čiste slike', 'Vsak kos je izrezan. Kjer je izrez grob, Styld poleg prave fotografije nariše čisto sliko.'],
      ['V ChatGPT in Claudu', 'Tvoja garderoba gre s tabo v pomočnike, ki jih že uporabljaš.'],
      ['Zbirke', 'Kose in slike razporedi sam in deli tiste, ki so ti všeč.'],
    ],
    privacy: 'Zasebnost',
    terms: 'Pogoji',
    contact: 'Kontakt',
  },
}

// Pseudo-locales, as the app offers them on the preview: en-XA lengthens every string by about a third, ar-XB mirrors
// English right to left.
const accents = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) => [
    c,
    [...'åƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ'][i],
  ]),
)
const filler = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen'
const locales = {
  en: { base: 'en', dir: 1, wrap: (s) => s },
  sl: { base: 'sl', dir: 1, wrap: (s) => s },
  'en-XA': {
    base: 'en',
    dir: 1,
    wrap: (s) => `[${[...s].map((c) => accents[c] ?? c).join('')} ${filler.slice(0, Math.ceil(s.length * 0.35)).trim()}]`,
  },
  'ar-XB': { base: 'en', dir: -1, wrap: (s) => `‮${s}‬` },
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const context = (lang) => {
  const locale = locales[lang]
  const words = copy[locale.base]
  const t = (key) => locale.wrap(words[key])
  const plural = (forms, n) =>
    locale.wrap((forms[new Intl.PluralRules(locale.base).select(n)] ?? forms.other).replace('#', String(n)))
  const today = new Date()
  const weekday = (k) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k)
    const name = new Intl.DateTimeFormat(locale.base, { weekday: 'long' }).format(date)
    return locale.wrap(name.toLocaleUpperCase(locale.base))
  }
  return { lang, locale, words, t, plural, weekday, dir: locale.dir }
}

// A cutout centred at (x, y) in % of the table, `w` % of its width wide. The cutouts are square, and the table is 4:5,
// so a cutout is 0.8w % of the table's height tall.
const piece = (name, x, y, w, turn = 0) =>
  `<img class="piece" src="${CUTOUTS}${name}.webp" alt="" draggable="false" decoding="async" ` +
  `style="left:${x - w / 2}%;top:${y - 0.4 * w}%;width:${w}%;rotate:${turn}deg">`

// Something drawn around the window, turned with it.
const around = (ctx, html) => `<div class="window" style="rotate:${ctx.dir * TURN}deg">${html}</div>`

const outfits = [
  ['shirt-denim', 'knit-navy', 'shorts-denim', 'converse-high'],
  ['tee-grey', 'jacket-track-black', 'shorts-sky', 'af1-white'],
  ['henley-charcoal', 'fleece-cream', 'shorts-denim', 'derby-black'],
  ['shirt-flannel', 'hoodie-grey', 'shorts-sky', 'converse-low'],
  ['longsleeve-stripe', 'knit-cable-navy', 'shorts-denim', 'sandals-birkenstock'],
  ['polo-navy', 'crew-grey', 'shorts-sky', 'af1-white'],
  ['vneck-navy', 'jacket-track-black', 'shorts-denim', 'converse-low'],
]

const scenes = {
  // One day's table: the day in Anton and an outfit around the window.
  day: (ctx, k) => {
    const [top, layer, bottom, shoes] = outfits[k % outfits.length]
    return (
      `<p class="day">${esc(ctx.weekday(k))}</p>` +
      piece(top, 17, 31, 25, -3) +
      piece(layer, 83, 33, 25, 4) +
      piece(bottom, 16, 66, 24, 2) +
      piece(shoes, 84, 76, 24, -3)
    )
  },
  camera: (ctx) =>
    `<p class="camera-title">${esc(ctx.t('holdUpTitle'))}</p>` +
    `<p class="camera-hint">${esc(ctx.t('holdUpHint'))}</p>` +
    around(ctx, '<i class="bracket tl"></i><i class="bracket tr"></i><i class="bracket bl"></i><i class="bracket br"></i>') +
    '<span class="shutter"></span>',
  wardrobe: (ctx) =>
    `<p class="wardrobe-title">${esc(ctx.t('wardrobe'))}</p>` +
    `<p class="wardrobe-count">${esc(ctx.plural(ctx.words.pieces, 28))}</p>` +
    [
      ['tee-black', 17, 22],
      ['shirt-sky', 50, 22],
      ['knit-cable-navy', 83, 22],
      ['hoodie-grey', 17, 50],
      ['shorts-sky', 83, 50],
      ['converse-low', 17, 80],
      ['longsleeve-stripe', 50, 80],
      ['af1-white', 83, 80],
    ]
      .map(([name, x, y]) => piece(name, x, y, 17))
      .join(''),
  board: (ctx) =>
    `<p class="board-label">${esc(ctx.locale.wrap(ctx.words.boardLabel.toLocaleUpperCase(ctx.locale.base)))}</p>` +
    piece('shirt-flannel', 17, 34, 25, -8) +
    piece('fleece-cream', 84, 31, 23, 9) +
    piece('shorts-denim', 15, 67, 23, 6) +
    piece('sandals-birkenstock', 85, 69, 23, -7) +
    piece('longsleeve-black', 50, 86, 19, 3),
  assistant: (ctx) =>
    `<p class="bubble">${esc(ctx.t('ask'))}</p>` +
    around(ctx, '<span class="app-chip">STYLD</span>') +
    `<p class="answer">${esc(ctx.t('answer'))}</p>` +
    `<p class="composer">${esc(ctx.t('composer'))}</p>`,
}

// `frame` is how a level looks lying inside the scene before it.
const subjects = {
  days: (ctx) =>
    ['paper', 'sand', 'stock', 'sage', 'paper', 'clay', 'slate'].map((paper, k) => ({
      bg: `var(--${paper})`,
      frame: 'polaroid',
      html: scenes.day(ctx, k),
    })),
  product: (ctx) => [
    { bg: 'var(--paper)', frame: 'card', html: scenes.day(ctx, 0) },
    { bg: 'var(--ink)', frame: 'screen', html: scenes.camera(ctx) },
    { bg: 'var(--paper)', frame: 'none', html: scenes.wardrobe(ctx) },
    { bg: 'var(--sage)', frame: 'pin', html: scenes.board(ctx) },
    { bg: 'var(--stock)', frame: 'pin', html: scenes.assistant(ctx) },
  ],
}

// The exponential step as a CSS linear() curve: the scale at time x of a step is SCALE^x, so progress is
// (SCALE^x - 1) / (SCALE - 1). The app samples its springs into linear() the same way.
const exponential = (points = 32) =>
  'linear(' +
  Array.from({ length: points + 1 }, (_, i) => {
    const x = i / points
    return `${((SCALE ** x - 1) / (SCALE - 1)).toFixed(5)} ${(x * 100).toFixed(3)}%`
  }).join(', ') +
  ')'

// Depth u: 0 fills the stage, 1 lies in its window, -1 has been zoomed past. A level travels from L-1 to -1 in one
// period; a deeper level draws above a shallower one.
const keyframes = (L, dir) => {
  const period = L * SECONDS
  const at = (u) => (100 * (L - 1 - u)) / L
  const steps = Array.from({ length: L + 1 }, (_, i) => {
    const u = L - 1 - i
    return `${at(u).toFixed(4)}% { scale: ${(SCALE ** -u).toFixed(6)}; z-index: ${u + 2}; }`
  })
  // A caption shows while its level is the one you are looking at, from depth 0.5 to -0.5. It fades in and out
  // inside that span, so the outgoing caption is gone before the next one appears.
  const caption = [
    `0% { opacity: 0 }`,
    `${at(0.5).toFixed(3)}% { opacity: 0 }`,
    `${at(0.36).toFixed(3)}% { opacity: 1 }`,
    `${at(-0.36).toFixed(3)}% { opacity: 1 }`,
    `${at(-0.5).toFixed(3)}% { opacity: 0 }`,
    `100% { opacity: 0 }`,
  ]
  return `
@keyframes zoom { ${steps.join(' ')} }
@keyframes turn { from { rotate: ${(dir * TURN * (L - 1)).toFixed(3)}deg } to { rotate: ${(-dir * TURN).toFixed(3)}deg } }
@keyframes caption { ${caption.join(' ')} }
.level { animation-name: zoom, turn; animation-duration: ${period}s, ${period}s; animation-timing-function: ${exponential()}, linear; }
.caption { animation-name: caption; animation-duration: ${period}s; animation-timing-function: linear; }`
}

const icons = {
  pause:
    '<svg viewBox="0 0 256 256" aria-hidden="true"><rect x="60" y="40" width="44" height="176" rx="12" fill="currentColor"/><rect x="152" y="40" width="44" height="176" rx="12" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M80 44 L208 128 L80 212 Z" fill="currentColor" stroke="currentColor" stroke-width="16" stroke-linejoin="round"/></svg>',
}

const params = new URLSearchParams(location.search)
const pick = (name, allowed, fallback) => (allowed.includes(params.get(name)) ? params.get(name) : fallback)
const state = {
  subject: pick('subject', ['days', 'product'], 'days'),
  lang: pick('lang', ['en', 'sl', 'en-XA', 'ar-XB'], 'en'),
  motion: pick('motion', ['on', 'reduce'], 'on'),
  userPaused: false,
  offscreen: false,
}

const style = document.createElement('style')
document.head.append(style)
const zoom = document.querySelector('.zoom')
const stage = document.querySelector('.stage')
const captions = document.querySelector('.captions')
const pause = document.querySelector('.pause')

const syncPause = (ctx) => {
  zoom.classList.toggle('paused', state.userPaused || state.offscreen)
  pause.innerHTML = state.userPaused ? icons.play : icons.pause
  pause.setAttribute('aria-label', ctx.t(state.userPaused ? 'play' : 'pause'))
}

const render = () => {
  const ctx = context(state.lang)
  document.documentElement.lang = state.lang
  document.documentElement.dir = ctx.dir < 0 ? 'rtl' : 'ltr'

  for (const element of document.querySelectorAll('[data-t]')) element.textContent = ctx.t(element.dataset.t)
  document.querySelector('.features dl').innerHTML = ctx.words.features
    .map(([term, detail]) => `<div><dt>${esc(ctx.locale.wrap(term))}</dt><dd>${esc(ctx.locale.wrap(detail))}</dd></div>`)
    .join('')

  const levels = subjects[state.subject](ctx)
  const L = levels.length
  style.textContent = keyframes(L, ctx.dir)
  zoom.style.setProperty('--zoom-scale', String(SCALE))
  zoom.classList.toggle('still', state.motion === 'reduce')
  zoom.innerHTML = levels
    .map((level, k) => {
      const delay = -(L - 1 - k) * SECONDS
      return (
        `<div class="level frame-${level.frame}" style="--bg:${level.bg};--still-scale:${SCALE ** -k};` +
        `--still-turn:${ctx.dir * TURN * k}deg;--still-z:${k + 2};animation-delay:${delay}s,${delay}s">` +
        `${level.html}</div>`
      )
    })
    .join('')

  stage.setAttribute('aria-label', ctx.t(state.subject === 'days' ? 'daysLabel' : 'productLabel'))
  captions.innerHTML =
    state.subject === 'product'
      ? ctx.words.captions
          .map((_, k) => `<p class="caption" style="animation-delay:${-(L - 1 - k) * SECONDS}s">${esc(ctx.locale.wrap(ctx.words.captions[k]))}</p>`)
          .join('')
      : ''
  syncPause(ctx)

  const form = document.querySelector('.sketch-bar')
  form.subject.value = state.subject
  form.lang.value = state.lang
  form.motion.value = state.motion
}

document.querySelector('.sketch-bar').addEventListener('change', (event) => {
  const { name, value } = event.target
  state[name] = value
  const url = new URL(location.href)
  url.searchParams.set(name, value)
  history.replaceState(null, '', url)
  render()
})

pause.addEventListener('click', () => {
  state.userPaused = !state.userPaused
  syncPause(context(state.lang))
})

// Off screen, the zoom stops.
new IntersectionObserver(([entry]) => {
  state.offscreen = !entry.isIntersecting
  syncPause(context(state.lang))
}).observe(zoom)

render()
