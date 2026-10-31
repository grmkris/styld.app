// Styld landing: the film. The loop is a generated video with no words in it; this script only picks the film for
// the screen's shape, writes the words in the visitor's language and keeps the captions in step with the film.

const copy = {
  en: {
    title: 'Your wardrobe, on paper.',
    lede: 'Photograph or film your clothes. Styld cuts out every piece, and you lay out outfits and boards, here or in ChatGPT and Claude.',
    start: 'Add your clothes',
    explore: 'Explore',
    signIn: 'Sign in',
    pause: 'Pause the film',
    play: 'Play the film',
    film: 'Five pieces of clothing come down from a rail and land as flat cut-outs on a paper board, then hang themselves back up.',
    beats: ['Every piece, cut out.', 'Laid out on your boards.', 'Yours too?'],
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
    title: 'Tvoja garderoba, na papirju.',
    lede: 'Fotografiraj ali posnemi svoja oblačila. Styld izreže vsak kos, ti pa sestavljaš oprave in zbirke, tukaj ali v ChatGPT in Claudu.',
    start: 'Dodaj svoja oblačila',
    explore: 'Razišči',
    signIn: 'Prijava',
    pause: 'Ustavi film',
    play: 'Predvajaj film',
    film: 'Pet kosov oblačil se spusti z obešalnika in pristane kot ploski izrezi na papirni tabli, nato se spet obesijo nazaj.',
    // "Bi rad/rada …" would ask by gender; the question names the clothes instead.
    beats: ['Vsak kos, izrezan.', 'Razložen na tvojih zbirkah.', 'Tudi tvoja oblačila?'],
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

// Where each caption starts, as a share of the loop: the pieces coming down, the board, the empty board again.
const beatStarts = [0, 0.3, 0.62]

const icons = {
  pause:
    '<svg viewBox="0 0 256 256" aria-hidden="true"><rect x="60" y="40" width="44" height="176" rx="12" fill="currentColor"/><rect x="152" y="40" width="44" height="176" rx="12" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M80 44 L208 128 L80 212 Z" fill="currentColor" stroke="currentColor" stroke-width="16" stroke-linejoin="round"/></svg>',
}

const params = new URLSearchParams(location.search)
const lang = params.get('lang') === 'sl' ? 'sl' : 'en'
const words = copy[lang]
document.documentElement.lang = lang

for (const element of document.querySelectorAll('[data-t]')) element.textContent = words[element.dataset.t]
for (const link of document.querySelectorAll('[data-lang]')) link.setAttribute('aria-current', String(link.dataset.lang === lang))
document.querySelector('.features dl').innerHTML = words.features
  .map(([term, detail]) => `<div><dt>${term}</dt><dd>${detail}</dd></div>`)
  .join('')

const film = document.querySelector('.film')
const video = document.querySelector('.video')
const pause = document.querySelector('.pause')
const beat = document.querySelector('.beat')
film.setAttribute('aria-label', words.film)

// The film is fetched only when motion is welcome and data is not being saved; otherwise the first frame stays.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('motion') === 'reduce'
const saving = navigator.connection?.saveData === true
const tall = matchMedia('(max-aspect-ratio: 4/5)')

let current = -1
const showBeat = (index) => {
  if (index === current) return
  current = index
  beat.classList.add('leaving')
  setTimeout(() => {
    beat.textContent = words.beats[index]
    beat.classList.remove('leaving')
  }, 280)
}
showBeat(0)

if (!reduced && !saving) {
  const load = () => {
    video.src = tall.matches ? 'media/loop-tall.mp4' : 'media/loop-wide.mp4'
    video.play().catch(() => film.classList.remove('playing'))
  }
  load()
  tall.addEventListener('change', load)
  video.addEventListener('playing', () => film.classList.add('playing'))

  // Captions follow the film's own clock, so a paused or stalled film keeps them in step.
  const follow = () => {
    if (video.duration > 0) {
      const share = video.currentTime / video.duration
      showBeat(beatStarts.findLastIndex((start) => share >= start))
    }
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(follow)
  }
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(follow)
  else video.addEventListener('timeupdate', follow)

  let paused = false
  let offscreen = false
  const sync = () => {
    pause.innerHTML = paused ? icons.play : icons.pause
    pause.setAttribute('aria-label', paused ? words.play : words.pause)
    if (paused || offscreen) video.pause()
    else video.play().catch(() => {})
  }
  pause.hidden = false
  pause.addEventListener('click', () => {
    paused = !paused
    sync()
  })
  new IntersectionObserver(([entry]) => {
    offscreen = !entry.isIntersecting
    sync()
  }).observe(film)
  sync()
}
