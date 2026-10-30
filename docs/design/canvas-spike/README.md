# Styld canvas spike

Can Styld v2 build its collage ("the table") in Foldkit alone, with no canvas library and no React? This is a
throwaway spike against v2's pins: `foldkit` 0.169.0, Effect 4.0.7 and `intl-messageformat` 12.1.4.

Live: https://styld-design-directions.kristjan-grm11775.workers.dev/spike/canvas/

- **Pieces are plain elements** on a sheet 1000 units wide and 1250 tall. Each piece's position, size and turn live
  in the Model and reach the page as CSS custom properties (`translate`, `rotate`, `scale`), so only transforms
  change.
- **Gestures:**
  - one finger drags;
  - a second finger anywhere on the paper turns the drag into a pinch, which resizes, turns and carries the piece;
  - the corner handle resizes and turns with a mouse.

  Document pointer events come in through a Subscription, which runs only while a gesture is active. Foldkit
  renders once per frame.
- **Keyboard:** arrows, + and −, [ and ], Delete, Escape (cancels a drag), ⌘Z and ⇧⌘Z.
- **Also built:** undo history, a wardrobe tray, tidy up, a 50-piece stress test, and saving to localStorage through
  Commands.
- **Languages:** English and Slovenian as ICU messages, the runtime v2's `@styld/i18n` uses, including Slovenian's
  four plural forms. The Slovenian catalog is typed against the English one.

```sh
bun install && bun run dev        # http://localhost:5173/spike/canvas/
bun run typecheck && bun run build
```

To deploy, copy `dist/` to `stylelab/design/prototype/site/spike/canvas/`, then run the prototype's deploy command
from `stylelab/design/prototype/README.md`.
