# Design: Styld

**Gallery 2** is Styld v2's design (owner decision, 2026-10-30): Gallery's paper, ink and cutouts, with one idea
added. **Your clothes are the interface.** Home opens on today's outfit laid out on paper (the table), and a board is a
table you arrange yourself. It replaced Gallery 1 (2026-10-28), which replaced v1's Atelier.

The prototypes:

- `docs/design/gallery-2/` (open `site/index.html`) is the current one. Its README says which parts v2 takes now:
  your own wardrobe only, no feed or other people.
- `docs/design/gallery/` is Gallery 1, kept for screens Gallery 2 doesn't redraw.
- `docs/design/canvas-spike/` is the table's proof of concept.

This file states the rules, and every screen agent reads it and the prototype first. When a screen is built, follow the
prototype's layout and this file's rules; where they disagree, ask. Change this file on purpose; it is the rule.

Things you own are cutouts on paper. One sans face, plus the logo's condensed face in exactly two places (Type). Warm
paper, umber ink, one slate signal. Pill-shaped actions, soft panels and sheets, photos with small corners. Light mode
only.

## Tokens

`apps/web/src/zyzz.config.ts` is the source of truth; never a literal colour or `font-family` outside it (the `zyzz`
skill covers usage). Add a token there before a screen needs a new value.

| Role                                                        | Value                 | Token              |
| ----------------------------------------------------------- | --------------------- | ------------------ |
| paper: the page; styld.app's own, so cutouts sit seamlessly | `#f1eee7`             | `paper`            |
| paper-2: hovered controls, inactive chips, the search pill  | `#e7e2d9`             | `paper2`           |
| stock: fields, sheets and cards above the paper             | `#fbf9f5`             | `stock`            |
| ink: text and the primary fill                              | `#1c1410`             | `ink`              |
| hovered ink fill                                            | ink 86% towards paper | `inkHover`         |
| ink-2: secondary text and meta                              | `#5d554e`             | `ink2`             |
| ink-3: counts, placeholders, the word in a divider          | `#8b827a`             | `ink3`             |
| rule: hairlines and field edges                             | `#ddd6cc`             | `rule`             |
| signal: the one slate accent                                | `#2f4f7c`             | `signal`           |
| on-ink: text and icons on an ink fill                       | `#f7f4ee`             | `onInk`            |
| focus ring                                                  | `#2f5bd3`             | `focus`            |
| error text, invalid field edge                              | v2's own              | `error`, `invalid` |

Radii: `photo` 4px, `field` 12px, `panel` 16px, `sheet` 24px, `table` 28px (the paper of a table), `pill` for actions,
chips, the search field and the floating nav. Spacing: a 20px page gutter (plus the safe-area insets), 16px between grid
items, 8px between actions in a row.

A board's paper takes one of six colours (`Paper` in `packages/protocol/src/Board.ts`): paper, stock, and the quiet tints
`sand`, `sage`, `slate` and `clay`. They are tokens, used only as a table's ground. The floating nav and the Ask panel
are glass: the `glass` fill and a `glassEdge` hairline.

The prototype has more tokens that v2 adds with the first screen that needs them: `veil` and `scrim` (overlays on photos
and behind sheets), `frost` (round buttons over photos), `shade-1` and `shade-2` (shadows), `line` (a hairline over a
photo), and the catalog colour swatches (`--c-*`, v1's catalog classification colours).

### Signal

The signal marks a text link's underline and state: in progress, active, the current selection. Under 4% of a screen.
Never a second accent colour.

## Type

Hanken Grotesk is the face, self-hosted as the variable font (`@fontsource-variable/hanken-grotesk`, latin and
latin-ext). No serif.

The logo's voice is **Anton**, a condensed display face, self-hosted as one subset file. It is used in exactly two
places:

- **The table's headline:** today's day and date on Home, e.g. `THU 30`.
- **A headline label someone puts on their own board.**

Never on chrome, titles or buttons.

- **Display** 46px and up, line-height 1, weight 700, tracking −0.035em: the landing statement only.
- **H1** 30px, line-height 1.08, weight 600, tracking −0.02em (26px inside a panel). **H2** 22px, 600, −0.01em. **H3**
  17px, 600.
- **Body** 16px, line-height 1.5, weight 400. Lede 17px in ink-2. Small text 13–14px. Labels 14px, weight 600.
- Counts and prices use tabular figures. Sentence case everywhere; no uppercase, small caps or letter-spacing on labels.
- Heads balance their lines; paragraphs wrap pretty and stay under 65ch.

## Controls

Controls render through `@foldkit/ui`'s headless views (text buttons through `actionButton` in
`apps/web/src/ActionButton.ts`), and zyzz styles them; the shared styles live in `apps/web/src/Actions.styles.ts`.

- **Primary** (`primaryAction`): an ink pill with on-ink text, 48px tall, 20px sides, 15px weight 600. Hover moves the
  fill towards paper; press scales to 0.96. One per screen; full width at the end of a form or sheet.
- **Secondary** (`secondaryAction`): the same pill with a 1.5px ink ring and no fill; hover tints it paper-2.
- **Small**: 40px tall, 16px sides, 14px, with the touch target kept at 44px.
- **Round**: 44px circles for icon-only actions; a frosted round over photos.
- **Chips**: 36px pills, 14px weight 500 in ink-2; the selected chip is filled ink. Inactive chips in a wrapping set sit
  on paper-2.
- **Tabs**: text tabs; the current one is ink, weight 600, with a 2px ink underline.
- **Search**: a 48px paper-2 pill with the search icon.
- **Fields**: 52px tall, `field` radius, stock fill, a 1px rule edge, the label above in 14px weight 600. Focus is the
  focus-coloured outline, never a border change; an invalid field takes the `invalid` edge.
- **Text links**: semibold ink over a 1.5px signal underline, offset 4px.
- **Dividers** with a word ("or"): rule lines either side of the word in ink-3.
- Every control: default, hover, `:focus-visible` (instant, never transitioned), active, disabled, loading, error,
  success. Hit target 44px on touch (a global rule for buttons and selects).
- Disabled: half opacity and a `not-allowed` cursor. Fields and selects take the native attribute; buttons are
  `aria-disabled` (Foldkit UI's Button), so a pending one keeps focus.

## Surfaces and layout

- The page is paper. Stock lifts fields, sheets and cards above it; a card has a 16px panel radius and no card sits
  inside another.
- Photos keep their true colour: no filter, no tint, 4px corners. Shop pieces are photos; pieces you own are cutouts on
  paper. The wardrobe grid of cutouts on paper is Styld's signature.
- Sheets rise from the bottom edge with 24px top corners, stock fill and a soft shadow (the diagnostics prompt is one).
- Translucency (frost, scrim, veil) only over photos and behind sheets; never blur behind text.
- **Navigation (signed in): Home, Wardrobe, Ask, Boards.** Ask sits in the middle as a filled ink circle, the one
  thing to do from anywhere. You is reached through the avatar.
- **Mobile:** a floating glass pill at the bottom carries the four items. The top bar keeps the logo and the avatar.
  The board editor is the exception: it has the whole screen and its own way back to Boards, because the pill would
  sit over its tray of pieces.
- **Desktop:** the same items in a floating glass rail on the left, with the avatar under it.
- **Signed out:** the top bar keeps the logo and "Sign in".
- **Glass:** the floating nav and the Ask panel are glass at the owner's request. They are the only blur behind text,
  and under `prefers-reduced-transparency` they are solid stock.

### The table

The table is Gallery 2's signature: a sheet of paper (4:5, `table` radius) with things laid on it. It is today's outfit
on Home and the surface of a board.

- **Cutouts and pictures:** cutouts lie straight on the paper with no frame. A picture the person adds keeps the
  `photo` radius.
- **Placement:** in table units, 1000 across. The browser sets each item's position, size and turn as CSS custom
  properties through the CSSOM. The edge CSP forbids inline `style` attributes, so tables render in the browser after
  their data loads, never on the server.
- **Selection:** a dashed ink ring, and an ink dot on the corner that resizes and turns.
- **Gestures:**
  - one finger moves;
  - two fingers pinch to resize and turn;
  - arrows, + and −, [ and ], and Delete do the same from the keyboard;
  - Escape cancels a drag;
  - ⌘Z undoes.

## Icons

- Phosphor (`@phosphor-icons/core`, pinned): Regular below 24px (Gallery's 20px control icons), Light at 24px and
  larger. One family; no icons from another set.
- An icon takes the colour of the text beside it; the signal colours it only when it marks state (the loader, the current
  tab).
- Icons are hidden from assistive technology and sit beside a visible label that carries the meaning. An icon-only control
  carries a translated `aria-label`; a standalone icon that means something gets `role="img"` and a translated label.
- Only the icons listed in `apps/web/src/icons.json` ship: add the name under its weight and run `bun run icons:generate`.
  `docs/migration/v1-icons.json` names the Phosphor icon for each one v1 used, with a note where Phosphor has no exact
  match.
- The loader is `circle-notch` (`loader` in `apps/web/src/Icon.ts`) beside the pending label or status, as in v1.

## Motion

- **Character:** quick and quiet. Every motion answers something the person did.
- **Press, colour and hover** use Gallery's curve `cubic-bezier(0.2, 0, 0, 1)`: 140ms for press and colour, 180ms for
  hover and menus. Presses scale to 0.96.
- **Things that travel** use springs, sampled into CSS `linear()` curves: the critically damped `spring` (≈600ms) and
  the slightly bouncy `springBounce`. These are pieces settling on a table, Spin shuffling the outfit, the + sheet
  growing out of its button, and an item leaving the board.
- **Spin** staggers its pieces by 40ms, the one stagger in the app. One reveal at most on a public page.
- **Page transitions** are not on yet. Cross-document View Transitions reject a promise when a navigation cuts one
  short, and the page reports it before its module script can handle it (the CSP allows no inline script).
  Turning them on needs a small early script served from `public/`.
- **Reduced motion:** everything ends at once (`apps/web/src/GlobalStyles.ts`); loaders keep turning.
- **Reduced transparency:** glass turns solid.

## Copy and chrome

- No eyebrow above a head that says the same thing; where a head is figurative, the plain label becomes the head.
- No middle-dot-joined meta (`A · B · C`): use a line break, a comma, a column or a `<dl>`. No arrow glued to a label.
- No decorative status dot. No emoji as an icon; icons are Phosphor (Icons above). Sparkles only where AI is literally
  running right now.
- Every data region draws loading (a skeleton in the shape of what is coming), empty (what belongs here and the one
  action that fills it), error (what broke and what to do) and full.
- Words in both `packages/i18n/catalogs/en.json` and `sl.json`, same keys; `bun run translations:check` fails on a
  hard-coded view string.
