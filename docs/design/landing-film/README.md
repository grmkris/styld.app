# Styld landing: the film

The signed-out Home as a full-screen, generated film that loops without a seam, made with the owner on 2026-10-31.
Five pieces hang on a rail; one by one they come down and land as flat cut-outs on a paper board, the wardrobe
digitised; then they peel up and hang themselves back. Every word on the page is live text in en or sl; the film
carries none. It replaces the CSS zoom sketch in `../landing-zoom/`, which was not what the owner meant.

Open `index.html` through a static server, or the tailnet preview `https://netcup.tail5acf67.ts.net/styld-landing-film/`
(`?lang=sl`, `?motion=reduce`).

## How the film is made

The private workspace is `~/code/meta-hackathon/out/styld-landing-film/` (ignored there; `ledger.jsonl` records every
call). `media/` here holds its output and is never committed.

1. **Two pinned keyframes per shape** (`kf.ts`, Nano Banana Pro through the Vercel AI Gateway, 2K): K0, the rail with
   the five pieces, and K2, empty hangers and the pieces flat on the board. K2 came first; K0 was made from it so the
   board matches. 16:9 for wide screens, 9:16 for phones, no words in any frame.
2. **Two segments per shape** (`wan.ts`, Wan 3.0 on the owner's Alibaba Token Plan, 1080P, 8 s): rail → board with K0
   first and K2 last, and board → rail the other way round, with the same prompts for every model (`film.ts`).
   `take.ts` does the same through the gateway for Veo 3.1 (one Veo 3.1 Lite take; it added spare hangers on the
   empty wall and faded pieces in, and the gateway refuses video below a $10 balance).
3. **Seams** (`stitch.ts`): the first and last two frames of each take are cut, because a pinned-frame model snaps onto
   the given frame there. At each join the target is the mean of the two frames that meet; the half second on either
   side is shifted towards it by its own residual, ramped from 0 to 1. The film holds still at both joins, so this is
   a correction of a few levels, not a crossfade between pictures.
4. **Web files** (`publish.ts`): H.264, silent, faststart; 1920×1080 for wide screens and 720×1280 for phones, each
   poster the loop's own first frame.

## Evidence (2026-10-31)

- Seams on decoded frames, as the mean absolute difference between neighbouring frames (0–255):
  - wide: join 0.42, wrap 0.89, median step 0.48;
  - tall: join 0.37, wrap 0.78, median step 0.64.

  Before the correction the seams were 3.6–4.0.
- Chromium, desktop 1440×900 and phone 390×844:
  - the wide or tall film plays, and played through it wraps from 15.58 s to about 0.3 s with no stalled sample;
  - the captions follow the film's clock;
  - with reduced motion no video is requested and the pause button is hidden;
  - no page errors.
- Spend: stills $1.00 and one Veo 3.1 Lite take $0.40 on the gateway; five Wan 3.0 takes on the Token Plan.

## Open

- **Safari and a real iPhone** are unchecked (this box's WebKit lacks system libraries).
- **The phone rail → board take** has a faint ghost of the fleece and a doubled striped tee for about a second (its
  largest frame step is 9.7). It should be generated again.
- **Labels on the garments:** a few small labels and the denim tab survive from the reference cut-outs. The real film
  should start from the `@styld` house account's clean pictures.
- **Weight:** 2.6 MB wide and 1.4 MB tall for 15.7 s, over the hero kit's proposed 1.5 MB loop budget. AV1 or a
  higher CRF should be measured on a phone.
- **Rules:** `DESIGN.md` needs a deliberate exception before a full-screen film ships ("one reveal at most on a public
  page", "every motion answers something the person did").

## Overnight concepts (2026-10-31)

At the owner's request, five more films, each on its own page made from the same template (the pages and their films
live in the private workspace, `site/<concept>/`; the index is `https://netcup.tail5acf67.ts.net/styld-film-concepts/`):

| Concept | Page | What happens |
| --- | --- | --- |
| Scan | `styld-film-scan` | A photocopier-like bar of light sweeps the rail; behind it the garments are flat paper cut-outs, then fabric again. |
| Wardrobe | `styld-film-wardrobe` | An oak wardrobe opens on a paper-lined interior with every piece cut out in a grid, then closes. |
| Pile to grid | `styld-film-pile` | From above, a laundry heap sorts itself into a grid of flat cut-outs; the way back is the same film reversed. |
| Paper diorama | `styld-film-diorama` | A stop-motion paper room (12 fps): tiny real clothes hop off the rail and pin themselves flat to the wall. |
| Endless dive | `styld-film-dive` | This page's film hangs in a picture frame on its own wall; a canvas nests it inside itself and zooms on the film's clock. |

What the night taught:

- **Stills:** the AI Gateway stops at a $5 team budget, so stills moved to Qwen Image 3.0 Pro on the Token Plan
  (`qwen.ts`). It keeps the rest of a picture in place when editing, so keyframe pairs stay aligned. Muse Image
  redrew the scene at another scale.
- **Prompts:** Wan follows a concrete picture ("a light bar, like a photocopier's") better than an idea ("a light
  sweeps"), and it duplicates and shrinks garments in a big rearrangement unless told "always exactly six, at full
  size". Where it still does, the way back can be the way there played backwards: its ends are exact.
- **The dive** is seamless by construction: at the end of the loop the zoom has reached the nested film, which is the
  first frame again. Measured on the canvas, its seam is 2.8 against an ordinary step of 4.5.

## Second round: from the wardrobe onto the page (2026-10-31)

The owner dropped the endless dive and chose the story of clothes flying out of the wardrobe onto a page as an outfit,
then switching to another, in three segments between three keyframes (`stitch.ts` now joins any number of takes). The
index plays every film in place: `https://netcup.tail5acf67.ts.net/styld-film-concepts/`.

- **Paper wardrobe** (`styld-film-paperwardrobe`): the diorama and the paper page together, 12 fps stop-motion.
- **On your phone** (`styld-film-phone`): the clothes land on a phone whose generated screen follows the app's table;
  the day on it (`SAT 31`) is live text placed over the screen, written as `TodayView.ts` writes it.
- **Wardrobe to page** (`styld-film-wardrobepage`): the same story in a real room.
- **At your board** (`styld-film-atboard`): a person seen from behind lays out the outfit by hand; the words sit low.
  Its films were first refused when the Alibaba Token Plan's monthly quota ran out; the owner added quota and they
  were made the same day.

The phone story and the person story are cut from their wide film for phones (`make-site.ts … crop:<centre>`): a
9:16 window frames the phone and the person well, and it saved six takes. Seams: joins 0.26–0.6 and wraps 0.96–0.97 against median steps of 0.39–0.56.

## Round three: whole landing pages (2026-10-31)

The owner asked for complete landing pages instead of a film on a thin page, with seven new concepts drawn from the
31 October feature planning: one coat in six outfits, before you buy, shop your wardrobe, where to, mirror, the days
it suited you, and a flip book. Each page is the full-screen hero, then:
- the concept's own section;
- how it works;
- where you use it (the website, ChatGPT, Claude);
- free to start, with a short FAQ;
- the call to action again.

The plan was to generate every film in one unattended run, capped at 45 Wan takes and 70 Qwen stills (`quota.ts`
in the workspace stops every call at the cap, or after the first quota refusal). The first call was refused: the
Alibaba Token Plan's monthly quota, shared with goblin, Purrable, vrials and Hermes, was used up again and resets on
6 November at 16:00 UTC. Six concepts wait for it; the index lists them.

Built without generation (template `site/_page/`, builder `make-page.ts`, check `page-check.ts`):
- **Flip book** (`styld-page-flipbook`): no video. An open paper book whose right-hand page is cut into three stacks
  (tops, bottoms, shoes) from the stand-in cut-outs. Pages turn every 2.6 s while it is on screen. A tap, a swipe or
  the arrow keys turn one page. The headline counts pieces and outfits with each language's plural rules (`9 kosov,
  24 videzov.`).
- **The four round-two stories as whole pages** (`styld-page-paperwardrobe|wardrobepage|phone|atboard`). Their
  Slovenian now uses the app's word "videz" instead of "oprava".
- **Below the fold:**
  - The clips are ping-pongs, a stretch of a film forward and then backward without repeating the turning frames,
    so each loops seamlessly by construction.
  - They are cropped to two thirds around the film's subject, 768×432, 118–273 KB each.
  - A clip plays only while on screen.
  - One fixed pause control stops all motion on the page.

Evidence (Chromium, 1440×900 and 390×844, en, sl and reduced motion, on all five pages):
- no page errors and no failed requests;
- no copy overflowing and no sideways scroll;
- only clips on screen play;
- with reduced motion no video is requested and nothing turns by itself;
- the flip book's taps and arrow keys turn the right stack, and its labels and counter follow.

Open:
- The six waiting films.
- The women's and unisex capsules for them.
- The page weight: hero films are 3.5–4.7 MB wide.
- Safari on a real iPhone.
