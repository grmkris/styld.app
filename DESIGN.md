# Design: Styld

**Gallery 2** is Styld v2's design (owner decision, 2026-10-30): Gallery's paper, ink and cutouts, with one idea
added. **Your clothes are the interface.** Home opens on today's outfit laid out on paper (the table), and a board is a
table you arrange yourself. It replaced Gallery 1 (2026-10-28), which replaced v1's Atelier.

The prototypes:

- `docs/design/gallery-2/` (open `site/index.html`) is the current one. Its README says which parts v2 takes: since
  2026-10-30 all of it except fit badges, and Try with mine, which comes with try-on.
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
| hovered paper-2 control                                     | paper-2 80% to ink    | `paper2Hover`      |
| stock: fields, sheets and cards above the paper             | `#fbf9f5`             | `stock`            |
| ink: text and the primary fill                              | `#1c1410`             | `ink`              |
| hovered ink fill                                            | ink 86% towards paper | `inkHover`         |
| ink-2: secondary text and meta                              | `#5d554e`             | `ink2`             |
| ink-3: counts, placeholders, the word in a divider          | `#6b635b`             | `ink3`             |
| rule: hairlines and field edges                             | `#ddd6cc`             | `rule`             |
| signal: the one slate accent                                | `#2f4f7c`             | `signal`           |
| on-ink: text and icons on an ink fill                       | `#f7f4ee`             | `onInk`            |
| focus ring                                                  | `#2f5bd3`             | `focus`            |
| error text, invalid field edge                              | v2's own              | `error`, `invalid` |

Text in ink-3 keeps 4.5:1 on paper, paper-2 and stock (`#8b827a` until 2026-10-31 was 3.25:1).

Radii: `photo` 4px, `field` 12px, `panel` 16px, `sheet` 24px, `table` 28px (the paper of a table), `pill` for actions,
chips, the search field and the floating nav. Shadows are tokens too: `lift1` (Gallery's lift-1, a card above the paper),
`sheet` (a sheet rising from the bottom), and rings drawn inside an edge, `edge` (1px rule), `chosen` (1.5px ink) and
`dropTarget` (2px signal), with `handleHalo` (paper) around the resize handle's dot and `switchEdge` (1.5px ink-3) on
a switch that is off. Spacing: a 20px page gutter (plus the safe-area insets), 16px between grid
items, 8px between actions in a row.

A board's paper takes one of six colours (`Paper` in `packages/protocol/src/Board.ts`): paper, stock, and the quiet tints
`sand`, `sage`, `slate` and `clay`. They are tokens, used only as a table's ground. The floating nav and the Ask panel
are glass: the `glass` fill and a `glassEdge` hairline.

The prototype has more tokens that v2 adds with the first screen that needs them: `veil` and `scrim` (overlays on photos
and behind sheets), `frost` (round buttons over photos), `lift-2` (a raised shadow), `line` (a hairline over a
photo), the avatar tones (`--t-*`, the ground behind a person's initials) and the catalog colour swatches (`--c-*`,
v1's catalog classification colours).

### Signal

The signal marks a text link's underline and state: in progress, active, the current selection. Under 4% of a screen.
Never a second accent colour.

## Type

Hanken Grotesk is the face, self-hosted as the variable font (`@fontsource-variable/hanken-grotesk`, latin and
latin-ext). No serif. The document preloads it (latin-ext only for Slovenian), and until it lands text draws in
`Hanken Grotesk Fallback`: the local Arial resized to Hanken's measured width, ascent and descent, so lines break
where they will once it swaps in. Static files are named after their content and cached for good (`public/_headers`).

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
- **Search**: a 52px stock pill ringed in rule (ink while focused) with the search icon, after the prototype's
  `.askbar`. On Ask the clear and the + sit inside it as quiet 44px rounds, and the + opens a sheet from the bottom.
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
- **Navigation (signed in): Home, Explore, Ask, Wardrobe, Boards** (owner, 2026-10-30). Ask sits in the middle as a
  filled ink circle, the one thing to do from anywhere. You is reached through the avatar.
- **Mobile:** a floating glass pill at the bottom carries the five items. The top bar keeps the logo and the avatar.
  The board editor is the exception: it has the whole screen and its own way back to Boards, because the pill would
  sit over its tray of pieces.
- **Desktop:** the same items in a floating glass rail on the left, with the avatar under it.
- **Signed out:** the top bar keeps the logo, Explore and "Sign in". Public pages (a profile, a public board, a shared
  look or piece, Explore) read the same as signed in; Sign in appears only when the visitor saves, follows or reports.
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

### Boards, people and Explore

Follow the prototype's `board`, `boards`, `person`, `explore`, `pin`, `wishlist` and `ask-desktop` screens.

- **A board** opens on its collage, a still table, above a grid of its pins; the collage opens the editor. Pins you own
  are cutouts on paper. Someone else's piece carries a credit chip (their initials avatar and "Luka's"), a picture keeps
  the `photo` radius, and a generated picture carries a small "Generated" mark.
- **Save** is a round button on other people's pieces, looks and boards. The saved thumbnail flies into the Boards item
  on `springBounce`, which bumps its count; under reduced motion the button just turns saved.
- **Avatars** are initials on one of the tone tokens; there are no photo avatars yet.
- **A profile** (`person`): the avatar, name, handle and city, the bio, Follow and Share, then Boards, Looks and Pieces
  tabs.
- **Explore** (`explore`): the search field, Edits from Styld, mood chips, newest boards and People to follow.
- **The Ask panel** (`ask-desktop`): "Search your clothes, people and boards", suggestions, then the Add clothes cards
  (Add a piece, Add from a link, Scan your clothes, Film your wardrobe). Results come in three sections: in your
  wardrobe, people, boards.
- **Your public things** say where they stand in one quiet line under their title: publishing while the check runs,
  public, public but not in Explore, or not shown, with the reason.

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
  growing out of its button, an item leaving the board, and a saved thing flying into Boards.
- **Spin** staggers its pieces by 40ms, the one stagger in the app. One reveal at most on a public page.
- **Tab changes** happen inside the page and cross-fade in 180ms through Foldkit's `viewTransition`. The navigation
  keeps its place (`view-transition-name: styld-nav`), a page seen before shows at once, and the runtime skips the
  fade under reduced motion. Every other page loads whole, without a transition. Cross-document View Transitions stay
  off: an aborted one rejects before the module script can catch it, and the CSP allows no inline script.
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
