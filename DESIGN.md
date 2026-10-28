# Design: Styld

The locked system, carried over from v1 (`stylelab/DESIGN.md` at `aef3042d`, 2026-10-25) with its implementation
notes moved to zyzz and Foldkit. Every screen agent reads this first, and screens share it. Change it on purpose; the
file is the rule. A redesign may replace it later; until the owner says so, it holds.

Calm Scandinavian (Arket, COS, Toteme): limewash paper, umber ink, one slate signal, Sentient light over Hanken
Grotesk. Light mode only.

## System

- Genre: editorial
- Shape of the first page: app screen (signed-in app); public pages are page scope
- Theme: Atelier (Hallmark), seed `calm-scandinavian-fashion-wardrobe-1472·743c3c01·2026-10-25·r0`
- Axes: light/roman-serif/cool · posture: restrained
- Signature: the wardrobe grid of garment cutouts on paper. Garment photos keep their true colour: no filter, no tint.

## Tokens

`apps/web/src/zyzz.config.ts` is the source of truth; never a literal colour or `font-family` outside it (the `zyzz`
skill covers usage). It holds the tokens v2's screens use so far. When a screen needs one of v1's other roles, add it
there under the v1 name and value below, then use the token name:

| Role                              | v1 value                                  | v2 token                                                                                |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| paper (page)                      | `oklch(94.5% 0.01 76)`                    | `paper`                                                                                 |
| paper-2 (quiet surface)           | `oklch(91.8% 0.013 74)`                   | add when needed                                                                         |
| paper-3 (hover and focus surface) | `oklch(88% 0.015 72)`                     | add when needed                                                                         |
| ink (text, primary fill)          | `oklch(19% 0.024 52)`                     | `ink`                                                                                   |
| ink-2                             | `oklch(31% 0.018 54)`                     | add when needed                                                                         |
| ink-3 (secondary text)            | `oklch(47% 0.014 60)`                     | `muted`                                                                                 |
| rule (hairline)                   | `oklch(81% 0.011 70)`                     | `rule`                                                                                  |
| rule-2 (input edge, 3:1)          | `oklch(60% 0.012 66)`                     | add when needed                                                                         |
| signal (the one slate accent)     | `oklch(41% 0.075 248)`                    | `signal`                                                                                |
| signal-ink (signal on ink)        | `oklch(96% 0.008 76)`                     | add when needed                                                                         |
| focus                             | `oklch(50% 0.095 248)`                    | `focus`                                                                                 |
| stock (card stock)                | `oklch(97.6% 0.007 82)`                   | add when needed                                                                         |
| error                             | `oklch(52% 0.19 27)`                      | `error` is `oklch(48% 0.16 25)` and `invalid` `oklch(58% 0.16 25)` in v2's sign-in form |
| success                           | `oklch(50% 0.12 150)`                     | add when needed                                                                         |
| display font                      | `"Sentient", Georgia, serif`              | `fontFamily.display`                                                                    |
| body font                         | `"Hanken Grotesk", system-ui, sans-serif` | `fontFamily.body`                                                                       |
| card radius                       | `2px`                                     | add when needed                                                                         |
| control and chip radius           | `3px`                                     | `radius.control`                                                                        |

`field` and `hover` are v2's paper-to-ink mixes for input fields and hovered secondary actions; they stand in for
paper-2/paper-3 until those tokens are added.

### Signal

The signal is the one slate accent: a link's underline, the current selection, state (active, in progress, published),
focus. Under 4% of a screen. Never a warm accent; v1's old Maison gold maps to the signal when it marks an action,
selection or state, to ink on a head, and to muted on meta.

## Type

- **Display** (`fontFamily.display`): Sentient 300, sentence case, roman, one weight and one colour a head,
  `text-wrap: balance`. Only on real heads: a page title, a section title, a statement, a figure at 1.6rem or larger.
- **Small serif**: Sentient 400 for a name on a card or an `h3`, never under 16px, never a paragraph.
- **Body and UI** (`fontFamily.body`): Hanken Grotesk 400, 500 for emphasis in controls. Line-height 1.55, measure 45
  to 75ch.
- **Labels**: the body face a step smaller, sentence case, untracked; the object in ink, the material or number in
  muted. Never uppercase, small caps, or letter-spacing on a label.
- A system mono for code and raw data (admin) only.
- Never an italic word inside a roman head. Never serif running text.
- Sentient's licence (ITF FFL) allows self-hosting for Styld's own site and images, not subsetting, converting, or
  offering it as a font users set their own content in. Board text uses a separate user serif.

## Controls

The shared styles live in `apps/web/src/Actions.styles.ts`. Controls render through `@foldkit/ui`'s headless views (text
buttons through `actionButton` in `apps/web/src/ActionButton.ts`), and zyzz styles them.

- Primary (`primaryAction`): ink fill, paper text, 3px radius, 48px tall. One a screen; a dialog counts as its own
  screen.
- Secondary (`secondaryAction`): 1px hairline, transparent; hover tints the surface. Same radius and height.
- Ghost: text in ink; hover tints the surface. Link: ink text with a signal underline.
- Chips and tags: 3px radius, hairline border, sentence case. A full circle only for real circles: avatars, colour
  dots, spinners, radio marks.
- Fields: a 1px edge with 3:1 contrast, 3px radius; focus is an outline in `focus`, never a border change. Disabled:
  half opacity, `not-allowed` cursor; fields and selects take the native attribute, buttons `aria-disabled` (Foldkit UI's
  Button) so a pending one keeps focus.
- Every control: default, hover, `:focus-visible` (instant, never transitioned), active, disabled, loading, error,
  success. Motion on `transform` and `opacity` only; colour changes may transition. Hit target 44px on touch (a global
  rule for buttons and selects).
- Surfaces: paper page, card-stock cards with a hairline or a soft contact shadow, 2px corners. No card inside a card.
  No glass: no backdrop blur, no translucent chrome. Full card stock for the one object a screen is known by.

## Icons

- Phosphor (`@phosphor-icons/core`, pinned): the Light weight at 24px and larger, Regular below 24px, where Light turns
  faint. One family; no icons from another set.
- An icon takes the colour of the text beside it; the signal colours it only when it marks state (the loader, the current
  tab).
- Icons are hidden from assistive technology and sit beside a visible label that carries the meaning. An icon-only control
  carries a translated `aria-label`; a standalone icon that means something gets `role="img"` and a translated label.
- Only the icons listed in `apps/web/src/icons.json` ship: add the name under its weight and run `bun run icons:generate`.
  `docs/migration/v1-icons.json` names the Phosphor icon for each one v1 used, with a note where Phosphor has no exact
  match.
- The loader is `circle-notch` (`loader` in `apps/web/src/Icon.ts`) beside the pending label or status, as in v1.

## Motion

- Character: calm. 140ms for press and colour, 180ms for hover and menus, 240ms for dialogs and sheets; ease-out for
  arrivals, ease-in-out for toggles. One reveal at most on a public page, none on app screens; no stagger.
- Under reduced motion everything ends at once (`apps/web/src/GlobalStyles.ts`); loaders keep turning.

## Copy and chrome

- No eyebrow above a head that says the same thing; where a head is figurative, the plain label becomes the head.
- No middle-dot-joined meta (`A · B · C`): use a line break, a comma, a column or a `<dl>`. No arrow glued to a label.
- No decorative status dot. No emoji as an icon; icons are Phosphor (Icons above). Sparkles only where AI is literally running right
  now.
- Every data region draws loading (a skeleton in the shape of what is coming), empty (what belongs here and the one
  action that fills it), error (what broke and what to do) and full.
- Words in both `packages/i18n/catalogs/en.json` and `sl.json`, same keys; `bun run translations:check` fails on a
  hard-coded view string.
