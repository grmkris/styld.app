// Styld prototype: the motions and the few actions that really work.
// Every motion answers something the person did, starts from where things are on screen (so a second tap
// interrupts cleanly), and becomes an instant change when the device asks for reduced motion.
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const root = getComputedStyle(document.documentElement);
  const SPRING = root.getPropertyValue("--spring").trim() || "ease-out";
  const SPRING_BOUNCE = root.getPropertyValue("--spring-bounce").trim() || "ease-out";
  const OUT = "cubic-bezier(0.2, 0, 0, 1)";
  const still = () => reduced.matches;

  // A page transition cut short by another navigation rejects its promises; that is expected, not an error.
  const settle = (event) => {
    event.viewTransition?.ready.catch(() => {});
    event.viewTransition?.finished.catch(() => {});
  };
  addEventListener("pageswap", settle);
  addEventListener("pagereveal", settle);

  const say = (from, text) => {
    const live = from.closest("section, .screen, .dmain")?.querySelector(".note-live");
    if (live) live.textContent = text;
  };

  // ---------------------------------------------------------------- Spin: a new outfit from your wardrobe
  const table = document.querySelector("[data-table]");
  const spinBtn = document.querySelector("[data-spin-btn]");
  if (table && spinBtn) {
    const outfits = JSON.parse(table.dataset.spin);
    const names = JSON.parse(table.dataset.names);
    for (const outfit of outfits) for (const src of outfit) new Image().src = src;
    let index = 0;
    let turn = 0;
    spinBtn.addEventListener("click", () => {
      index = (index + 1) % outfits.length;
      const mine = ++turn;
      const pieces = [...table.querySelectorAll(".tp")];
      spinBtn.animate([{ transform: "rotate(0)" }, { transform: "rotate(180deg)" }], { duration: still() ? 0 : 420, easing: SPRING });
      pieces.forEach((img, i) => {
        const swap = () => {
          img.src = outfits[index][i];
          img.alt = names[index][i];
        };
        if (still()) return swap();
        const now = getComputedStyle(img);
        const from = { transform: now.transform, opacity: now.opacity };
        for (const a of img.getAnimations()) a.cancel();
        const r = parseFloat(now.getPropertyValue("--r")) || 0;
        const lift = img.animate([from, { transform: `rotate(${r}deg) translateY(-18px) scale(0.9)`, opacity: 0 }],
          { duration: 160, delay: i * 40, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
        lift.onfinish = () => {
          if (mine !== turn) return;
          swap();
          lift.cancel();
          const tilt = r + (i % 2 ? 7 : -7);
          img.animate([{ transform: `rotate(${tilt}deg) translateY(-28px) scale(0.92)`, opacity: 0 }, { transform: `rotate(${r}deg)`, opacity: 1 }],
            { duration: 700, easing: SPRING_BOUNCE });
        };
      });
      const wear = document.querySelector("[data-wear]");
      if (wear?.classList.contains("is-done")) resetWear(wear);
      say(spinBtn, "");
    });
  }

  // ---------------------------------------------------------------- Wear this: the table settles
  function resetWear(btn) {
    btn.classList.remove("is-done");
    btn.innerHTML = "<span>Wear this</span>";
  }
  for (const btn of document.querySelectorAll("[data-wear]")) {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("is-done")) return resetWear(btn);
      btn.classList.add("is-done");
      btn.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg><span>Worn today</span>';
      say(btn, "Logged for Thursday. You’ll see it in Worn this week.");
      if (still() || !table) return;
      [...table.querySelectorAll(".tp")].forEach((img, i) => {
        const r = parseFloat(getComputedStyle(img).getPropertyValue("--r")) || 0;
        img.animate([{ transform: `rotate(${r}deg) scale(1)` }, { transform: `rotate(${r}deg) scale(0.95)` }, { transform: `rotate(${r}deg) scale(1)` }],
          { duration: 460, delay: i * 50, easing: SPRING });
      });
    });
  }

  // ---------------------------------------------------------------- Save: the picture drops into Boards
  const boards = document.querySelector("[data-boards]");
  let saved = 0;
  const bump = () => {
    if (!boards) return;
    saved += 1;
    let count = boards.querySelector(".count");
    if (!count) {
      count = document.createElement("span");
      count.className = "count";
      boards.append(count);
    }
    count.textContent = String(saved);
    if (!still()) boards.animate([{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 420, easing: SPRING_BOUNCE });
  };
  document.addEventListener("click", (event) => {
    const btn = event.target.closest(".save");
    if (!btn) return;
    event.preventDefault();
    const on = !btn.classList.contains("is-saved");
    btn.classList.toggle("is-saved", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Saved" : "Save");
    if (!on) return;
    const img = btn.closest(".pc-ph, .pin-hero")?.querySelector("img");
    if (!img || !boards || still()) return bump();
    const from = img.getBoundingClientRect();
    const to = boards.getBoundingClientRect();
    const ghost = img.cloneNode();
    ghost.removeAttribute("style");
    Object.assign(ghost.style, {
      position: "fixed", left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
      objectFit: "contain", zIndex: "50", pointerEvents: "none", borderRadius: "16px", margin: "0",
    });
    document.body.append(ghost);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    // An arc: up and over, then down into the Boards button, fading only at the very end.
    const fly = ghost.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 80}px) scale(0.55)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.9, offset: 0.9 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0 },
    ], { duration: 560, easing: "cubic-bezier(0.45, 0, 0.25, 1)" });
    fly.onfinish = () => {
      ghost.remove();
      bump();
    };
  });

  // ---------------------------------------------------------------- The add sheet grows out of the button that opened it
  let opener = null;
  const sheetWrap = document.getElementById("sheet-add");
  const openSheet = (trigger) => {
    if (!sheetWrap || !sheetWrap.hidden) return;
    opener = trigger;
    sheetWrap.hidden = false;
    const sheet = sheetWrap.querySelector(".sheet");
    const scrim = sheetWrap.querySelector(".scrim");
    sheet.querySelector(".opt, button")?.focus({ preventScroll: true });
    if (still()) return;
    const s = sheet.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    sheet.style.transformOrigin = `${t.left + t.width / 2 - s.left}px ${t.top + t.height / 2 - s.top}px`;
    sheet.animate([{ transform: "scale(0.15)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 520, easing: SPRING });
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: OUT });
  };
  const closeSheet = () => {
    if (!sheetWrap || sheetWrap.hidden) return;
    const done = () => {
      sheetWrap.hidden = true;
      opener?.focus({ preventScroll: true });
    };
    if (still()) return done();
    const sheet = sheetWrap.querySelector(".sheet");
    sheetWrap.querySelector(".scrim").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: OUT, fill: "forwards" });
    const back = sheet.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.15)", opacity: 0 }], { duration: 260, easing: OUT, fill: "forwards" });
    back.onfinish = () => {
      for (const a of sheetWrap.querySelectorAll("*")) for (const anim of a.getAnimations()) anim.cancel();
      done();
    };
  };
  for (const trigger of document.querySelectorAll("[data-sheet-open]")) {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openSheet(trigger);
    });
  }
  for (const closer of document.querySelectorAll("[data-sheet-close]")) {
    closer.addEventListener("click", (event) => {
      event.preventDefault();
      closeSheet();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
  });

  // ---------------------------------------------------------------- Try with mine: whichever piece was tried lands on the table
  const tryTable = document.querySelector("[data-try]");
  if (tryTable) {
    const key = new URLSearchParams(location.search).get("piece");
    const pieces = JSON.parse(tryTable.dataset.pieces);
    const guest = tryTable.querySelector("[data-guest]");
    if (key && pieces[key]) {
      const piece = pieces[key];
      guest.src = piece.src;
      guest.alt = piece.name;
      guest.style.viewTransitionName = `piece-${key}`;
      tryTable.querySelector("[data-guest-tag] span:last-child").textContent = piece.by;
      const name = document.querySelector("[data-guest-name]");
      if (name) name.textContent = `${piece.by} ${piece.name.charAt(0).toLowerCase()}${piece.name.slice(1)}`;
    }
    // Arriving by a page transition, the piece flies in from where it was; otherwise it drops onto the table.
    let arrivedByTransition = false;
    addEventListener("pagereveal", (event) => {
      arrivedByTransition = Boolean(event.viewTransition);
    });
    requestAnimationFrame(() => {
      if (!arrivedByTransition && !still()) guest.parentElement.classList.add("drop");
    });
  }

  // ---------------------------------------------------------------- Confirmations and follows
  for (const btn of document.querySelectorAll("[data-toast]")) {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      btn.classList.add("is-done");
      btn.setAttribute("aria-pressed", "true");
      say(btn, btn.dataset.toast);
    });
  }
  for (const btn of document.querySelectorAll("[data-follow]")) {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const label = btn.querySelector("span:last-child");
      const following = label.textContent === "Following";
      label.textContent = following ? "Follow" : "Following";
      btn.classList.toggle("is-done", !following);
    });
  }
})();
