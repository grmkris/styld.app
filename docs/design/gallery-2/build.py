"""Styld, Gallery 2: your clothes are the interface.

Home opens on today's table (your outfit as cutouts on paper), other people's pieces can be
tried against your own clothes, and inspiration is judged against your closet. No shops.
Writes plain HTML into ../site/v2 and the hub page into ../site/index.html; proto.js makes
Spin, Wear this, Save, Try with mine and the add sheet work.
"""
import html
import json
import math
import os
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROTO = HERE.parent
REPO = PROTO.parent.parent
OUT = PROTO / "site" / "v2"
SITE = PROTO / "site"

DATA = json.load(open(PROTO / "data" / "people.json"))
PEOPLE, PIECES, FIT, LOOKS_OF, BOARDS = DATA["people"], DATA["pieces"], DATA["fit"], DATA["looks"], DATA["boards"]
svg = open(REPO / "apps/web/public/brand/wordmark.svg").read()
LOGO = (f'<svg class="logo" viewBox="{re.search(r"viewBox=.([^\"]+)", svg).group(1)}" role="img" aria-label="Styld">'
        f'<path fill="currentColor" d="{re.search(r" d=.([^\"]+)", svg).group(1)}"/></svg>')
e = html.escape

# Your wardrobe: real cutouts from the owner's wardrobe on styld.app (assets/w)
W = {
    "shirt-denim": "Denim shirt", "shirt-sky": "Oxford shirt", "shirt-flannel": "Flannel shirt", "tee-white-folded": "White tee",
    "tee-black": "Black tee", "tee-grey": "Graphic tee", "tee-black-adidas": "Training tee", "polo-navy": "Navy polo",
    "henley-charcoal": "Henley", "longsleeve-stripe": "Breton stripe", "longsleeve-black": "Black long sleeve", "vneck-navy": "V-neck tee",
    "knit-cable-navy": "Cable knit", "knit-navy": "Navy jumper", "crew-grey": "Grey crewneck", "turtleneck-black": "Turtleneck",
    "hoodie-grey": "Grey hoodie", "fleece-cream": "Fleece jacket", "jacket-track-black": "Track jacket", "shorts-denim": "Denim shorts",
    "shorts-sky": "Swim shorts", "shorts-navy-adidas": "Training shorts", "af1-white": "White trainers", "converse-high": "High tops",
    "converse-low": "Low tops", "derby-black": "Derby shoes", "sandals-birkenstock": "Sandals", "boots-football": "Football boots",
}
# Outfits Spin cycles through: [top, layer, bottom, shoes]
SPIN = [["shirt-denim", "knit-navy", "shorts-denim", "converse-low"], ["shirt-sky", "knit-cable-navy", "shorts-denim", "derby-black"],
        ["tee-white-folded", "fleece-cream", "shorts-sky", "af1-white"], ["longsleeve-stripe", "hoodie-grey", "shorts-denim", "converse-high"],
        ["polo-navy", "crew-grey", "shorts-sky", "sandals-birkenstock"]]
MY_LOOKS = [("Sunday market", ["knit-cable-navy", "shirt-sky", "shorts-denim", "derby-black"]),
            ("Office, but soft", ["turtleneck-black", "crew-grey", "derby-black", "af1-white"]),
            ("Coast", ["tee-white-folded", "shorts-sky", "sandals-birkenstock", "longsleeve-stripe"]),
            ("Five-a-side", ["tee-black-adidas", "shorts-navy-adidas", "boots-football", "jacket-track-black"])]
MY_BOARDS = [("autumn", "Autumn layers", ["knit-cable-navy", "shirt-sky", "derby-black", "crew-grey"], "12 pins"),
             ("piran", "Piran weekend", ["tee-white-folded", "shorts-sky", "sandals-birkenstock", "longsleeve-stripe"], "9 pins"),
             ("five", "Five-a-side", ["tee-black-adidas", "shorts-navy-adidas", "boots-football", "jacket-track-black"], "6 pins")]
TRY_KEY = "coat-navy"
TRY_WITH = ["knit-cable-navy", "shirt-sky", "shorts-denim", "derby-black"]


# ---------------------------------------------------------------- springs, sampled once for CSS and JS

def spring(zeta, response, dur, n=32):
    """A spring (damping ratio, response in seconds) sampled as a CSS linear() easing over dur seconds."""
    w = 2 * math.pi / response
    pts = []
    for i in range(n + 1):
        t = dur * i / n
        if zeta >= 1:
            x = 1 - (1 + w * t) * math.exp(-w * t)
        else:
            wd = w * math.sqrt(1 - zeta * zeta)
            x = 1 - math.exp(-zeta * w * t) * (math.cos(wd * t) + zeta * w / wd * math.sin(wd * t))
        pts.append(f"{x:.4f}")
    pts[-1] = "1"
    return "linear(" + ", ".join(pts) + ")"


SPRING = spring(1.0, 0.4, 0.6)
SPRING_BOUNCE = spring(0.8, 0.4, 0.7)

I = {
    "home": '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
    "explore": '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    "wardrobe": '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    "boards": '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
    "save": '<path d="M6 3h12v18l-6-5-6 5z"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "x": '<path d="M6 6l12 12M18 6 6 18"/>',
    "back": '<path d="M15 5l-7 7 7 7"/>',
    "chev": '<path d="m9 6 6 6-6 6"/>',
    "share": '<path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/>',
    "dots": '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    "camera": '<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/>',
    "video": '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    "image": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    "check": '<path d="m5 12 5 5 9-10"/>',
    "out": '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "shuffle": '<path d="M3 7h3c4 0 6 10 10 10h5M3 17h3c1.5 0 2.7-1.3 3.7-3M14.3 10c1-1.7 2.2-3 3.7-3h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    "rain": '<path d="M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3.5 3.5 0 0 1 0 7H7z"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>',
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    "chat": '<path d="M4 5h16v11H9l-5 4z"/>',
    "edit": '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
    "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    "shield": '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    "try": '<path d="M12 3v3M12 6a2 2 0 1 1 2 2c-1 0-2 .6-2 1.5V10L3 17h18l-9-7"/>',
    "heart": '<path d="M12 20s-7-4.6-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.4-9 9-9 9z"/>',
}


def ic(name, cls=""):
    return f'<svg class="ic {cls}" viewBox="0 0 24 24" aria-hidden="true">{I[name]}</svg>'


def src(key):
    return f"assets/w/{key}.webp" if key in W else f"assets/p/{key}.webp"


def name_of(key):
    return W[key] if key in W else PIECES[key][0]


def owner(key):
    return PIECES[key][2]


def is_photo(key):
    return key in PIECES and PIECES[key][3] == "photo"


def first(person):
    return "Styld" if person == "styld" else PEOPLE[person]["name"].split()[0]


def initials(person):
    return "St" if person == "styld" else "".join(w[0] for w in PEOPLE[person]["name"].split()[:2])


def possessive(person):
    return f"{first(person)}’s"


# ---------------------------------------------------------------- building blocks

def act(icon_name, label, href="#"):
    return f'<a class="round" href="{href}" aria-label="{label}">{ic(icon_name)}</a>'


def phone_nav(active):
    def item(k, label, href):
        cur = " aria-current=page" if k == active else ""
        boards = " data-boards" if k == "boards" else ""
        return f'<a href="{href}" class="nv{" on" if k == active else ""}" aria-label="{label}"{cur}{boards}>{ic(k)}</a>'
    ask_vt = "" if active == "ask" else ' style="view-transition-name: ask"'
    return (f'<nav class="pill-nav" aria-label="App">{item("home", "Home", "home.html")}{item("explore", "Explore", "explore.html")}'
            f'<a href="ask.html" class="nv ask{" on" if active == "ask" else ""}" aria-label="Ask Styld"{ask_vt}>{ic("search")}</a>'
            f'{item("wardrobe", "Wardrobe", "wardrobe.html")}{item("boards", "Boards", "boards.html")}</nav>')


def rail(active):
    def item(k, label, href):
        boards = " data-boards" if k == "boards" else ""
        return f'<a href="{href}" class="nv{" on" if k == active else ""}" aria-label="{label}" title="{label}"{boards}>{ic(k)}</a>'
    ask_vt = "" if active == "ask" else ' style="view-transition-name: ask"'
    return (f'<a class="rail-logo" href="home-desktop.html" aria-label="Styld home">{LOGO}</a>'
            f'<nav class="rail" aria-label="App">{item("home", "Home", "home-desktop.html")}{item("explore", "Explore", "explore-desktop.html")}'
            f'<a href="ask-desktop.html" class="nv ask{" on" if active == "ask" else ""}" aria-label="Ask Styld" title="Ask Styld"{ask_vt}>{ic("search")}</a>'
            f'{item("wardrobe", "Wardrobe", "wardrobe-desktop.html")}{item("boards", "Boards", "boards-desktop.html")}</nav>'
            f'<nav class="rail rail-low" aria-label="Account"><a href="you-desktop.html" class="nv me{" on" if active == "you" else ""}" aria-label="You"><span class="av">K</span></a></nav>')


def head_row(title=None, right=None):
    left = f'<a href="home.html" class="logo-link" aria-label="Styld home">{LOGO}</a>' if title is None else f'<h1 class="title">{title}</h1>'
    right = right if right is not None else '<a href="you.html" class="av-link" aria-label="You"><span class="av">K</span></a>'
    return f'<header class="head">{left}{right}</header>'


def back_row(back, actions="", title=""):
    t = f'<span class="bar-t">{title}</span>' if title else '<span class="grow"></span>'
    return f'<header class="head bar"><a class="round" href="{back}" aria-label="Back">{ic("back")}</a>{t}<span class="acts">{actions}</span></header>'


def askbar(href="ask.html", placeholder="Search, or ask the stylist", cls="", plus=True):
    p = f'<button class="ask-plus" data-sheet-open="add" aria-label="Add clothes">{ic("plus")}</button>' if plus else ""
    return f'<div class="askbar {cls}"><a class="ask-field" href="{href}">{ic("search")}<span>{placeholder}</span></a>{p}</div>'


def btn(label, href="#", kind="", icon=None, attrs=""):
    return f'<a class="btn {kind}" href="{href}"{attrs}>{ic(icon) if icon else ""}<span>{label}</span></a>'


def chip(label, on=False, href="#", x=False):
    tail = f'<span class="chip-x" aria-hidden="true">{ic("x")}</span>' if x else ""
    return f'<a class="chip{" on" if on else ""}" href="{href}">{label}{tail}</a>'


def avatar(person, size=""):
    return f'<span class="ava {size}" style="--tone:var(--t-{PEOPLE[person]["tone"]})">{initials(person)}</span>'


def save_btn(saved=False):
    label = "Saved" if saved else "Save"
    return f'<button class="save{" is-saved" if saved else ""}" aria-pressed="{str(saved).lower()}" aria-label="{label}">{ic("save")}</button>'


def flat(keys, cls=""):
    imgs = "".join(f'<img class="s{i}" src="{src(k)}" alt="{e(name_of(k))}">' for i, k in enumerate(keys))
    return f'<span class="flat {cls}">{imgs}</span>'


def cut(key, href="item.html", cap=True):
    c = f'<span class="cap">{e(name_of(key))}</span>' if cap else ""
    return f'<a class="cut" href="{href}"><img src="{src(key)}" alt="{e(name_of(key))}">{c}</a>'


def sec(title, href=None, extra=""):
    t = f'<a class="sec-link" href="{href}"><h2 class="h2">{title}</h2>{ic("chev")}</a>' if href else f'<h2 class="h2">{title}</h2>'
    return f'<div class="sec-h">{t}<span class="grow"></span>{extra}</div>'


def minis(keys):
    return '<span class="minis">' + "".join(f'<img src="{src(k)}" alt="">' for k in keys) + "</span>"


def fit_line(key):
    """How a piece fits your closet: hidden when it fits nothing."""
    f = FIT.get(key)
    if not f:
        return ""
    if isinstance(f, str):
        return f'<span class="fit">{minis([f.split(":", 1)[1]])}<span>You have one like it</span></span>'
    n, keys = f
    return f'<span class="fit">{minis(keys)}<span>Goes with {n} of yours</span></span>'


def own_line(n, keys=None):
    if not n:
        return ""
    return f'<span class="fit">{minis(keys) if keys else ""}<span>You own {n} like {"this" if n == 1 else "these"}</span></span>'


def by_line(person):
    return f'<a class="by" href="person.html">{avatar(person, "xs")}<span>{possessive(person)}</span></a>'


def piece_card(key, href="pin.html", saved=False, vt=False):
    """Someone else's piece: a cutout (or a photo pin) on paper, whose it is, and how it fits your closet."""
    kind = "photo" if is_photo(key) else "cutout"
    v = f' style="view-transition-name: piece-{key}"' if vt else ""
    return (f'<article class="pc {kind}"><div class="pc-ph"><a href="{href}" class="pc-img"><img src="{src(key)}" alt="{e(name_of(key))}" loading="lazy"{v}></a>'
            f'{save_btn(saved)}</div><div class="pc-t"><a class="t" href="{href}">{e(name_of(key))}</a>{by_line(owner(key))}{fit_line(key)}</div></article>')


def look_card(lk, href="outfit.html"):
    look = LOOKS_OF[lk]
    mine = [m for _, m in look["own"]]
    return (f'<article class="pc outfit"><div class="pc-ph"><a href="{href}" class="pc-img">{flat(look["keys"], "mini")}</a>{save_btn()}</div>'
            f'<div class="pc-t"><a class="t" href="{href}">{look["name"]}</a>{by_line(look["by"])}{own_line(len(mine), mine)}</div></article>')


def board_cover(bk):
    pins = BOARDS[bk]["pins"]
    if any(is_photo(p) for p in pins):
        return '<span class="mosaic">' + "".join(f'<img src="{src(p)}" alt="">' for p in pins[:3]) + "</span>"
    return flat(pins[:4], "mini")


def board_card(bk, href="board.html"):
    board = BOARDS[bk]
    return (f'<article class="pc board-card"><div class="pc-ph"><a href="{href}" class="pc-img">{board_cover(bk)}</a>{save_btn()}</div>'
            f'<div class="pc-t"><a class="t" href="{href}">{board["name"]}</a>{by_line(board["by"])}{own_line(board["own"])}</div></article>')


def feed(items):
    cards = {"p": lambda k: piece_card(k, vt=(k == TRY_KEY)), "l": look_card, "b": board_card}
    return '<div class="feed">' + "".join(cards[kind](key) for kind, key in items) + "</div>"


HOME_FEED = [("l", "monday-meeting"), ("p", "coat-navy"), ("b", "layers-november"), ("b", "camel-grey"), ("p", "derby-brown"),
             ("l", "friday-dinner"), ("p", "backpack-green"), ("p", "sneaker-white"), ("b", "one-red"), ("p", "scarf"), ("l", "rain-run"), ("p", "shirt-black")]


def table(keys, cls="", live=True):
    """Today's table: your pieces lying on paper. proto.js reads data-spin to shuffle through your outfits."""
    pieces = "".join(f'<img class="tp sl{i}" src="{src(k)}" alt="{e(name_of(k))}">' for i, k in enumerate(keys))
    data = f' data-table data-spin="{e(json.dumps([[src(k) for k in o] for o in SPIN]))}" data-names="{e(json.dumps([[name_of(k) for k in o] for o in SPIN]))}"' if live else ""
    return f'<div class="table {cls}"{data}>{pieces}</div>'


def today_head():
    return (f'<div class="day"><p class="day-big" aria-label="Thursday, 19 degrees">THU 19°</p>'
            f'<p class="day-meta">{ic("sun", "inl")}Sunny until 6, Ljubljana</p></div>')


def today_block():
    return (f'<section class="today">{today_head()}{table(SPIN[0])}'
            f'<div class="row-acts table-acts"><button class="btn grow" data-wear><span>Wear this</span></button>'
            f'<button class="round soft" data-spin-btn aria-label="Spin a new outfit">{ic("shuffle")}</button></div>'
            f'<p class="note-live" aria-live="polite"></p></section>')


def resume_cards():
    thumbs = "".join(f'<img src="{src(k)}" alt="">' for k in ["fleece-cream", "polo-navy", "henley-charcoal"])
    return (f'<div class="resume"><article class="card rc"><span class="rc-thumbs">{thumbs}<span class="badge num">4</span></span>'
            f'<p class="t">Sunday’s scan</p><p class="small muted">4 pieces waiting to be added</p>{btn("Finish adding", "#", "soft full")}</article>'
            f'<article class="card rc"><span class="rc-lay">{flat(MY_BOARDS[0][2], "mini")}</span><p class="t">Autumn layers</p>'
            f'<p class="small muted">Your board, 12 pins</p>{btn("Keep pinning", "board.html", "soft full")}</article></div>')


ADD_OPTS = [("camera", "Add a piece", "One photo and a category", None), ("link", "Add from a link", "Paste a product page you saved", None),
            ("camera", "Scan your clothes", "Several photos, every piece cut out", "Members"),
            ("video", "Film your wardrobe", "One video, all your pieces", "Members"),
            ("image", "Check an outfit", "A photo of what you’re wearing", "Members")]


def add_sheet(open_=False):
    rows = "".join(f'<a class="opt" href="#"><span class="opt-ic">{ic(i)}</span><span class="opt-t"><span class="t">{t}</span><span class="small muted">{s}</span></span>'
                   + (f'<span class="tag">{m}</span>' if m else "") + "</a>" for i, t, s, m in ADD_OPTS)
    return (f'<div class="sheet-wrap" id="sheet-add"{"" if open_ else " hidden"}><a class="scrim" href="#" data-sheet-close aria-label="Close"></a>'
            f'<section class="sheet" role="dialog" aria-modal="true" aria-label="Add clothes"><span class="grab"></span>'
            f'<div class="sheet-h"><h2 class="h2">Add clothes</h2><button class="round ghost" data-sheet-close aria-label="Close">{ic("x")}</button></div>'
            f'<div class="opts">{rows}</div></section></div>')


# ---------------------------------------------------------------- phone screens

def s_home():
    return (f'{head_row()}{today_block()}'
            f'<section class="block">{sec("Pick up where you left off")}{resume_cards()}</section>'
            f'<section class="block">{sec("From people you follow", "explore.html")}{feed(HOME_FEED)}</section>')


SUGGEST = [("Navy pieces I own", "ask-search.html"), ("What goes with my cable knit?", "ask-stylist.html"),
           ("An outfit for a wedding in Piran", "ask-stylist.html"), ("Rain looks from people I follow", "explore.html")]


def ask_field(value="", cancel="home.html"):
    val = (f'<span class="typed">{e(value)}</span>' if value
           else '<span class="caret" aria-hidden="true"></span><span class="ph">Search or ask</span>')
    return (f'<div class="ask-top"><div class="askbar on" style="view-transition-name: ask"><span class="ask-field">{ic("search")}{val}</span>'
            f'<button class="ask-plus" data-sheet-open="add" aria-label="Add clothes">{ic("plus")}</button></div>'
            f'<a class="txt plain" href="{cancel}">Cancel</a></div>')


def s_ask():
    sugg = "".join(f'<a class="sugg" href="{h}">{t}</a>' for t, h in SUGGEST)
    recent = "".join(f'<a class="row" href="{h}">{ic("clock")}<span>{t}</span><span class="grow"></span>{ic("chev")}</a>'
                     for t, h in [("Derby shoes", "ask-search.html"), ("Luka Novak", "person.html"), ("Office", "explore.html")])
    quick = "".join(f'<button class="qk" data-sheet-open="add">{ic(i)}<span>{t}</span></button>'
                    for i, t in [("camera", "Add a piece"), ("link", "Add from a link"), ("video", "Film your wardrobe")])
    return (f'{ask_field()}<section class="block tight"><h2 class="h3">Suggestions</h2><div class="suggs">{sugg}</div></section>'
            f'<section class="block tight"><h2 class="h3">Recent</h2><div class="list pad">{recent}</div></section>'
            f'<section class="block tight"><h2 class="h3">Add clothes</h2><div class="quick">{quick}</div></section>'
            f'<p class="fine">Searching is free. Styld’s stylist answers questions for members; everyone can ask in ChatGPT or Claude.</p>{add_sheet()}')


def s_ask_search():
    person = (f'<a class="row person-row" href="person.html">{avatar("luka", "sm")}<span class="v-t"><span class="t">Luka Novak</span>'
              f'<span class="small muted">“Navy, always”, 6 pins</span></span>{ic("chev")}</a>')
    mine = "".join(cut(k, cap=False) for k in ["knit-navy", "knit-cable-navy", "vneck-navy", "polo-navy"])
    return (f'{ask_field("navy")}<div class="understood"><p class="small muted">Showing</p><div class="chips">{chip("Navy", True, "#", True)}</div></div>'
            f'<section class="block tight">{sec("In your wardrobe", None, "<span class=small>4</span>")}<div class="cuts row4">{mine}</div></section>'
            f'<section class="block tight">{sec("People")}<div class="list pad">{person}</div></section>'
            f'<section class="block tight">{sec("Boards")}<div class="feed">{board_card("navy-always")}{board_card("layers-november")}</div></section>'
            f'<a class="ask-more" href="ask-stylist.html">{ic("chat")}<span>Ask the stylist what to wear with navy</span>{ic("chev")}</a>{add_sheet()}')


def s_ask_stylist():
    look = table(["shirt-sky", "knit-cable-navy", "shorts-denim", "derby-black"], "flush", live=False)
    return (f'{ask_field("What goes with my cable knit for dinner?")}'
            f'<section class="answer"><p class="who">Styld stylist</p>'
            f'<p class="ans">Wear the Oxford shirt under it, collar out, with the derbies. For dinner, dark trousers would beat the denim shorts, and you don’t own any yet.</p>'
            f'<figure class="ans-lay">{look}<figcaption class="lay-cap">From your wardrobe</figcaption></figure>'
            f'<div class="row-acts">{btn("Wear tonight", "#", "", None, " data-toast=\"Set for tonight\"")}{btn("Save as a look", "looks.html", "ghost")}</div>'
            f'<p class="note-live" aria-live="polite"></p></section>'
            f'<section class="block tight">{sec("People wear it with dark trousers", "explore.html")}<div class="feed">{look_card("monday-meeting")}{piece_card("coat-navy", vt=True)}</div></section>'
            f'<p class="fine">Members get answers here. <a class="txt" href="ask-free.html">See it as a free user</a></p>{add_sheet()}')


def s_ask_free():
    looks = "".join(f'<a class="look" href="looks.html">{flat(k, "mini")}<span class="cap">{n}</span></a>' for n, k in MY_LOOKS[:1])
    return (f'{ask_field("What goes with my cable knit for dinner?")}'
            f'<section class="answer free"><p class="ans">The stylist answers this for members. Ask it in ChatGPT or Claude instead, with your wardrobe connected.</p>'
            f'<div class="row-acts fill">{btn("Ask in ChatGPT", "#", "", "out")}{btn("Ask in Claude", "#", "ghost", "out")}</div>'
            f'<a class="txt small" href="#">Become a member</a></section>'
            f'<section class="block tight">{sec("Your looks with the cable knit")}<div class="looks one">{looks}</div></section>'
            f'<section class="block tight">{sec("People who wear knit with navy", "explore.html")}<div class="feed">{look_card("monday-meeting")}{board_card("layers-november")}</div></section>'
            f'<p class="fine">These come from search, which is free.</p>{add_sheet()}')


def s_add():
    return s_ask().replace(add_sheet(), add_sheet(open_=True))


EDITS = [("layers-november", "Layers for November"), ("rain-dressed", "Rain, but dressed"), ("one-red", "Black, one red thing")]
MOODS = [("Knitwear", "sage", ["knit-cable-navy", "scarf", "crew-grey"]), ("Rain", "slate", ["backpack-green", "beanie", "sneaker-white"]),
         ("Office", "stone", ["shirt-white-trim", "derby-brown", "belt-woven"]), ("Weekend", "sand", ["shirt-denim", "shorts-denim", "converse-low"]),
         ("Evening", "plum", ["shirt-black", "derby-black-2", "brooch"]), ("Sport", "olive", ["tee-black-adidas", "boots-football", "backpack-black"])]


def edit_cards(href="board.html"):
    out = []
    for k, title in EDITS:
        board = BOARDS[k]
        by = "Styld" if board["by"] == "styld" else f"By {first(board['by'])}"
        out.append(f'<a class="edit" href="{href}"><span class="edit-lay">{flat(board["pins"][:4], "mini")}</span><span class="edit-t"><span class="t">{title}</span>'
                   f'<span class="small muted">{by}</span>{own_line(board["own"])}</span></a>')
    return '<div class="edits">' + "".join(out) + "</div>"


def mood_tiles():
    return '<div class="moods">' + "".join(
        f'<a class="mood" href="explore.html" style="--tone:var(--t-{tone})"><span class="mood-n">{n}</span><span class="mood-lay">'
        + "".join(f'<img src="{src(k)}" alt="">' for k in keys) + "</span></a>" for n, tone, keys in MOODS) + "</div>"


def person_cards(people=("marko", "tina")):
    out = []
    for p in people:
        pins = next(b for b in BOARDS.values() if b["by"] == p)["pins"][:3]
        thumbs = "".join(f'<img src="{src(k)}" alt="">' for k in pins)
        label = "Following" if PEOPLE[p]["following"] else "Follow"
        out.append(f'<article class="card pcard"><a class="pcard-top" href="person.html">{avatar(p, "sm")}<span class="v-t"><span class="t">{PEOPLE[p]["name"]}</span>'
                   f'<span class="small muted">{PEOPLE[p]["city"]}</span></span></a><span class="pcard-thumbs">{thumbs}</span>'
                   f'<p class="small">{PEOPLE[p]["bio"]}</p>{btn(label, "#", "soft full", None, " data-follow")}</article>')
    return '<div class="pcards">' + "".join(out) + "</div>"


def s_explore():
    return (f'{head_row("Explore")}{askbar(placeholder="Search people, boards and ideas", plus=False)}'
            f'<section class="block">{sec("Edits from Styld")}{edit_cards()}</section>'
            f'<section class="block">{sec("Moods")}{mood_tiles()}</section>'
            f'<section class="block">{sec("People to follow")}{person_cards()}</section>')


def fit_box(key, mine_text):
    n, keys = FIT[key]
    return f'<div class="fit-box">{minis(keys)}<span><span class="t">Goes with {n} of yours</span><span class="small muted">{mine_text}</span></span></div>'


def owner_row(person, note=None):
    note = note or PEOPLE[person]["city"]
    following = "Following" if PEOPLE[person]["following"] else "Follow"
    return (f'<a class="shop-row" href="person.html">{avatar(person, "sm")}<span class="v-t"><span class="t">{PEOPLE[person]["name"]}</span>'
            f'<span class="small muted">{note}</span></span><span class="chip on">{following}</span></a>')


def s_pin():
    k = TRY_KEY
    looks = f'<a class="look" href="outfit.html">{flat(LOOKS_OF["monday-meeting"]["keys"], "mini")}<span class="cap">Monday meeting</span></a>'
    return (f'{back_row("home.html", act("share", "Share"))}'
            f'<div class="pin-hero"><img src="{src(k)}" alt="{e(name_of(k))}" style="view-transition-name: piece-{k}">{save_btn()}</div>'
            f'<section class="pd">{owner_row("luka")}<h1 class="pd-t">{e(name_of(k))}</h1><p class="muted">Outerwear</p>'
            f'{fit_box(k, "Your cable knit, Oxford shirt, derbies and grey crewneck")}'
            f'<div class="row-acts fill">{btn("Try with mine", f"try.html?piece={k}", "", "try")}</div>'
            f'{sec("In Luka’s looks")}<div class="looks one">{looks}</div>'
            f'{sec("More from Luka", "person.html")}<div class="feed">{piece_card("shirt-black")}{piece_card("scarf")}</div></section>')


# Slots as (left %, top %, width %, rotation deg) of the table; pieces are squares.
FOUR = [(4, 4, 50, -3), (48, 2, 48, 4), (10, 46, 46, 2), (54, 56, 40, -6)]
FIVE = [(0, 1, 38, -4), (62, 0, 38, 5), (2, 68, 36, 3), (62, 70, 36, -6)]
FIVE_TALL = 1.25  # the try table is 4:5, so a slot's top is a share of 1.25 widths


def room(i):
    """Where a piece lay on the four-piece table, as a transform from its five-piece slot (for the make-room motion)."""
    x4, y4, w4, r4 = FOUR[i]
    x5, y5, w5, _ = FIVE[i]
    dx = ((x4 + w4 / 2) - (x5 + w5 / 2)) / w5 * 100
    dy = ((y4 + w4 / 2) - (y5 * FIVE_TALL + w5 / 2)) / w5 * 100
    return f"--fx: {dx:.1f}%; --fy: {dy:.1f}%; --fs: {w4 / w5:.3f}; --fr: {r4}deg"


def s_try():
    k = TRY_KEY
    pieces = "".join(f'<img class="tp sl{i}" src="{src(x)}" alt="{e(name_of(x))}" style="{room(i)}">' for i, x in enumerate(TRY_WITH))
    guest = (f'<span class="guest"><img src="{src(k)}" alt="{e(name_of(k))}" data-guest style="view-transition-name: piece-{k}">'
             f'<span class="guest-tag" data-guest-tag>{avatar("luka", "xs")}<span>Luka’s</span></span></span>')
    data = e(json.dumps({key: {"name": v[0], "by": possessive(v[2]), "src": src(key)} for key, v in PIECES.items() if v[3] == "cut"}))
    saved = " data-toast=\"Saved to your looks, with Luka’s coat credited\""
    wanted = " data-toast=\"Added to your wishlist\""
    return (f'{back_row("pin.html", "", "Your table")}'
            f'<section class="today try"><div class="table five" data-try data-pieces="{data}">{pieces}{guest}</div>'
            f'<p class="try-line"><span class="t" data-guest-name>Luka’s navy wool overcoat</span> with your cable knit, Oxford shirt, denim shorts and derbies.</p>'
            f'<div class="row-acts fill">{btn("Save as a look", "#", "", None, saved)}{btn("Want one like it", "#", "ghost", "heart", wanted)}</div>'
            f'<p class="note-live" aria-live="polite"></p><a class="txt small" href="pin.html">Take it off the table</a></section>')


def s_outfit():
    look = LOOKS_OF["monday-meeting"]
    match = dict(look["own"])
    rows = "".join(f'<a class="row piece-row" href="pin.html"><img src="{src(x)}" alt=""><span class="v-t"><span class="t">{e(name_of(x))}</span>'
                   f'<span class="small muted">{"You have: " + W[match[x]] if x in match else "Not in your wardrobe"}</span></span>'
                   f'<span class="txt small">Try</span></a>' for x in look["keys"])
    mine = [m for _, m in look["own"]]
    return (f'{back_row("home.html", act("dots", "More"))}'
            f'<div class="pg-h"><h1 class="title">{look["name"]}</h1>{by_line("luka")}</div>'
            f'<div class="card collage">{flat(look["keys"], "big")}</div>'
            f'<div class="fit-box pad">{minis(mine)}<span><span class="t">You own 2 like these</span><span class="small muted">Your Oxford shirt and derby shoes</span></span></div>'
            f'<div class="row-acts fill pad">{btn("Save the look", "#", "", "save", " data-toast=\"Saved to Boards\"")}{btn("Try it with mine", "try.html", "ghost", "try")}</div>'
            f'<p class="note-live pad" aria-live="polite"></p>'
            f'<section class="block tight">{sec("The pieces")}<div class="list pad">{rows}</div></section>')


def s_person():
    return (f'{back_row("home.html", act("dots", "More"))}'
            f'<section class="person"><span style="view-transition-name: person-nika">{avatar("nika", "xl")}</span><h1 class="title">Nika Kovač</h1>'
            f'<p class="muted">@nika.kovac, Maribor</p><p class="bio">Red, black and one good coat.</p>'
            f'<div class="row-acts">{btn("Following", "#", "soft", "check", " data-follow")}{btn("Share", "#", "ghost", "share")}</div></section>'
            f'<div class="seg"><a class="on" href="#">Boards</a><a href="#">Looks</a><a href="#">Pieces</a></div>'
            f'<div class="feed">{board_card("camel-grey")}{board_card("one-red")}{look_card("friday-dinner")}{piece_card("coat-camel")}</div>')


WARD = ["shirt-denim", "knit-cable-navy", "tee-white-folded", "polo-navy", "shirt-flannel", "hoodie-grey", "fleece-cream",
        "shorts-denim", "longsleeve-stripe", "converse-high", "turtleneck-black", "af1-white", "crew-grey", "sandals-birkenstock"]


def seg(labels, on, hrefs):
    return '<div class="seg">' + "".join(f'<a class="{"on" if i == on else ""}" href="{h}">{l}</a>' for i, (l, h) in enumerate(zip(labels, hrefs))) + "</div>"


def wcats():
    return '<div class="chips scroll">' + "".join(chip(f'{c} <span class="num">{n}</span>', c == "All") for c, n in [("All", 28), ("Tops", 17), ("Bottoms", 3), ("Outerwear", 2), ("Shoes", 6)]) + "</div>"


def ward_head(i):
    add = f'<button class="round dark" data-sheet-open="add" aria-label="Add clothes">{ic("plus")}</button>'
    return (f'{head_row("Wardrobe", add)}{askbar(placeholder="Search your wardrobe", cls="sm", plus=False)}'
            f'{seg(["Pieces", "Looks", "Wishlist"], i, ["wardrobe.html", "looks.html", "wishlist.html"])}')


def s_wardrobe():
    return f'{ward_head(0)}{wcats()}<div class="cuts">{"".join(cut(k) for k in WARD)}</div>{add_sheet()}'


def s_looks():
    tiles = "".join(f'<a class="look" href="item.html">{flat(k, "mini")}<span class="cap">{n}</span></a>' for n, k in MY_LOOKS)
    return f'{ward_head(1)}<div class="looks">{tiles}</div>{add_sheet()}'


def wish(key, title, note):
    return (f'<article class="card wish"><img src="{src(key)}" alt="{e(name_of(key))}"><span class="v-t"><span class="t">{title}</span>'
            f'<span class="small muted">{note}</span>{fit_line(key)}</span></article>')


def s_wishlist():
    items = wish("coat-navy", "Something like Luka’s overcoat", "Added today, from your table") + wish("backpack-green", "A green backpack", "Added last week, from Styld’s edit")
    return f'{ward_head(2)}<div class="wishes">{items}</div><p class="fine">Pieces you want, kept next to the clothes they’d go with.</p>{add_sheet()}'


def s_item():
    looks = "".join(f'<a class="look" href="looks.html">{flat(k, "mini")}</a>' for k in [MY_LOOKS[0][1], ["knit-cable-navy", "tee-white-folded", "shorts-sky", "converse-high"]])
    return (f'{back_row("wardrobe.html", act("edit", "Edit"))}'
            f'<div class="it-photo"><img src="{src("knit-cable-navy")}" alt="Cable knit"></div>'
            f'<section class="pd"><h1 class="pd-t">Cable knit</h1><p class="muted">Tops, knitwear</p>'
            f'<div class="row-acts fill">{btn("Make a look", "looks.html")}{btn("Add to a board", "board.html", "ghost")}</div>'
            f'{sec("In your looks")}<div class="looks">{looks}</div>'
            f'{sec("People wear it with", "explore.html")}<div class="feed">{piece_card("coat-navy")}{piece_card("scarf")}</div>'
            f'<dl class="facts"><div><dt>Colour</dt><dd><span class="dot" style="--sw:var(--c-navy)"></span>Navy</dd></div><div><dt>Season</dt><dd>Autumn, winter</dd></div>'
            f'<div><dt>Worn</dt><dd>4 times, last on Sunday</dd></div><div><dt>Notes</dt><dd>Hand wash, dry flat.</dd></div></dl></section>')


def following_row():
    out = []
    for p in ["luka", "nika", "styld"]:
        vt = ' style="view-transition-name: person-nika"' if p == "nika" else ""
        out.append(f'<a class="fol" href="person.html"><span{vt}>{avatar(p, "lg")}</span><span>{first(p)}</span></a>')
    return '<div class="follow">' + "".join(out) + "</div>"


def my_board_cards(href="board.html"):
    out = []
    for k, n, keys, c in MY_BOARDS:
        vt = ' style="view-transition-name: board-autumn"' if k == "autumn" else ""
        out.append(f'<a class="board" href="{href}"><span class="bcov"{vt}>{flat(keys, "mini")}</span><span class="t">{n}</span><span class="m">{c}</span></a>')
    return '<div class="strip">' + "".join(out) + "</div>"


def saved_from_others():
    return f'{piece_card("coat-navy", saved=True, vt=True)}{look_card("monday-meeting")}{piece_card("coat-camel", saved=True)}{piece_card("backpack-green", saved=True)}'


def s_boards():
    new = f'<button class="round" aria-label="New board">{ic("plus")}</button>'
    return (f'{head_row("Boards", new)}<section class="block first">{sec("Your boards")}{my_board_cards()}</section>'
            f'<section class="block">{sec("Saved from others", None, "<span class=small>4</span>")}<div class="feed">{saved_from_others()}</div></section>'
            f'<section class="block">{sec("People you follow", "explore.html")}{following_row()}</section>')


def s_board():
    pins = ["knit-cable-navy", "coat-navy", "shirt-sky", "scarf", "derby-black", "coat-grey", "crew-grey"]
    tiles = []
    for x in pins:
        credit = "" if x in W else f'<span class="credit">{avatar(owner(x), "xs")}{possessive(owner(x))}</span>'
        tiles.append(f'<a class="pin{" photo" if is_photo(x) else ""}" href="{"item.html" if x in W else "pin.html"}"><img src="{src(x)}" alt="{e(name_of(x))}">{credit}</a>')
    return (f'{back_row("boards.html", act("share", "Share"))}'
            f'<div class="pg-h"><h1 class="title">Autumn layers</h1><p class="muted">12 pins, public on your profile</p></div>'
            f'<div class="card collage" style="view-transition-name: board-autumn">{flat(MY_BOARDS[0][2], "big")}<span class="tag dark">Collage</span></div>'
            f'<div class="pins">{"".join(tiles)}</div>')


def worn_week():
    days = [("Mon", SPIN[1]), ("Tue", SPIN[2]), ("Thu", SPIN[0])]
    return '<div class="week">' + "".join(f'<span class="wk">{flat(k, "mini")}<span class="cap">{d}</span></span>' for d, k in days) + "</div>"


def you_cards():
    avs = "".join(avatar(p, "xs") for p in ["luka", "nika", "styld"])
    return (f'<a class="card prof" href="#"><span class="av lg">K</span><span class="v-t"><span class="t">Kristjan</span><span class="small muted">kristjan@example.com</span></span>{ic("chev")}</a>'
            f'<div class="duo"><a class="card mini-card" href="boards.html"><span class="mc-thumbs"><img src="{src("coat-navy")}" alt=""><img src="{src("backpack-green")}" alt=""></span><span class="t">Saved</span></a>'
            f'<a class="card mini-card" href="boards.html"><span class="mc-avs">{avs}</span><span class="t">Following</span></a></div>'
            f'<section class="card member"><div><p class="t">Member</p><p class="small"><span class="num">957</span> credits, renews 12 November</p></div><a class="txt on-ink" href="#">Manage</a></section>'
            f'<a class="card agents" href="#"><span class="opt-ic">{ic("chat")}</span><span class="v-t"><span class="t">Styld in ChatGPT and Claude</span><span class="small muted">Connected to ChatGPT</span></span>{ic("chev")}</a>'
            f'<section class="block">{sec("Worn this week")}{worn_week()}</section>')


def s_you():
    return (f'{head_row("You", "<span></span>")}{you_cards()}'
            f'<div class="list pad"><a class="row" href="#">{ic("user")}<span>Profile</span><span class="grow"></span>{ic("chev")}</a>'
            f'<a class="row" href="#">{ic("shield")}<span>Data and privacy</span><span class="grow"></span>{ic("chev")}</a><a class="row" href="#"><span>Sign out</span></a></div>')


PHONE = [("Home and Ask", [("home", "Home", s_home, "home"), ("ask", "Ask", s_ask, "ask"), ("ask-search", "Ask: a search", s_ask_search, "ask"),
                           ("ask-stylist", "Ask: the stylist (member)", s_ask_stylist, "ask"), ("ask-free", "Ask: the same question (free)", s_ask_free, "ask"),
                           ("add", "Add clothes", s_add, "ask")]),
         ("Inspiration", [("explore", "Explore", s_explore, "explore"), ("pin", "Someone’s piece", s_pin, None), ("try", "Try with mine", s_try, None),
                          ("outfit", "Someone’s look", s_outfit, None), ("person", "A person", s_person, "explore")]),
         ("Yours", [("wardrobe", "Wardrobe", s_wardrobe, "wardrobe"), ("looks", "Looks", s_looks, "wardrobe"), ("wishlist", "Wishlist", s_wishlist, "wardrobe"),
                    ("item", "A piece you own", s_item, None), ("boards", "Boards", s_boards, "boards"), ("board", "A board", s_board, "boards"),
                    ("you", "You", s_you, "you")])]
PHONE_MAP = {k: (n, f, nav) for _, items in PHONE for k, n, f, nav in items}


# ---------------------------------------------------------------- desktop screens

def dshell(active, inner, overlay=""):
    return f'<div class="dwrap">{rail(active)}<main class="dmain">{inner}</main>{overlay}</div>'


def dlinks(s):
    for k in ["home", "explore", "pin", "person", "wardrobe", "boards", "you", "ask"]:
        s = s.replace(f'href="{k}.html"', f'href="{k}-desktop.html"')
    return s


def d_home(overlay="", active="home"):
    side = (f'<div class="dside">{sec("Pick up where you left off")}{resume_cards()}'
            f'<div class="dask-inline">{askbar("ask-desktop.html", "Search, or ask the stylist")}</div></div>')
    inner = (f'<div class="dhome"><div>{today_block()}</div>{side}</div>'
             f'<section class="block">{sec("From people you follow", "explore.html")}{feed(HOME_FEED)}</section>{add_sheet()}')
    return dshell(active, dlinks(inner), overlay)


def d_ask():
    sugg = "".join(f'<a class="sugg" href="{h}">{t}</a>' for t, h in SUGGEST)
    quick = "".join(f'<button class="qk" data-sheet-open="add">{ic(i)}<span>{t}</span></button>' for i, t, _, _ in ADD_OPTS[:4])
    panel = (f'<div class="dask"><div class="askbar on d" style="view-transition-name: ask">{ic("search")}<span class="caret" aria-hidden="true"></span>'
             f'<span class="ph">Search your clothes, people and boards</span><button class="ask-plus" data-sheet-open="add" aria-label="Add clothes">{ic("plus")}</button></div>'
             f'<div class="dask-body"><h2 class="h3">Suggestions</h2><div class="suggs">{sugg}</div><h2 class="h3">Add clothes</h2><div class="quick">{quick}</div>'
             f'<p class="fine">Searching is free. Styld’s stylist answers questions for members; everyone can ask in ChatGPT or Claude.</p></div></div>')
    return d_home(f'<a class="dscrim" href="home-desktop.html" aria-label="Close"></a>{dlinks(panel)}', active="ask")


def d_explore():
    inner = (f'<div class="pg-h d row"><h1 class="dtitle left">Explore</h1>{askbar(placeholder="Search people, boards and ideas", cls="sm", plus=False)}</div>'
             f'<section class="block">{sec("Edits from Styld")}{edit_cards()}</section>'
             f'<section class="block">{sec("Moods")}{mood_tiles()}</section>'
             f'<section class="block">{sec("People to follow")}{person_cards(("marko", "tina", "nika", "luka"))}</section>')
    return dshell("explore", dlinks(inner))


def d_pin():
    k = TRY_KEY
    looks = "".join(f'<a class="look" href="outfit.html">{flat(LOOKS_OF[l]["keys"], "mini")}<span class="cap">{LOOKS_OF[l]["name"]}</span></a>' for l in ["monday-meeting", "rain-run"])
    more = "".join(piece_card(x) for x in ["shirt-black", "scarf", "derby-brown", "beanie", "sneaker-white"])
    inner = (f'<div class="dpin"><div class="pin-hero big"><img src="{src(k)}" alt="{e(name_of(k))}" style="view-transition-name: piece-{k}">{save_btn()}</div>'
             f'<section class="pd">{owner_row("luka")}<h1 class="pd-t xl">{e(name_of(k))}</h1><p class="muted">Outerwear</p>'
             f'{fit_box(k, "Your cable knit, Oxford shirt, derbies and grey crewneck")}'
             f'<div class="row-acts">{btn("Try with mine", f"try.html?piece={k}", "", "try")}</div>'
             f'{sec("In Luka’s looks")}<div class="looks">{looks}</div></section></div>'
             f'<section class="block">{sec("More from Luka", "person.html")}<div class="feed">{more}</div></section>')
    return dshell("explore", dlinks(inner))


def d_person():
    cards = (f'{board_card("camel-grey")}{board_card("one-red")}{look_card("friday-dinner")}{piece_card("coat-camel")}{piece_card("coat-grey")}'
             f'{piece_card("shirt-red")}{piece_card("pumps-black")}{piece_card("bag-burgundy")}{piece_card("dress-sheer")}{piece_card("brooch")}')
    inner = (f'<section class="person wide"><span style="view-transition-name: person-nika">{avatar("nika", "xl")}</span><div><h1 class="dtitle left">Nika Kovač</h1>'
             f'<p class="muted">@nika.kovac, Maribor</p><p class="bio">Red, black and one good coat.</p></div><span class="grow"></span>'
             f'<div class="row-acts">{btn("Following", "#", "soft", "check", " data-follow")}{btn("Share", "#", "ghost", "share")}</div></section>'
             f'<div class="seg narrow"><a class="on" href="#">Boards</a><a href="#">Looks</a><a href="#">Pieces</a></div><div class="feed">{cards}</div>')
    return dshell("explore", dlinks(inner))


def d_wardrobe():
    inner = (f'<div class="pg-h d row"><h1 class="dtitle left">Wardrobe</h1>{seg(["Pieces", "Looks", "Wishlist"], 0, ["wardrobe.html", "looks.html", "wishlist.html"])}'
             f'<span class="grow"></span><button class="btn" data-sheet-open="add">{ic("plus")}<span>Add clothes</span></button></div>'
             f'<div class="wtools">{askbar(placeholder="Search your wardrobe", cls="sm", plus=False)}{wcats()}</div>'
             f'<div class="cuts c6">{"".join(cut(k) for k in list(W)[:24])}</div>{add_sheet()}')
    return dshell("wardrobe", dlinks(inner))


def d_boards():
    inner = (f'<h1 class="dtitle">Boards</h1><section class="block first">{sec("Your boards", None, btn("New board", "#", "sm soft", "plus"))}{my_board_cards()}</section>'
             f'<section class="block">{sec("Saved from others")}<div class="feed">{saved_from_others()}{board_card("layers-november")}</div></section>'
             f'<section class="block">{sec("People you follow")}{following_row()}</section>')
    return dshell("boards", dlinks(inner))


def d_you():
    side = "".join(f'<a class="{"on" if i == 0 else ""}" href="#">{t}</a>' for i, t in enumerate(["Account", "Profile", "Membership", "Connected apps", "Data and privacy"]))
    inner = f'<div class="dyou"><nav class="ynav" aria-label="Account">{side}</nav><div class="ycol">{you_cards()}</div></div>'
    return dshell("you", dlinks(inner))


DESK = [("home", "Home", d_home), ("ask", "Ask open", d_ask), ("explore", "Explore", d_explore), ("pin", "Someone’s piece", d_pin),
        ("person", "A person", d_person), ("wardrobe", "Wardrobe", d_wardrobe), ("boards", "Boards", d_boards), ("you", "You", d_you)]
DESK_MAP = {k: (n, f) for k, n, f in DESK}


# ---------------------------------------------------------------- pages

HEAD = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{title}</title><meta name="description" content="Styld design: your clothes are the interface. A clickable prototype.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{root}gallery2.css">{script}</head>'''
OPEN = '<script>if (matchMedia("(min-width: 900px)").matches) document.querySelector(".screens")?.setAttribute("open", "");</script>'
SCALE_DESK = '''<script>
// Fit the 1440px desktop frame to the space; without scripting it scrolls sideways instead.
(() => { const s = document.querySelector(".desk-stage"), f = s && s.querySelector(".frame.desk"); if (!f) return;
  const fit = () => { const k = Math.min(1, s.clientWidth / 1440); f.style.transform = `scale(${k})`; s.style.height = `${900 * k}px`; };
  fit(); addEventListener("resize", fit); })();
</script>'''
SCRIPT = '<script src="proto.js" defer></script>'


def side(screen, desk):
    groups = "".join(f'<p class="sg">{g}</p>' + "".join(f'<a href="{k}.html" class="{"on" if k == screen and not desk else ""}">{n}</a>' for k, n, _, _ in items) for g, items in PHONE)
    dl = "".join(f'<a href="{k}-desktop.html" class="{"on" if k == screen and desk else ""}">{n}</a>' for k, n, _ in DESK)
    name = DESK_MAP[screen][0] if desk else PHONE_MAP[screen][0]
    view = (f'<div class="view"><a href="{screen}.html" class="{"" if desk else "on"}">Phone</a><a href="{screen}-desktop.html" class="{"on" if desk else ""}">Desktop</a></div>'
            if screen in DESK_MAP and screen in PHONE_MAP else "")
    return f'''<aside class="side-nav"><a class="back-all" href="../index.html">All screens</a><h1 class="dir-name">{name}</h1>{view}
<details class="screens"><summary>Screens</summary><nav aria-label="Screens">{groups}<p class="sg">Desktop</p>{dl}</nav></details></aside>'''


def typeset(page):
    parts = re.split(r"(<[^>]+>)", page)
    for i, part in enumerate(parts):
        if part and not part.startswith("<"):
            parts[i] = re.sub(r"(?<=[A-Za-zčšž])'(?=[A-Za-z])", "’", part)
    return "".join(parts)


def phone_page(k):
    name, fn, nav = PHONE_MAP[k]
    navhtml = phone_nav(nav) if nav else ""
    cls = " has-nav" if nav else ""
    return typeset(HEAD.format(title=f"{name}, Styld", root="", script=SCRIPT) + f'<body class="proto">{side(k, False)}'
                   f'<main class="stage"><div class="frame phone{cls}"><div class="screen s-{k}">{fn()}</div>{navhtml}</div></main>{OPEN}</body></html>')


def desk_page(k):
    name, fn = DESK_MAP[k]
    return typeset(HEAD.format(title=f"{name} on desktop, Styld", root="", script=SCRIPT) + f'<body class="proto is-desk">{side(k, True)}'
                   f'<main class="stage desk-stage"><div class="frame desk"><div class="dscreen">{fn()}</div></div></main>{OPEN}{SCALE_DESK}</body></html>')


def hub():
    groups = []
    for g, items in PHONE:
        cards = "".join(f'<a class="sc" href="v2/{k}.html"><img src="v2/thumbs/{k}.jpg" alt="" width="370" height="600" loading="lazy"><span>{n}</span></a>' for k, n, _, _ in items)
        groups.append(f'<section class="sgroup"><h2>{g}</h2><div class="sgrid">{cards}</div></section>')
    desks = "".join(f'<a class="sc wide" href="v2/{k}-desktop.html"><img src="v2/thumbs/{k}-desktop.jpg" alt="" width="720" height="450" loading="lazy"><span>{n}</span></a>' for k, n, _ in DESK)
    return typeset(HEAD.format(title="Styld design", root="v2/", script="") + f'''<body class="index"><header class="ix-top">{LOGO}<div><h1>Your clothes are the interface</h1>
<p>Your outfit opens the app; try anyone’s piece next to it.</p>
<p class="small-note">Spin, Wear this, Save, Try with mine and Add clothes work, so tap them. No shops in this round. Your wardrobe is a real Styld wardrobe. Luka, Nika, Marko and Tina are examples, dressed in pieces from Slovenian shops. Earlier: <a href="v1/index.html">Gallery, version 1</a> (with sign-in and onboarding) and <a href="archive/index.html">the ten first directions</a>.</p></div></header>
<main class="ix-main">{"".join(groups)}<section class="sgroup"><h2>Desktop</h2><div class="sgrid wide">{desks}</div></section></main></body></html>''')


def build():
    thumbs = OUT / "thumbs"
    keep = {f: (thumbs / f).read_bytes() for f in os.listdir(thumbs)} if thumbs.is_dir() else {}
    if OUT.exists():
        shutil.rmtree(OUT)
    thumbs.mkdir(parents=True)
    current = set(PHONE_MAP) | {f"{k}-desktop" for k in DESK_MAP}
    for f, data in keep.items():
        if f.removesuffix(".jpg") in current:
            (thumbs / f).write_bytes(data)
    shutil.copytree(PROTO / "assets", OUT / "assets")
    css = (HERE / "gallery2.css").read_text().replace("/*SPRING*/", SPRING).replace("/*SPRING_BOUNCE*/", SPRING_BOUNCE)
    (OUT / "gallery2.css").write_text(css)
    shutil.copy(HERE / "proto.js", OUT / "proto.js")
    for k in PHONE_MAP:
        (OUT / f"{k}.html").write_text(phone_page(k))
    for k in DESK_MAP:
        (OUT / f"{k}-desktop.html").write_text(desk_page(k))
    (OUT / "index.html").write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../index.html"><a href="../index.html">Styld design</a>')
    (SITE / "index.html").write_text(hub())
    # Gallery 1 used to live at the site root; keep its old links working.
    (SITE / "_redirects").write_text("/s/* /v1/s/:splat 301\n/thumbs/* /v1/thumbs/:splat 301\n/assets/* /v1/assets/:splat 301\n")
    print("pages:", len(PHONE_MAP) + len(DESK_MAP))


build()
