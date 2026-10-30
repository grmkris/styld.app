import { IntlMessageFormat } from 'intl-messageformat'

// The same runtime as v2's `@styld/i18n`: ICU messages per language, formatted with intl-messageformat.
// In v2 these strings live in packages/i18n/catalogs/{en,sl}.json and x18n checks them; here the Slovenian
// catalog is typed against the English one, so a missing translation fails the typecheck.

const en = {
  table: {
    title: 'Your table',
    hint: 'Drag a piece to move it. Pinch it, or drag its corner, to resize and turn it.',
    keys: 'With a keyboard: arrows move, + and − resize, [ and ] turn, Delete takes it off, ⌘Z undoes.',
    paper: 'The table',
    count: '{count, plural, one {# piece on the table} other {# pieces on the table}}',
    saved: 'Saved on this device',
    unsaved: 'Saving…',
    saveFailed: 'Couldn’t save on this device',
    undo: 'Undo',
    redo: 'Redo',
    tidy: 'Tidy up',
    startOver: 'Start over',
    remove: 'Take {name} off',
    turnHandle: 'Resize and turn',
    wardrobe: 'Add from your wardrobe',
    add: 'Put {name} on the table',
    takeOff: 'Take {name} off the table',
    stress: 'Stress test: 50 pieces',
    about: 'A spike: the table built with Foldkit alone, no canvas library.',
    back: 'Back to the prototype',
    language: 'Language',
  },
  pieces: {
    'knit-cable-navy': 'Cable knit',
    'shirt-sky': 'Oxford shirt',
    'shorts-denim': 'Denim shorts',
    'derby-black': 'Derby shoes',
    'tee-white-folded': 'White tee',
    'crew-grey': 'Grey crewneck',
    'converse-high': 'High tops',
    'af1-white': 'White trainers',
    'shirt-flannel': 'Flannel shirt',
    'fleece-cream': 'Fleece jacket',
    'polo-navy': 'Navy polo',
    'turtleneck-black': 'Turtleneck',
    'longsleeve-stripe': 'Breton stripe',
    'sandals-birkenstock': 'Sandals',
    'hoodie-grey': 'Grey hoodie',
    'shirt-denim': 'Denim shirt',
  },
}

type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> }

const sl: Shape<typeof en> = {
  table: {
    title: 'Tvoja miza',
    hint: 'Kos premakneš tako, da ga povlečeš. Z dvema prstoma ali s povlekom kota mu spremeniš velikost in ga obrneš.',
    keys: 'S tipkovnico: puščice premikajo, + in − spreminjata velikost, [ in ] obračata, Delete odstrani, ⌘Z razveljavi.',
    paper: 'Miza',
    count: '{count, plural, one {# kos na mizi} two {# kosa na mizi} few {# kosi na mizi} other {# kosov na mizi}}',
    saved: 'Shranjeno v tej napravi',
    unsaved: 'Shranjujem …',
    saveFailed: 'Shranjevanje v tej napravi ni uspelo',
    undo: 'Razveljavi',
    redo: 'Uveljavi znova',
    tidy: 'Pospravi',
    startOver: 'Začni znova',
    remove: 'Umakni: {name}',
    turnHandle: 'Spremeni velikost in obrni',
    wardrobe: 'Dodaj iz garderobe',
    add: 'Postavi na mizo: {name}',
    takeOff: 'Umakni z mize: {name}',
    stress: 'Obremenitveni test: 50 kosov',
    about: 'Preizkus: miza, narejena samo s Foldkitom, brez knjižnice za platno.',
    back: 'Nazaj na prototip',
    language: 'Jezik',
  },
  pieces: {
    'knit-cable-navy': 'Pleten pulover',
    'shirt-sky': 'Srajca oxford',
    'shorts-denim': 'Kratke kavbojke',
    'derby-black': 'Čevlji derby',
    'tee-white-folded': 'Bela majica',
    'crew-grey': 'Siv pulover',
    'converse-high': 'Visoke superge',
    'af1-white': 'Bele superge',
    'shirt-flannel': 'Flanelasta srajca',
    'fleece-cream': 'Flis jakna',
    'polo-navy': 'Temno modra polo majica',
    'turtleneck-black': 'Pulover z visokim ovratnikom',
    'longsleeve-stripe': 'Črtasta majica',
    'sandals-birkenstock': 'Sandali',
    'hoodie-grey': 'Siv pulover s kapuco',
    'shirt-denim': 'Jeans srajca',
  },
}

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type MessageKey = Leaves<typeof en>
export type Locale = 'en' | 'sl'
export type WardrobeKey = keyof typeof en.pieces

export const wardrobeKeys = Object.keys(en.pieces) as ReadonlyArray<WardrobeKey>

const catalogs: Record<Locale, Shape<typeof en>> = { en, sl }
const formatters = new Map<string, IntlMessageFormat>()

const source = (locale: Locale, key: MessageKey): string =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalogs[locale]) as string

export const format = (
  locale: Locale,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string => {
  const cacheKey = `${locale}:${key}`
  const cached = formatters.get(cacheKey)
  const formatter = cached ?? new IntlMessageFormat(source(locale, key), locale)
  if (cached === undefined) {
    formatters.set(cacheKey, formatter)
  }
  const rendered = formatter.format(values)
  return typeof rendered === 'string' ? rendered : String(rendered)
}

export const isWardrobeKey = (key: string): key is WardrobeKey => Object.hasOwn(en.pieces, key)

export const pieceName = (locale: Locale, key: string): string =>
  isWardrobeKey(key) ? format(locale, `pieces.${key}`) : key
