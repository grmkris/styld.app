import type { PieceType } from '@styld/protocol'

// What Muse Image is asked for a try-on (the 4 November spike, `docs/STATUS.md` › Try on): the person's photo first,
// then each piece's own picture, each named by its colours and type only. Styling words ("zipped halfway") made Muse
// invent garments the person did not choose, so none are given.

/** A garment's name in a prompt: short shop words, never the person's own notes or name for it. */
const nouns: { readonly [Type in PieceType]: string } = {
  shortSleeveTops: 'short-sleeve top',
  longSleeveTops: 'long-sleeve top',
  sleevelessTops: 'sleeveless top',
  shirts: 'shirt',
  bodysuits: 'bodysuit',
  knitwear: 'knit jumper',
  hoodies: 'hoodie',
  blazers: 'blazer',
  jackets: 'jacket',
  coats: 'coat',
  gilets: 'gilet',
  dresses: 'dress',
  jumpsuits: 'jumpsuit',
  jeans: 'jeans',
  trousers: 'trousers',
  shorts: 'shorts',
  skirts: 'skirt',
  sportswear: 'sportswear',
  sportShoes: 'sports shoes',
  outdoorShoes: 'outdoor shoes',
  swimwear: 'swimwear',
  loungewear: 'loungewear',
  trainers: 'trainers',
  boots: 'boots',
  heels: 'heels',
  flats: 'flat shoes',
  loafers: 'loafers',
  laceUps: 'lace-up shoes',
  sandals: 'sandals',
  bags: 'bag',
  belts: 'belt',
  scarves: 'scarf',
  hats: 'hat',
  gloves: 'gloves',
  socks: 'socks',
  hairAccessories: 'hair accessory',
  jewellery: 'jewellery',
  eyewear: 'glasses',
}

/** A piece as a try-on names it: "navy and white shirt". */
export const tryOnWords = (piece: { readonly type: PieceType; readonly colours: ReadonlyArray<string> }) =>
  [piece.colours.slice(0, 2).join(' and '), nouns[piece.type]].filter((part) => part !== '').join(' ')

/** The try-on prompt for the pieces' words, in the order their pictures follow the photo. */
export const tryOnPrompt = (words: ReadonlyArray<string>) =>
  [
    'This is a private virtual try-on in my own wardrobe app. Image 1 is a photo of me, the user. The other images are my own garments, each photographed on its own:',
    ...words.map((word, at) => `- Image ${String(at + 2)}: ${word}`),
    'Edit image 1 so that I am wearing exactly these garments, replacing my current clothes and shoes. Copy each garment faithfully from its picture: colour, fabric, pattern, print, logos, cut and length, fitted naturally to my body with realistic folds and shadows.',
    'Keep everything else exactly as it is in image 1: my face and identity, hair, skin tone, body shape, pose, hands and expression, the background, the light, the camera angle and the framing.',
    'Do not add or remove accessories, objects or people. Photorealistic, as if the same photo were taken again with me in these clothes.',
  ].join('\n')

/** The canvases Muse draws a try-on on, by width over height. */
const sizes = [
  { size: '1024x1024', ratio: 1 },
  { size: '1152x1536', ratio: 3 / 4 },
  { size: '1024x1536', ratio: 2 / 3 },
  { size: '1152x2048', ratio: 9 / 16 },
  { size: '1536x1152', ratio: 4 / 3 },
  { size: '1536x1024', ratio: 3 / 2 },
  { size: '2048x1152', ratio: 16 / 9 },
] as const

export type TryOnSize = (typeof sizes)[number]['size']

/** The canvas closest to the photo's shape, so the result keeps the photo's framing; portrait 3:4, a phone's photo,
 * when the photo's size is not known. */
export const tryOnSize = (photo: { readonly width: number; readonly height: number } | undefined): TryOnSize => {
  if (photo === undefined || photo.width <= 0 || photo.height <= 0) return '1152x1536'
  const ratio = photo.width / photo.height
  return sizes.reduce((best, next) => (Math.abs(next.ratio - ratio) < Math.abs(best.ratio - ratio) ? next : best)).size
}
