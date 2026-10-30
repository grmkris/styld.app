# Styld landing: the endless zoom sketch

A sketch for the signed-out Home, made after the owner's brainstorm of 2026-10-31. The hero is a table that zooms into
itself forever, in a gentle spiral, with a quiet page below. It follows the hero-kit plan in myplan ("Our own
landing-page hero kit: plan"): a free sketch first, nothing generated or paid for.

Open `index.html` through any static server, or the tailnet preview `https://netcup.tail5acf67.ts.net/styld-landing-zoom/`.
The sketch bar switches:

- **Subject:** `?subject=days`, each day of the week lying on the table of the day before, or `?subject=product`, the
  Home table, the camera, the wardrobe, a board and an assistant, one inside the other, with a caption per level;
- **Language:** `?lang=en|sl`, plus the preview's pseudo-locales `en-XA` (a third longer) and `ar-XB` (right to left);
- **Motion:** `?motion=reduce` shows the still frame that `prefers-reduced-motion` gets.

## How the loop works

Each scene holds a window in its centre that is the next scene at 1/2.8 of its size, turned 7°. Every level is its own
layer over the whole stage. Each layer's `scale` runs from 2.8^-(L-1) to 2.8 over L steps, along an exponential
`linear()` curve so the zoom keeps one speed, and its `rotate` turns at a steady rate beside it. After L steps every
layer is back where it started, so the loop has no seam. A deeper layer draws above a shallower one through `z-index`
in the same keyframes. No layer is ever enlarged more than 2.8 times.

The zoom is CSS animation on `scale` and `rotate` only. `zoom.js` writes the layers, their keyframes and the words. In
the app the same markup would be rendered on the server with zyzz classes: positions are fixed, so nothing needs the
CSSOM, and the edge CSP stays as it is.

## Translation

Every word on the stage is live text: the day names come from `Intl.DateTimeFormat` in the visitor's language, counts
from `Intl.PluralRules` ("28 kosov"), and the rest from the catalog strings. No picture carries a word. The day names
use Anton, whose latin-ext file covers č, š and ž. In right-to-left text the spiral turns the other way.

What that means for the real build:

- Every string goes into `packages/i18n/catalogs/en.json` and `sl.json` and through `translations:check`.
- The poster, the OG still and the og:video are rendered once per language from the page itself, never shared.
- Generated art, if any is ever used, must contain no lettering, and a check must reject frames that do.

## Evidence (Chromium, 2026-10-31)

`/tmp/styld-zoom-check/check.ts`, a throwaway script run against a local server, seeks every animation with the Web
Animations API and compares screenshots of the stage:

- Frame 0 and the frame one full period later differ by at most 2/255 per channel (rounding), for both subjects in
  en, sl, en-XA and ar-XB. One level apart they differ everywhere, as they should.
- Under reduced motion no animation runs and the pause button is hidden.
- No page errors.

## Not checked, and sketch-only shortcuts

- **Safari is unchecked.** This box's Playwright WebKit needs system libraries it doesn't have. The page relies on
  `linear()` easing, individual transform properties and `clip-path`, all inside the accepted Safari 17.5 baseline, but it
  has to be seen on an iPhone.
- **Memory and smoothness on a phone** are unmeasured. Seven full-stage layers animate at once; the app should measure
  frame times and GPU memory on a real phone before keeping seven levels.
- **The cutouts** in `cutouts/` are the Gallery 2 prototype's (`../gallery-2/site/v2/assets/w/`), which were flattened
  onto the paper colour. For this sketch the paper was keyed out from the edges inwards. The white folded tee lost too
  much, so it is not used. Some carry shop logos. The real landing should use the `@styld` house account's clean
  pictures at about twice this resolution, because a piece is shown up to 2.8 times larger just before it leaves.
- **Captions over motion:** the product loop's captions change every 3.6 s. Whether that reads comfortably is a
  question for the owner.
- `DESIGN.md` allows "one reveal at most on a public page" and says every motion answers the person. A landing zoom
  needs a deliberate exception there before it ships.
