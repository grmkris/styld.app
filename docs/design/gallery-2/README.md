# Styld in Gallery 2: your clothes are the interface

Gallery 2 is the redesign the owner chose on 2026-10-30. It builds on Gallery 1 (`../gallery/`): the same paper, ink
and cutouts. The difference is that the app opens on your own clothes. Home is today's outfit laid out on paper ("the
table"), and boards are tables you arrange yourself. `DESIGN.md` states the rules; this prototype shows the intent.

- Open `site/index.html`, or the deployed copy at
  `https://styld-design-directions.kristjan-grm11775.workers.dev/v2/` (18 phone and 8 desktop screens). The hub's
  links to Gallery 1 and the archive work only on the deployed copy.
- `build.py` builds `site/v2/` from `gallery2.css`, `proto.js`, `data/people.json` and the cutouts. It was written in
  the v1 repository at `design/prototype/v2/` and reads its assets from there, so it isn't a build here.
- `proto.js` is the prototype's motion and its few live actions: Spin, Wear this, Save flying into Boards, the +
  sheet, Try with mine. Its springs are CSS `linear()` curves sampled by `spring()` in `build.py`.

## What V2 takes now (owner, 2026-10-30)

Only the parts about your own wardrobe. Other people stay parked, as in `docs/ROADMAP.md`.

**Taken now:**
- The navigation: Home, Wardrobe, **Ask** in the middle, Boards. You is reached through the avatar.
- Home's **table**:
  - the day in the logo's condensed face (Anton), its one use;
  - your outfit as cutouts on paper;
  - **Wear this** and **Spin**;
  - then "Pick up where you left off".
- **Wardrobe** with Pieces and Looks tabs, and a piece's page.
- **Ask**: search your wardrobe, the hand-off to ChatGPT or Claude for the stylist, and the + sheet that opens
  capture.
- **Boards**: your tables of pieces, text labels and your own pictures, built in Foldkit with no canvas library (see
  `../canvas-spike/`). A board can be saved as a look.
- Motion: springs, the sheet growing out of its button, page transitions, and reduced-motion fallbacks.

**Not now:**
- The feed, Explore, people and their profiles, Try with mine on someone else's piece, fit badges ("Goes with 4 of
  yours"), and the wishlist ("Want one like it"). All of these depend on other people's content.
- Weather on the table. The headline is the day and date until it arrives.

Shops were never part of Gallery 2.
