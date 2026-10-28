# Design: Styld

**Gallery** is Styld v2's design (owner decision, 2026-10-28). It replaces v1's Atelier. The clickable prototype in
`docs/design/gallery/` (open `site/index.html`) shows every main screen on mobile and desktop; this file states the
rules. Every screen agent reads both first. When a screen is built, follow the prototype's layout and this file's rules;
where they disagree, ask. Change this file on purpose; it is the rule.

Things you could buy are photos from shops; things you own are cutouts on paper. One sans face, warm paper, umber ink,
one slate signal. Pill-shaped actions, soft panels and sheets, photos with small corners. Light mode only.

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

Radii: `photo` 4px, `field` 12px, `panel` 16px, `sheet` 24px, `pill` for actions, chips and the search field. Spacing:
a 20px page gutter (plus the safe-area insets), 16px between grid items, 8px between actions in a row.

The prototype has more tokens that v2 adds with the first screen that needs them: `veil` and `scrim` (overlays on photos
and behind sheets), `frost` (round buttons over photos), `shade-1` and `shade-2` (shadows), `line` (a hairline over a
photo), and the catalog colour swatches (`--c-*`, v1's catalog classification colours).

### Signal

The signal marks a text link's underline and state: in progress, active, the current selection. Under 4% of a screen.
Never a second accent colour.

## Type

One face: Hanken Grotesk, self-hosted as the variable font (`@fontsource-variable/hanken-grotesk`, latin and latin-ext).
No serif.

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
- Mobile: a 64px top bar with the logo and one action. Desktop: a top bar with the logo, text navigation (the current
  section underlined), the search pill and the avatar.

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

- Character: quick and quiet, on Gallery's curve `cubic-bezier(0.2, 0, 0, 1)`. 140ms for press and colour, 180ms for
  hover and menus, 240ms for sheets and dialogs. Presses scale to 0.96. One reveal at most on a public page, none on app
  screens; no stagger.
- Under reduced motion everything ends at once (`apps/web/src/GlobalStyles.ts`); loaders keep turning.

## Copy and chrome

- No eyebrow above a head that says the same thing; where a head is figurative, the plain label becomes the head.
- No middle-dot-joined meta (`A · B · C`): use a line break, a comma, a column or a `<dl>`. No arrow glued to a label.
- No decorative status dot. No emoji as an icon; icons are Phosphor (Icons above). Sparkles only where AI is literally
  running right now.
- Every data region draws loading (a skeleton in the shape of what is coming), empty (what belongs here and the one
  action that fills it), error (what broke and what to do) and full.
- Words in both `packages/i18n/catalogs/en.json` and `sl.json`, same keys; `bun run translations:check` fails on a
  hard-coded view string.
