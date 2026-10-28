# Styld in Gallery

The chosen design direction for Styld v2 (owner decision, 2026-10-28): a clickable static prototype of every main
screen, mobile and desktop. `DESIGN.md` is written from it; where they disagree, this prototype shows the intent and
`DESIGN.md` states the rule.

- Open `site/index.html` in a browser, or the deployed copy at
  `https://styld-design-directions.kristjan-grm11775.workers.dev/`.
- `site/archive/` holds the ten earlier directions it was chosen from.
- Shop pieces are real menswear from Slovenian shops on styld.app (`men.json`; photos load from the shops). Owned pieces
  are real wardrobe cutouts from styld.app (`assets/w/`). People, boards, looks and counts on personal screens are
  examples.

## Rebuilding

`python3 build.py` regenerates `site/` from `build.py`, `gallery.css`, `men.json` and `assets/`; it reads the v1
wordmark from `/home/kristjan/code/stylelab/apps/web/public/brand/wordmark.svg`. The rebuild reproduces every page and
asset; `site/thumbs/` are screenshots taken separately (`lab/thumbs.mjs`).

`lab/` keeps the generators and data of the exploration that led here (the archived directions). They were run from
`/tmp/design-lab` and still name those paths; they are kept for reference, not as a build.

Left out on purpose: review screenshots and the shop photo cache, and a raw wardrobe API dump that held a real user's
id and storage paths.
