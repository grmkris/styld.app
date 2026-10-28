"""Clickable prototypes of Styld's main screens in ten design directions."""
import html
import json
import os
import re
import shutil

OUT = "/tmp/design-proto"
P = json.load(open("/tmp/design-lab/pieces.json"))
C = json.load(open("/tmp/design-lab/colors.json"))
K = json.load(open("/tmp/design-lab/cats.json"))
svg = open("/home/kristjan/code/stylelab/apps/web/public/brand/wordmark.svg").read()
VB = re.search(r'viewBox="([^"]+)"', svg).group(1)
LD = re.search(r' d="([^"]+)"', svg).group(1)
LOGO = f'<svg class="logo" viewBox="{VB}" role="img" aria-label="Styld"><path fill="currentColor" d="{LD}"/></svg>'
HEX = {"white": "#FFFFFF", "beige": "#D8C3A5", "brown": "#7B4B2A", "pink": "#E8A0B4", "red": "#C0392B", "purple": "#7D4CA6",
       "navy": "#1F2A44", "blue": "#3B6FD8", "green": "#3C7A4A", "grey": "#8A8A8A", "black": "#111111"}
CNAME = {"white": "White", "beige": "Beige", "brown": "Brown", "pink": "Pink", "red": "Red", "purple": "Purple",
         "navy": "Navy", "blue": "Blue", "green": "Green", "grey": "Grey", "black": "Black"}
# Real counts of women's pieces per colour on styld.app (catalog.facets, 2026-10-28).
CCOUNT = {"black": 687, "blue": 445, "beige": 306, "brown": 304, "red": 250, "green": 238, "pink": 156, "white": 145,
          "grey": 109, "navy": 54, "purple": 35}
ORDER = list(HEX)
e = html.escape


def norm(title):
    """Shop titles as Styld would show them: no dashes, sentence case for shouting ones."""
    t = title.replace(" – ", ", ").replace(" - ", ", ").replace("–", ",")
    return t[:1].upper() + t[1:].lower() if t.isupper() else t


for _p in P + C + K:
    _p["title"] = norm(_p["title"])


def cat(c, n=5):
    return [p for p in K if p["cat"] == c][:n]


def by_colour(c, n=6):
    return [p for p in C if p["color"] == c][:n]


def eur(p):
    return f"{float(p['price']):.2f} €".replace(".", ",")


I = {
    "home": '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
    "shop": '<path d="M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2"/>',
    "boards": '<rect x="3" y="3" width="8" height="10" rx="1"/><rect x="13" y="3" width="8" height="6" rx="1"/><rect x="13" y="11" width="8" height="10" rx="1"/><rect x="3" y="15" width="8" height="6" rx="1"/>',
    "wardrobe": '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    "save": '<path d="M6 3h12v18l-6-5-6 5z"/>',
    "heart": '<path d="M12 20s-7-4.6-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.4-9 9-9 9z"/>',
    "x": '<path d="M6 6l12 12M18 6 6 18"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    "filter": '<path d="M4 6h16M7 12h10M10 18h4"/>',
    "back": '<path d="M15 5l-7 7 7 7"/>',
    "share": '<path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "camera": '<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/>',
    "tag": '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
    "pin": '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    "out": '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    "chev": '<path d="m9 6 6 6-6 6"/>',
    "dots": '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    "check": '<path d="m5 12 5 5 9-10"/>',
    "chat": '<path d="M4 5h16v11H9l-5 4z"/>',
    "list": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    "hanger": '<path d="M24 7.5V6a3 3 0 1 0-3-3M24 7.5 3 20h42z"/>',
}


def icon(name, cls=""):
    vb = "0 0 48 22" if name == "hanger" else "0 0 24 24"
    return f'<svg class="ic {cls}" viewBox="{vb}" aria-hidden="true">{I[name]}</svg>'


GOOGLE = ('<svg class="ic g" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z"/>'
          '<path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z"/>'
          '<path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9z"/>'
          '<path fill="#EA4335" d="M12 5.9c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.7 9.3 5.9 12 5.9z"/></svg>')

DIRS = [
    dict(key="gallery", n=1, name="Gallery", pick=True,
         note="Warm paper and umber, one sans typeface, no outlines. Text tabs, two lines under each card, wide gutters. The calm base."),
    dict(key="mono", n=2, name="Monochrome",
         note="White and black only. Condensed capitals for headings echo the logo; photos run edge to edge with hairline gaps."),
    dict(key="soft", n=3, name="Soft boutique", save="heart",
         note="Warm grey ground, white rounded cards, filled pill controls and a heart for Save. Friendly and app-like."),
    dict(key="pin", n=4, name="Pinterest", masonry=True,
         note="Image first. Photos keep their own height in a masonry grid, a red Save on every picture, little text."),
    dict(key="night", n=5, name="Night",
         note="Near-black ground, warm off-white type, the logo in white. Photos glow; one sand accent marks what's active."),
    dict(key="lookbook", n=6, name="Lookbook", home="lookbook", shop="lookbook", piece="spread",
         note="Reads like a magazine: one big photo a page, the name set large over it. Shop becomes edits with a story."),
    dict(key="deck", n=7, name="Swipe deck", home="deck", shop="deck",
         note="One piece at a time: swipe right to save, left to skip. Every swipe teaches Styld your taste."),
    dict(key="rail", n=8, name="Clothing rail", home="rail", shop="rail", wardrobe="rail",
         note="Pieces hang on rails like a shop's racks: a rail per mood, per shop, and per category in your wardrobe."),
    dict(key="colour", n=9, name="Colour wall", home="colour", shop="colour", wardrobe="colour",
         note="Browse by colour. A spectrum bar is the filter; the catalog and your wardrobe sort into colour families."),
    dict(key="index", n=10, name="Index", home="index", shop="index", wardrobe="index", boards="index",
         note="A typographic price list: rows with shop and price in columns and a small photo. Fast to scan, very calm."),
]

SCREENS = [
    ("Start", [("landing", "Landing"), ("login", "Sign in"), ("onboarding", "Pick what you love")]),
    ("Browse", [("home", "Home"), ("shop", "Shop"), ("filters", "Shop filters"), ("piece", "A piece"), ("shop-page", "A shop's page")]),
    ("Wardrobe", [("wardrobe", "Wardrobe"), ("item", "A wardrobe piece"), ("add", "Add pieces")]),
    ("Boards", [("boards", "Boards"), ("board", "A board"), ("profile", "A person's profile")]),
    ("You", [("account", "Account")]),
]
SCREEN_NAMES = {k: n for _, items in SCREENS for k, n in items}
DESKTOP = ["home", "shop", "piece", "wardrobe", "board", "profile"]


# ---------------------------------------------------------------- components

def tabbar(active):
    items = [("home", "Home"), ("shop", "Shop"), ("boards", "Boards"), ("wardrobe", "Wardrobe")]
    links = "".join(
        f'<a href="{k}.html" class="tab{" on" if k == active else ""}"{" aria-current=page" if k == active else ""}>{icon(k)}<span>{label}</span></a>'
        for k, label in items)
    you = f'<a href="account.html" class="tab{" on" if active == "account" else ""}"><span class="av">K</span><span>You</span></a>'
    return f'<nav class="tabbar" aria-label="App">{links}{you}</nav>'


def top(right=None):
    right = right if right is not None else '<a href="account.html" class="av" aria-label="Your account">K</a>'
    return f'<header class="top"><a href="home.html" class="logo-link">{LOGO}</a>{right}</header>'


def save_btn(d, saved=False):
    name = d.get("save", "save")
    return f'<button class="save{" is-saved" if saved else ""}" aria-label="Save">{icon(name)}</button>'


def card(d, p, saved=False, cls=""):
    sale = '<span class="sale">Sale</span>' if p.get("onSale") else ""
    return (f'<article class="card {cls}"><div class="ph"><a href="piece.html" class="ph-link"><img src="{e(p["img"])}" alt="{e(p["title"])}" loading="lazy"></a>'
            f'{save_btn(d, saved)}{sale}</div>'
            f'<div class="meta"><a href="piece.html" class="t">{e(p["title"])}</a><p class="m"><a href="shop-page.html" class="shop">{e(p["shop"])}</a>'
            f'<span class="price">{eur(p)}</span></p></div></article>')


def grid(d, items, saved_idx=(), cols=2):
    cls = "mason" if d.get("masonry") else "grid"
    return f'<div class="{cls} c{cols}">' + "".join(card(d, p, i in saved_idx, f"v{i % 5}") for i, p in enumerate(items)) + "</div>"


def spectrum(active=None, link=True):
    out = []
    for c in ORDER:
        tag = "a href=shop.html" if link else "span"
        cur = ' aria-current="true"' if c == active else ""
        out.append(f'<{tag} class="sw{" on" if c == active else ""}" style="--sw:var(--c-{c})" aria-label="{CNAME[c]}"{cur}></{tag.split()[0]}>')
    return '<div class="spec" role="list">' + "".join(out) + "</div>"


def chips(labels, on=0, cls="chips", href=None):
    out = []
    for i, label in enumerate(labels):
        attrs = f' href="{href}"' if href else ""
        tag = "a" if href else "button"
        out.append(f'<{tag} class="chip{" on" if i == on else ""}"{attrs}>{label}</{tag}>')
    return f'<div class="{cls}">' + "".join(out) + "</div>"


def tabs(labels, on=0, extra=""):
    links = "".join(f'<a class="tl{" on" if i == on else ""}" href="#">{label}</a>' for i, label in enumerate(labels))
    return f'<div class="tabs">{links}<span class="grow"></span>{extra}</div>'


def btn(label, href="#", kind="", ic=None):
    inner = (icon(ic) if ic else "") + f"<span>{label}</span>"
    return f'<a class="btn {kind}" href="{href}">{inner}</a>'


def round_btn(name, href="#", label="", kind="light"):
    return f'<a class="round {kind}" href="{href}" aria-label="{label or name}">{icon(name)}</a>'


# ---------------------------------------------------------------- phone screens

def s_landing(d):
    peek = "".join(f'<a href="piece.html"><img src="{e(p["img"])}" alt="{e(p["title"])}"></a>' for p in [P[1], P[13], P[21]])
    return f'''{top('<a class="txt" href="login.html">Sign in</a>')}
<section class="hero"><h1 class="display">A wardrobe shaped by you.</h1>
<p class="lede">Save what you love from 23 Slovenian shops and dress from your own closet.</p>
<div class="acts">{btn("Start free", "onboarding.html")}{btn("Browse the shops", "shop.html", "ghost")}</div></section>
<div class="peek">{peek}</div>
<p class="note">Also in ChatGPT and Claude.</p>'''


def s_login(d):
    return f'''{top('<span></span>')}
<section class="form"><h1 class="h1">Sign in</h1><p class="lede">We'll email you a six-digit code. New here? The same code creates your account.</p>
<label class="field"><span>Email</span><input type="email" placeholder="ana@example.com"></label>
{btn("Send code", "onboarding.html", "block")}
<div class="or"><span>or</span></div>
<a class="btn ghost block" href="onboarding.html">{GOOGLE}<span>Continue with Google</span></a></section>'''


def deck_cards(a, b, c=None):
    back2 = f'<div class="dk back2"><img src="{e(c["img"])}" alt=""></div>' if c else ""
    return (f'<div class="deck">{back2}<div class="dk back"><img src="{e(b["img"])}" alt=""></div>'
            f'<a href="piece.html" class="dk front"><img src="{e(a["img"])}" alt="{e(a["title"])}"><div class="dk-meta"><p class="t">{e(a["title"])}</p>'
            f'<p class="m">{e(a["shop"])}, {eur(a)}</p></div></a></div>')


def deck_actions(next_href):
    return (f'<div class="dk-acts"><a class="round big" href="{next_href}" aria-label="Skip">{icon("x")}</a>'
            f'<a class="round big dark" href="{next_href}" aria-label="Save">{icon("save")}</a></div>')


def s_onboarding(d):
    return f'''<header class="top"><a class="txt muted" href="home.html">Skip</a><span class="step">4 of 10</span></header>
<div class="progress" role="progressbar" aria-valuenow="4" aria-valuemax="10"><span style="width:40%"></span></div>
<h1 class="h1 center">Would you wear it?</h1><p class="lede center">Swipe right to save, left to pass. Your picks fill your feed.</p>
{deck_cards(P[13], P[21], P[3])}{deck_actions("home.html")}'''


def today_card(d):
    pick = cat("trousers")[1]
    return (f'<section class="today"><a href="item.html"><img src="{e(pick["img"])}" alt="{e(pick["title"])}"></a><div class="today-t"><p class="small muted">Today from your wardrobe</p>'
            f'<p class="t">{e(pick["title"])}</p></div>{btn("Spin", "#", "sm")}</section>')


def rail(d, title, items, sub="", href="piece.html"):
    show_price = href.startswith("piece")
    hang = "".join(f'<a class="rl-item" href="{href}">{icon("hanger", "hanger")}<img src="{e(p["img"])}" alt="{e(p["title"])}"><span class="cap">{e(p["title"])}{f"<em>{eur(p)}</em>" if show_price else ""}</span></a>' for p in items)
    return f'<section class="rl"><div class="rl-head"><h2 class="h3">{title}</h2><span class="small muted">{sub}</span></div><div class="rl-bar"></div><div class="rl-items">{hang}</div></section>'


def ix_rows(items, href="piece.html", open_first=False, price=True):
    out = []
    for i, p in enumerate(items):
        pr = f'<span class="ix-pr">{eur(p)}</span>' if price else ""
        if open_first and i == 0:
            out.append(f'<article class="ix-row open"><div class="ix-main"><a href="{href}" class="t">{e(p["title"])}</a><p class="m">{e(p.get("shop", ""))}</p>'
                       f'<a href="{href}"><img src="{e(p["img"])}" alt="{e(p["title"])}"></a><div class="ix-acts">{btn("Save", "#", "sm")}<a class="txt" href="shop-page.html">Visit shop</a></div></div>{pr}</article>')
        else:
            out.append(f'<a class="ix-row" href="{href}"><div class="ix-main"><span class="t">{e(p["title"])}</span><span class="m">{e(p.get("shop", ""))}</span></div>'
                       f'<img class="ix-thumb" src="{e(p["img"])}" alt="">{pr}</a>')
    return "".join(out)


def colour_groups(colours, per=3, href="shop.html", items_href="piece.html"):
    out = []
    for c in colours:
        tiles = "".join(f'<a href="{items_href}"><img src="{e(p["img"])}" alt="{e(p["title"])}"></a>' for p in by_colour(c, per))
        out.append(f'<section class="cw-group"><a class="cw-label" href="{href}"><span class="cw-dot" style="--sw:var(--c-{c})"></span>{CNAME[c]}<em>{CCOUNT[c]} pieces</em></a><div class="cw-row">{tiles}</div></section>')
    return "".join(out)


def s_home(d):
    kind = d.get("home", "feed")
    if kind == "lookbook":
        a, b, c = P[1], P[3], P[5]
        body = f'''{top()}
<a class="lb-spread" href="piece.html"><img src="{e(a["img"])}" alt="{e(a["title"])}"><span class="lb-over"><span class="lb-no">1 of 24</span><span class="lb-title">{e(a["title"])}</span><span class="lb-cap">{e(a["shop"])}, {eur(a)}</span></span></a>
<div class="lb-pair"><a href="piece.html"><img src="{e(b["img"])}" alt="{e(b["title"])}"><span class="cap">{e(b["title"])}<em>{eur(b)}</em></span></a><a href="piece.html" class="low"><img src="{e(c["img"])}" alt="{e(c["title"])}"><span class="cap">{e(c["title"])}<em>{eur(c)}</em></span></a></div>'''
    elif kind == "deck":
        body = f'''{top()}<div class="dk-head"><h1 class="h1">For you</h1><span class="small muted">12 saved today</span></div>
{deck_cards(P[2], P[4], P[6])}{deck_actions("home.html")}<p class="hint">Swipe right to save, left to skip</p>'''
    elif kind == "rail":
        body = f'''{top()}<h1 class="h1">Good morning, Kristjan</h1>{rail(d, "For the cold", [P[3], P[13], P[21], P[4]], "From 3 shops")}{rail(d, "Brown, everywhere", by_colour("brown", 4), "From 4 shops")}'''
    elif kind == "colour":
        body = f'''{top()}<h1 class="h1">What colour today?</h1>{spectrum()}{colour_groups(["beige", "brown", "red", "navy"])}'''
    elif kind == "index":
        body = f'''{top()}<div class="ix-head"><h1 class="h1">New today</h1><span class="muted">24</span></div>{ix_rows(P[:9], open_first=True)}'''
    else:
        body = f'''{top()}{today_card(d)}
<div class="sec-head"><h1 class="h1">Inspiration</h1></div>
{tabs(["For you", "Following"], 0, '<button class="chip on">Women</button>')}
{grid(d, P[:8], saved_idx=(1,))}'''
    return body


def s_shop(d):
    kind = d.get("shop", "grid")
    search = f'<label class="search">{icon("search")}<input type="search" placeholder="Search pieces, try &quot;linen dress&quot;"></label>'
    tools = (f'<div class="tools"><a class="tool" href="filters.html">{icon("filter")}<span>Filters</span></a>'
             f'<button class="chip on">Women</button><button class="chip">On sale</button><span class="grow"></span><a class="sort" href="#">Newest</a></div>')
    if kind == "lookbook":
        rows = "".join(f'<a class="lb-row" href="piece.html"><img src="{e(p["img"])}" alt="{e(p["title"])}"><span><span class="h3">{e(p["title"])}</span><span class="m">{e(p["shop"])}</span><span class="pr">{eur(p)}</span></span></a>' for p in P[8:13])
        return f'''{top()}<div class="lb-head"><h1 class="h1">The cold edit</h1><p class="lede">Coats, knits and boots picked this week from the shops.</p></div>
<div class="edits">{chips(["The cold edit", "Under 50 €", "Evening", "Denim"], 0)}</div>{rows}'''
    if kind == "deck":
        return f'''{top()}<div class="dk-head"><h1 class="h1">Coats</h1><a class="small txt" href="filters.html">Women, under 100 €</a></div>
{chips(["Coats", "Knitwear", "Boots", "Bags", "Dresses"], 0)}{deck_cards(P[21], P[4], P[22])}{deck_actions("shop.html")}'''
    if kind == "rail":
        stj = [x for x in P if x["shop"] == "Stajling"][:4]
        ssx = [x for x in P if x["shop"] == "Secretstylex"][:4]
        jl = [x for x in P if x["shop"] == "Joe & Luca"][:4]
        return f'''{top()}<h1 class="h1">Shops</h1>{search}{rail(d, '<a href="shop-page.html">Stajling</a>', stj, "Maribor")}{rail(d, '<a href="shop-page.html">Secretstylex</a>', ssx, "Ljubljana")}{rail(d, '<a href="shop-page.html">Joe &amp; Luca</a>', jl, "Celje")}'''
    if kind == "colour":
        tiles = "".join(card(d, p) for p in by_colour("green", 6))
        return f'''{top()}<h1 class="h1">Green</h1>{spectrum("green")}<p class="count">{CCOUNT["green"]} pieces in green</p><div class="grid c2">{tiles}</div>'''
    if kind == "index":
        letters = "".join(f'<a href="#">{ch}</a>' for ch in "ABCDEFGHIJKLMNOPRSŠTUVZŽ")
        rows = ix_rows(sorted(P[8:20], key=lambda p: float(p["price"])))
        return f'''{top()}<div class="ix-head"><h1 class="h1">Price list</h1><span class="muted">6,271</span></div>
<div class="ix-sort"><a class="on" href="#">Price</a><a href="#">Name</a><a href="#">Shop</a><a href="#">New</a><span class="grow"></span><a class="txt" href="filters.html">Filters</a></div>
<div class="ix-wrap">{rows}<nav class="ix-az" aria-label="Jump to letter">{letters}</nav></div>'''
    return f'''{top()}<h1 class="h1">Shop</h1>{search}{spectrum()}{tools}<p class="count">6,271 pieces from 23 shops</p>{grid(d, P[8:16])}'''


def s_filters(d):
    shops = ["Stajling", "Secretstylex", "Joe & Luca", "Fiore", "Avocado", "Extraordinary"]
    return f'''{top()}<h1 class="h1">Shop</h1>{grid(d, P[8:12])}
<a class="scrim" href="shop.html" aria-label="Close filters"></a>
<section class="sheet" aria-label="Filters"><div class="grab"></div><div class="sheet-head"><h2 class="h2">Filters</h2><a class="txt" href="#">Clear</a></div>
<h3 class="label">Category</h3>{chips(["All", "Knitwear", "Coats", "Dresses", "Jeans", "Shoes", "Bags"], 2, "chips wrap")}
<h3 class="label">Colour</h3>{spectrum("brown", link=False)}
<h3 class="label">Price</h3><div class="range"><span class="num">0 €</span><div class="track"><span></span></div><span class="num">100 €</span></div>
<h3 class="label">Shops</h3>{chips(shops, -1, "chips wrap")}
{btn("Show 312 pieces", "shop.html", "block")}</section>'''


def s_piece(d):
    p = P[21]
    more = "".join(f'<a href="piece.html"><img src="{e(x["img"])}" alt="{e(x["title"])}"></a>' for x in [P[1], P[2], P[11], P[12]])
    if d.get("piece") == "spread":
        return f'''<a class="lb-spread tall" href="shop.html" aria-label="Back to the edit"><img src="{e(p["img"])}" alt="{e(p["title"])}"><span class="lb-over"><span class="lb-no">2 of 24</span><span class="lb-title">{e(p["title"])}</span><span class="lb-cap">{e(p["shop"])}, {eur(p)}</span></span></a>
<section class="pd"><div class="pd-acts">{btn("Save", "#", "", d.get("save", "save"))}{btn("I own this", "wardrobe.html", "ghost")}</div>
<p class="desc">A wool-blend coat with a notched collar and a tie belt, falling below the knee. Sizes S to XL at the shop.</p>
<a class="row" href="#">{icon("wardrobe")}<span>Try it on you</span><span class="grow"></span><span class="muted small">Members</span>{icon("chev")}</a>
<a class="row" href="shop-page.html">{icon("out")}<span>Buy at {e(p["shop"])}</span><span class="grow"></span>{icon("chev")}</a></section>'''
    return f'''<div class="pd-photo"><img src="{e(p["img"])}" alt="{e(p["title"])}"><div class="pd-bar">{round_btn("back", "shop.html", "Back")}<span class="grow"></span>{round_btn("share", "#", "Share")}</div><div class="dots"><span class="on"></span><span></span><span></span></div></div>
<section class="pd"><a class="shoplink small" href="shop-page.html">{e(p["shop"])}</a><h1 class="h1 tight">{e(p["title"])}</h1><p class="price-lg num">{eur(p)}</p>
<div class="pd-acts">{btn("Save", "#", "", d.get("save", "save"))}{btn("I own this", "wardrobe.html", "ghost")}</div>
<a class="row" href="#">{icon("wardrobe")}<span>Try it on you</span><span class="grow"></span><span class="muted small">Members</span>{icon("chev")}</a>
<a class="row" href="shop-page.html">{icon("out")}<span>Buy at {e(p["shop"])}</span><span class="grow"></span>{icon("chev")}</a>
<h2 class="h3">More from {e(p["shop"])}</h2><div class="strip">{more}</div></section>'''


def s_shop_page(d):
    stj = [x for x in P if x["shop"] == "Stajling"][:6]
    head = f'''<section class="ph-head"><div class="avatar-lg">S</div><h1 class="h1">Stajling</h1><p class="muted">{icon("pin", "inl")}Ulica Eve Lovše 1, Maribor</p>
<p class="bio">Women's fashion for every day and evening, from Maribor.</p>
<div class="acts">{btn("Follow")}{btn("Visit shop", "#", "ghost", "out")}</div></section>'''
    if d.get("shop") == "index":
        return f'{top()}{head}{tabs(["Pieces", "Boards"])}' + ix_rows(stj)
    if d.get("shop") == "rail":
        return f'{top()}{head}' + rail(d, "New in", stj[:3], "This week") + rail(d, "Boots", [x for x in P if "Škornji" in x["title"]], "2 pieces")
    return f'{top()}{head}{tabs(["Pieces", "Boards"], 0, "<a class=sort href=#>Newest</a>")}{grid(d, stj)}'


WARD = cat("knitwear", 2) + cat("jeans", 2) + cat("dresses", 2) + cat("shirts_blouses", 2)


def wtile(p):
    return f'<a class="wd" href="item.html"><img src="{e(p["img"])}" alt="{e(p["title"])}"><span class="cap">{e(p["title"])}</span></a>'


def s_wardrobe(d):
    kind = d.get("wardrobe", "grid")
    add = f'<a class="round dark sm" href="add.html" aria-label="Add pieces">{icon("plus")}</a>'
    head = f'{top(add)}<h1 class="h1">Wardrobe</h1>{tabs(["Pieces", "Looks", "Wishlist"], 0, "<span class=muted>42</span>")}'
    if kind == "rail":
        return head + rail(d, "Tops", cat("knitwear", 3), "14", "item.html") + rail(d, "Bottoms", cat("jeans", 3), "9", "item.html") + rail(d, "Dresses", cat("dresses", 3), "6", "item.html")
    if kind == "colour":
        groups = []
        for c, items in [("beige", cat("knitwear", 5)[3:5] + cat("shirts_blouses", 1)), ("black", cat("knitwear", 2)[1:2] + cat("jeans", 1) + cat("dresses", 1)), ("blue", cat("jeans", 3)[1:3] + cat("shirts_blouses", 2)[1:2])]:
            tiles = "".join(f'<a href="item.html"><img src="{e(p["img"])}" alt="{e(p["title"])}"></a>' for p in items)
            groups.append(f'<section class="cw-group"><p class="cw-label"><span class="cw-dot" style="--sw:var(--c-{c})"></span>{CNAME[c]}<em>{len(items) + 3} pieces</em></p><div class="cw-row">{tiles}</div></section>')
        return head + spectrum(link=False) + "".join(groups)
    if kind == "index":
        rows = ix_rows([dict(p, shop=s) for p, s in zip(WARD, ["Knitwear", "Knitwear", "Jeans", "Jeans", "Dresses", "Dresses", "Shirts", "Shirts"])], "item.html", price=False)
        return head + '<div class="cats"><a class="on" href="#">All</a><a href="#">Tops</a><a href="#">Bottoms</a><a href="#">Dresses</a><a href="#">Outerwear</a><a href="#">Shoes</a></div>' + rows
    tiles = "".join(wtile(p) for p in WARD[:6])
    cls = "wmason" if d.get("masonry") else "wgrid"
    return (head + '<div class="cats"><a class="on" href="#">All</a><a href="#">Tops</a><a href="#">Bottoms</a><a href="#">Dresses</a><a href="#">Outerwear</a><a href="#">Shoes</a></div>'
            + chips(["Knitwear", "Shirts", "T-shirts", "Sports"], -1, "chips sub") + f'<div class="{cls}">{tiles}</div>')


def s_item(d):
    x = cat("knitwear")[0]
    return f'''<header class="top">{round_btn("back", "wardrobe.html", "Back")}<span class="grow"></span>{round_btn("dots", "#", "More")}</header>
<div class="it-photo"><img src="{e(x["img"])}" alt="{e(x["title"])}"></div>
<section class="pd"><h1 class="h1 tight">{e(x["title"])}</h1><p class="muted">Tops, knitwear</p>
<div class="swatches"><span style="--sw:var(--c-cream)" aria-label="Cream"></span><span style="--sw:var(--c-umber)" aria-label="Dark brown"></span></div>
<div class="pd-acts">{btn("Make an outfit")}{btn("Add to a board", "board.html", "ghost")}</div>
<dl class="facts"><div><dt>Season</dt><dd>Autumn, winter</dd></div><div><dt>Worn</dt><dd>3 times, last on Monday</dd></div><div><dt>Notes</dt><dd>Wash cold, dry flat.</dd></div></dl></section>'''


def s_add(d):
    found = cat("outerwear", 2) + cat("shoes", 1) + cat("bags", 1)
    tiles = "".join(f'<figure class="found"><img src="{e(x["img"])}" alt="{e(x["title"])}"><button class="tick" aria-label="Keep {e(x["title"])}" aria-pressed="true">{icon("check")}</button><figcaption>{e(x["title"])}</figcaption></figure>' for x in found)
    return f'''<header class="top">{round_btn("x", "wardrobe.html", "Close")}<span class="step">Scan</span><span class="spacer"></span></header>
<h1 class="h1">4 pieces found</h1><p class="lede">Product shots are on their way. Untick anything that isn't yours.</p>
<div class="wgrid found-grid">{tiles}</div>
<div class="add-ways"><a class="row" href="#">{icon("camera")}<span>Scan more photos</span><span class="grow"></span>{icon("chev")}</a><a class="row" href="#">{icon("tag")}<span>Add a piece by hand</span><span class="grow"></span>{icon("chev")}</a></div>
<div class="footer-cta">{btn("Add 4 to my wardrobe", "wardrobe.html", "block")}</div>'''


BOARDS = [("Winter in Ljubljana", [P[3], P[21], P[1]], "14 pins", "Public"),
          ("Brown, all over", [P[0], by_colour("brown")[1], P[16]], "9 pins", "Private"),
          ("Wedding guest", [cat("dresses")[0], cat("bags")[0], cat("shoes")[1]], "6 pins", "Private"),
          ("First picks", [P[5], P[13], P[9]], "10 pins", "Private")]


def cover(ps):
    a, b, c = ps
    return f'<span class="cover"><img class="c1" src="{e(a["img"])}" alt=""><img class="c2" src="{e(b["img"])}" alt=""><img class="c3" src="{e(c["img"])}" alt=""></span>'


def s_boards(d):
    head = f'{top()}<div class="sec-head"><h1 class="h1">Boards</h1>{btn("New board", "#", "sm", "plus")}</div>{tabs(["Boards", "Collages", "Saved"])}'
    if d.get("boards") == "index":
        def stack(ps):
            return "".join(f'<img src="{e(p["img"])}" alt="">' for p in ps)
        rows = "".join(f'<a class="ix-row" href="board.html"><div class="ix-main"><span class="t">{n}</span><span class="m">{c}, {v.lower()}</span></div><span class="ix-stack">{stack(ps)}</span></a>' for n, ps, c, v in BOARDS)
        return head + rows
    tiles = "".join(f'<a class="board" href="board.html">{cover(ps)}<span class="t">{n}</span><span class="m"><span>{c}</span><span>{v}</span></span></a>' for n, ps, c, v in BOARDS)
    return head + f'<div class="bgrid">{tiles}</div>'


def collage():
    coll = [P[21], P[1], cat("bags")[0], cat("jewelry")[0]]
    return (f'<div class="collage"><img class="k1" src="{e(coll[0]["img"])}" alt=""><img class="k2" src="{e(coll[1]["img"])}" alt="">'
            f'<img class="k3" src="{e(coll[2]["img"])}" alt=""><img class="k4" src="{e(coll[3]["img"])}" alt=""><span class="ctag">Collage</span></div>')


def board_pins(n=6):
    pins = [P[3], P[1], P[21], cat("bags")[1], P[13], cat("shoes")[0], P[4], cat("jewelry")[1], P[22], P[5]][:n]
    return '<div class="pins">' + "".join(f'<a class="pinx v{i % 4}" href="piece.html"><img src="{e(x["img"])}" alt="{e(x["title"])}"></a>' for i, x in enumerate(pins)) + "</div>"


def s_board(d):
    return f'''<header class="top">{round_btn("back", "boards.html", "Back")}<span class="grow"></span>{round_btn("share", "#", "Share")}{round_btn("dots", "#", "More")}</header>
<section class="bd-head"><h1 class="h1">Winter in Ljubljana</h1><p class="muted small">14 pins, public on your <a class="txt" href="profile.html">profile</a></p></section>
{collage()}{board_pins()}'''


def s_profile(d):
    bs = [("Winter in Ljubljana", P[21]), ("Piran weekend", cat("dresses")[2]), ("Office, but soft", cat("suits_blazers")[0]), ("Black tie", cat("dresses")[4])]
    tiles = "".join(f'<a class="board" href="board.html"><img class="cover1" src="{e(x["img"])}" alt=""><span class="t">{n}</span></a>' for n, x in bs)
    return f'''{top()}
<section class="ph-head"><div class="avatar-lg photo"><img src="{e(cat("knitwear")[3]["img"])}" alt="Maja Novak"></div><h1 class="h1">Maja Novak</h1><p class="muted">@maja.novak</p>
<p class="bio">Ljubljana. Neutral colours, good coats, too many boots.</p>
<div class="acts">{btn("Follow")}{round_btn("dots", "#", "More")}</div></section>
{tabs(["Boards", "Looks"])}<div class="bgrid">{tiles}</div>'''


def s_account(d):
    row = lambda ic, label, href="#", val="": f'<a class="row" href="{href}">{icon(ic) if ic else ""}<span>{label}</span><span class="grow"></span>{f"<span class=muted>{val}</span>" if val else ""}{icon("chev")}</a>'
    return f'''{top('<span></span>')}
<section class="me"><span class="av lg">K</span><div><h1 class="h2">Kristjan</h1><p class="muted small">kris@example.com</p></div></section>
<section class="member"><div><p class="t">Member</p><p class="m"><span class="num">397</span> credits, renews 12 November</p></div><a class="txt" href="#">Manage</a></section>
<div class="list">{row("chat", "Use Styld in ChatGPT or Claude")}{row("pin", "Public profile", "profile.html", "@kristjan")}{row("shop", "Shops you follow", "shop-page.html", "6")}{row("tag", "Activity")}{row("wardrobe", "Style profile")}{row("", "Language", "#", "Slovenščina")}
<a class="row" href="landing.html"><span>Sign out</span></a></div>'''


PHONE = {"landing": s_landing, "login": s_login, "onboarding": s_onboarding, "home": s_home, "shop": s_shop, "filters": s_filters,
         "piece": s_piece, "shop-page": s_shop_page, "wardrobe": s_wardrobe, "item": s_item, "add": s_add, "boards": s_boards,
         "board": s_board, "profile": s_profile, "account": s_account}
TAB_OF = {"home": "home", "shop": "shop", "filters": "shop", "piece": "shop", "shop-page": "shop", "wardrobe": "wardrobe", "item": "wardrobe",
          "boards": "boards", "board": "boards", "profile": "boards", "account": "account"}
NO_TABBAR = {"landing", "login", "onboarding", "add", "piece", "item", "board"}


# ---------------------------------------------------------------- desktop screens

def dtop(active):
    navs = "".join(f'<a href="{k}-desktop.html" class="{"on" if k == active else ""}">{n}</a>' if k in DESKTOP else f'<a href="{k}.html">{n}</a>'
                   for k, n in [("home", "Home"), ("shop", "Shop"), ("boards", "Boards"), ("wardrobe", "Wardrobe")])
    return (f'<header class="dtop"><a href="home-desktop.html" class="logo-link">{LOGO}</a><nav class="dnav" aria-label="App">{navs}</nav><span class="grow"></span>'
            f'<label class="search small">{icon("search")}<input type="search" placeholder="Search"></label><a href="account.html" class="av" aria-label="Your account">K</a></header>')


def dgrid(d, items, cols=5):
    cls = "mason" if d.get("masonry") else "grid"
    return f'<div class="{cls} c{cols}">' + "".join(card(d, p, False, f"v{i % 5}") for i, p in enumerate(items)) + "</div>"


def d_home(d):
    kind = d.get("home", "feed")
    if kind == "lookbook":
        a, b, c = P[13], P[21], P[3]
        return dtop("home") + f'''<div class="lb-desk"><a class="big" href="piece-desktop.html"><img src="{e(a["img"])}" alt="{e(a["title"])}"></a>
<div class="lb-dtext"><span class="lb-no">1 of 24</span><h1 class="lb-title">{e(a["title"])}</h1><p class="lb-cap">{e(a["shop"])}, {eur(a)}</p>{btn("Save to a board")}</div>
<a class="s1" href="piece-desktop.html"><img src="{e(b["img"])}" alt="{e(b["title"])}"><span class="cap">{e(b["title"])}</span></a>
<a class="s2" href="piece-desktop.html"><img src="{e(c["img"])}" alt="{e(c["title"])}"><span class="cap">{e(c["title"])}</span></a></div>'''
    if kind == "deck":
        saved = "".join(f'<a href="piece-desktop.html"><img src="{e(p["img"])}" alt="{e(p["title"])}"></a>' for p in P[14:20])
        return dtop("home") + f'''<div class="dk-desk"><div class="dk-col"><h1 class="h1">For you</h1><p class="muted">Swipe, or use the arrow keys</p>{deck_cards(P[11], P[9], P[10])}{deck_actions("home-desktop.html")}</div>
<aside class="dk-saved"><h2 class="h3">Saved today <span class="muted num">12</span></h2><div class="dk-thumbs">{saved}</div><a class="txt" href="boards.html">Put them on a board</a></aside></div>'''
    if kind == "rail":
        return dtop("home") + f'<div class="dbody">' + rail(d, "For the cold", [P[3], P[13], P[21], P[4], P[22], P[14]], "From 3 shops", "piece-desktop.html") + rail(d, "Brown, everywhere", by_colour("brown", 6), "From 4 shops", "piece-desktop.html") + "</div>"
    if kind == "colour":
        wall = "".join(f'<a href="piece-desktop.html" style="--sw:var(--c-{c})"><img src="{e(p["img"])}" alt="{e(p["title"])}"></a>' for c in ORDER for p in by_colour(c, 4))
        return dtop("home") + f'<div class="dbody"><div class="cw-dhead"><h1 class="h1">The catalog, by colour</h1>{spectrum()}</div><div class="cw-wall">{wall}</div></div>'
    if kind == "index":
        hov = P[13]
        return dtop("home") + f'''<div class="ix-desk"><div><div class="ix-head"><h1 class="h1">New today</h1><span class="muted">24</span></div>{ix_rows(P[10:20], "piece-desktop.html")}</div>
<figure class="ix-preview"><img src="{e(hov["img"])}" alt="{e(hov["title"])}"><figcaption>{e(hov["title"])}<em>{e(hov["shop"])}, {eur(hov)}</em></figcaption></figure></div>'''
    pick = cat("trousers")[1]
    return dtop("home") + f'''<div class="dbody"><section class="today wide"><a href="item.html"><img src="{e(pick["img"])}" alt="{e(pick["title"])}"></a><div class="today-t"><p class="small muted">Today from your wardrobe</p><p class="t">{e(pick["title"])}</p></div><span class="grow"></span>{btn("Spin", "#", "sm")}{btn("Make an outfit", "#", "sm ghost")}</section>
<div class="drow"><h1 class="h1">Inspiration</h1>{tabs(["For you", "Following"])}<span class="grow"></span><button class="chip on">Women</button><button class="chip">All</button></div>{dgrid(d, P[12:22])}</div>'''


def d_shop(d):
    kind = d.get("shop", "grid")
    if kind == "index":
        return dtop("shop") + f'''<div class="ix-desk"><div><div class="ix-head"><h1 class="h1">Price list</h1><span class="muted">6,271</span></div>{ix_rows(sorted(P[:12], key=lambda p: float(p["price"])), "piece-desktop.html")}</div>
<figure class="ix-preview"><img src="{e(P[3]["img"])}" alt=""><figcaption>{e(P[3]["title"])}<em>{e(P[3]["shop"])}, {eur(P[3])}</em></figcaption></figure></div>'''
    if kind == "rail":
        stj = [x for x in P if x["shop"] == "Stajling"][:6]
        ssx = [x for x in P if x["shop"] == "Secretstylex"][:6]
        return dtop("shop") + '<div class="dbody">' + rail(d, "Stajling", stj, "Maribor", "piece-desktop.html") + rail(d, "Secretstylex", ssx, "Ljubljana", "piece-desktop.html") + "</div>"
    if kind == "deck":
        return dtop("shop") + f'''<div class="dk-desk"><div class="dk-col"><h1 class="h1">Coats</h1>{chips(["Coats", "Knitwear", "Boots", "Bags", "Dresses"], 0)}{deck_cards(P[21], P[4], P[22])}{deck_actions("shop-desktop.html")}</div>
<aside class="dk-saved"><h2 class="h3">Filters</h2><h3 class="label">Colour</h3>{spectrum(link=False)}<h3 class="label">Price</h3><div class="range"><span class="num">0 €</span><div class="track"><span></span></div><span class="num">100 €</span></div></aside></div>'''
    if kind == "lookbook":
        rows = "".join(f'<a class="lb-drow" href="piece-desktop.html"><img src="{e(p["img"])}" alt="{e(p["title"])}"><span class="h3">{e(p["title"])}</span><span class="m">{e(p["shop"])}, {eur(p)}</span></a>' for p in P[8:12])
        return dtop("shop") + f'<div class="dbody"><div class="drow"><h1 class="h1 xl">The cold edit</h1><span class="grow"></span>{chips(["The cold edit", "Under 50 €", "Evening", "Denim"], 0)}</div><div class="lb-drows">{rows}</div></div>'
    side_cats = "".join(f'<a href="#" class="{"on" if i == 0 else ""}">{c}</a>' for i, c in enumerate(["All pieces", "Knitwear", "Coats", "Dresses", "Skirts", "Jeans", "Trousers", "Shoes", "Bags", "Jewellery"]))
    title = "Green" if kind == "colour" else "Shop"
    items = by_colour("green", 6) + by_colour("green", 6)[:2] if kind == "colour" else C[0:8] + C[12:16]
    return dtop("shop") + f'''<div class="dshop"><aside class="side"><h1 class="h1">{title}</h1><nav class="sidenav" aria-label="Categories">{side_cats}</nav><h3 class="label">Colour</h3>{spectrum("green" if kind == "colour" else None)}
<h3 class="label">Price</h3><div class="range"><span class="num">0 €</span><div class="track"><span></span></div><span class="num">250 €</span></div></aside>
<div><div class="drow"><p class="count">{"238 pieces in green" if kind == "colour" else "6,271 pieces from 23 shops"}</p><span class="grow"></span><button class="chip on">Women</button><button class="chip">On sale</button><a class="sort" href="#">Newest</a></div>{dgrid(d, items, 4)}</div></div>'''


def d_piece(d):
    p = P[21]
    more = dgrid(d, [P[1], P[2], P[11], P[12], P[4]], 5)
    return dtop("shop") + f'''<div class="dpiece"><div class="dp-photos"><img src="{e(p["img"])}" alt="{e(p["title"])}"><img src="{e(P[22]["img"])}" alt=""></div>
<section class="pd"><a class="shoplink small" href="shop-page.html">{e(p["shop"])}</a><h1 class="h1 tight xl">{e(p["title"])}</h1><p class="price-lg num">{eur(p)}</p>
<div class="pd-acts">{btn("Save", "#", "", d.get("save", "save"))}{btn("I own this", "wardrobe-desktop.html", "ghost")}</div>
<a class="row" href="#">{icon("wardrobe")}<span>Try it on you</span><span class="grow"></span><span class="muted small">Members</span>{icon("chev")}</a>
<a class="row" href="shop-page.html">{icon("out")}<span>Buy at {e(p["shop"])}</span><span class="grow"></span>{icon("chev")}</a>
<p class="desc">A wool-blend coat with a notched collar and a tie belt, falling below the knee. Sizes S to XL at the shop.</p></section></div>
<div class="dbody"><h2 class="h2">More from {e(p["shop"])}</h2>{more}</div>'''


def d_wardrobe(d):
    kind = d.get("wardrobe", "grid")
    items = WARD + cat("outerwear", 2) + cat("suits_blazers", 2)
    head = f'<div class="dbody"><div class="drow"><h1 class="h1">Wardrobe</h1>{tabs(["Pieces", "Looks", "Wishlist"])}<span class="grow"></span>{btn("Edit categories", "#", "sm ghost")}{btn("Add pieces", "add.html", "sm", "plus")}</div>'
    if kind == "rail":
        return dtop("wardrobe") + head + rail(d, "Tops", cat("knitwear", 4) + cat("shirts_blouses", 2), "14", "item.html") + rail(d, "Bottoms", cat("jeans", 4) + cat("trousers", 2), "9", "item.html") + "</div>"
    if kind == "index":
        rows = ix_rows([dict(p, shop=s) for p, s in zip(items, ["Knitwear"] * 2 + ["Jeans"] * 2 + ["Dresses"] * 2 + ["Shirts"] * 2 + ["Coats"] * 2 + ["Blazers"] * 2)], "item.html", price=False)
        return dtop("wardrobe") + head + f'<div class="ix-desk flat"><div>{rows}</div><figure class="ix-preview"><img src="{e(items[0]["img"])}" alt=""><figcaption>{e(items[0]["title"])}<em>Knitwear, worn 3 times</em></figcaption></figure></div></div>'
    if kind == "colour":
        groups = colour_groups(["beige", "black", "blue"], 6, "#", "item.html")
        return dtop("wardrobe") + head + spectrum(link=False) + groups + "</div>"
    tiles = "".join(wtile(p) for p in items)
    cls = "wmason c6" if d.get("masonry") else "wgrid c6"
    return dtop("wardrobe") + head + f'<div class="cats"><a class="on" href="#">All <span class="num">42</span></a><a href="#">Tops <span class="num">14</span></a><a href="#">Bottoms <span class="num">9</span></a><a href="#">Dresses <span class="num">6</span></a><a href="#">Outerwear <span class="num">5</span></a><a href="#">Shoes <span class="num">6</span></a></div><div class="{cls}">{tiles}</div></div>'


def d_board(d):
    return dtop("boards") + f'''<div class="dboard"><section class="bd-side"><h1 class="h1 xl">Winter in Ljubljana</h1><p class="muted">14 pins, public on your <a class="txt" href="profile-desktop.html">profile</a></p>
<div class="pd-acts">{btn("Add pins", "#", "", "plus")}{btn("Share", "#", "ghost", "share")}</div>{collage()}</section>{board_pins(10)}</div>'''


def d_profile(d):
    bs = [("Winter in Ljubljana", P[21]), ("Piran weekend", cat("dresses")[2]), ("Office, but soft", cat("suits_blazers")[0]), ("Black tie", cat("dresses")[4]), ("Knits", cat("knitwear")[1])]
    tiles = "".join(f'<a class="board" href="board-desktop.html"><img class="cover1" src="{e(x["img"])}" alt=""><span class="t">{n}</span></a>' for n, x in bs)
    return dtop("boards") + f'''<div class="dbody"><section class="ph-head row-l"><div class="avatar-lg photo"><img src="{e(cat("knitwear")[3]["img"])}" alt="Maja Novak"></div><div><h1 class="h1 xl">Maja Novak</h1><p class="muted">@maja.novak</p><p class="bio">Ljubljana. Neutral colours, good coats, too many boots.</p></div><span class="grow"></span>{btn("Follow")}</section>
{tabs(["Boards", "Looks"])}<div class="bgrid c5">{tiles}</div></div>'''


DESK = {"home": d_home, "shop": d_shop, "piece": d_piece, "wardrobe": d_wardrobe, "board": d_board, "profile": d_profile}


# ---------------------------------------------------------------- pages

HEAD = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{title}</title><meta name="description" content="Clickable prototypes of Styld's main screens in ten design directions.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{root}proto.css"></head>'''

OPEN = '<script>if (matchMedia("(min-width: 900px)").matches) document.querySelector(".screens")?.setAttribute("open", "");</script>'

FIT = '''<script>
// Scale the desktop frame to the width available; without scripting it scrolls sideways instead.
(() => { const s = document.querySelector(".desk-stage"); const f = s && s.querySelector(".frame.desk"); if (!f) return;
  const fit = () => { const k = Math.min(1, s.clientWidth / 1440); f.style.transform = `scale(${k})`; s.style.height = `${900 * k}px`; };
  fit(); addEventListener("resize", fit); })();
</script>'''


def side(d, screen, desktop):
    i = DIRS.index(d)
    prev, nxt = DIRS[i - 1], DIRS[(i + 1) % len(DIRS)]
    groups = []
    for g, items in SCREENS:
        links = "".join(f'<a href="{k}.html" class="{"on" if k == screen and not desktop else ""}"{" aria-current=page" if k == screen and not desktop else ""}>{n}</a>' for k, n in items)
        groups.append(f'<p class="sg">{g}</p>{links}')
    dlinks = "".join(f'<a href="{k}-desktop.html" class="{"on" if k == screen and desktop else ""}">{SCREEN_NAMES[k]}</a>' for k in DESKTOP)
    view = ""
    if screen in DESKTOP:
        view = (f'<div class="view"><a href="{screen}.html" class="{"" if desktop else "on"}">Phone</a>'
                f'<a href="{screen}-desktop.html" class="{"on" if desktop else ""}">Desktop</a></div>')
    pick = '<p class="badge">Current pick</p>' if d.get("pick") else ""
    return f'''<aside class="side-nav"><a class="back-all" href="../index.html">All directions</a>
<h1 class="dir-name">{d["n"]}. {d["name"]}</h1>{pick}<p class="dir-note">{d["note"]}</p>{view}
<details class="screens"><summary>Screens</summary><nav aria-label="Screens">{"".join(groups)}<p class="sg">Desktop</p>{dlinks}</nav></details>
<nav class="dir-step" aria-label="Directions"><a href="../{prev["key"]}/{screen}{"-desktop" if desktop else ""}.html">Previous: {prev["name"]}</a><a href="../{nxt["key"]}/{screen}{"-desktop" if desktop else ""}.html">Next: {nxt["name"]}</a></nav></aside>'''


def phone_page(d, screen):
    inner = PHONE[screen](d)
    bar = "" if screen in NO_TABBAR else tabbar(TAB_OF.get(screen))
    page = (HEAD.format(title=f'{SCREEN_NAMES[screen]}, {d["name"]}', root="../")
            + f'<body class="proto" data-dir="{d["key"]}">{side(d, screen, False)}'
            + f'<main class="stage"><div class="frame phone{" has-bar" if bar else ""}"><div class="screen s-{screen}">{inner}</div>{bar}</div></main>{OPEN}</body></html>')
    return page


def desk_page(d, screen):
    inner = DESK[screen](d)
    return (HEAD.format(title=f'{SCREEN_NAMES[screen]} on desktop, {d["name"]}', root="../")
            + f'<body class="proto is-desk" data-dir="{d["key"]}">{side(d, screen, True)}'
            + f'<main class="stage desk-stage"><div class="frame desk"><div class="dscreen d-{screen}">{inner}</div></div></main>{OPEN}{FIT}</body></html>')


def index_page():
    cards = []
    for d in DIRS:
        pick = '<span class="badge">Current pick</span>' if d.get("pick") else ""
        cards.append(f'''<a class="dir-card" href="{d["key"]}/home.html"><img src="thumbs/{d["key"]}.jpg" alt="{d["name"]}: Home on a phone" width="370" height="560">
<span class="dc-name">{d["n"]}. {d["name"]}{pick}</span><span class="dc-note">{d["note"]}</span></a>''')
    return (HEAD.format(title="Styld design directions", root="")
            + f'''<body class="index"><header class="ix-top">{LOGO}<div><h1>Ten directions for Styld</h1>
<p>Each one is a clickable prototype of the same fifteen screens, from the landing page to your wardrobe and boards, with desktop views of six. Tap a direction to walk through it; the tab bar, cards and buttons all lead somewhere. The pieces are real, from Styld's shops; people, boards and counts on personal screens are examples.</p></div></header>
<main class="dir-grid">{"".join(cards)}</main></body></html>''')


def typeset(page):
    parts = re.split(r"(<[^>]+>)", page)
    for i, part in enumerate(parts):
        if part and not part.startswith("<"):
            parts[i] = re.sub(r"(?<=[A-Za-zčšž])'(?=[A-Za-z])", "\u2019", part)
    return "".join(parts)


def build():
    thumbs = f"{OUT}/thumbs"
    keep = {f: open(f"{thumbs}/{f}", "rb").read() for f in os.listdir(thumbs)} if os.path.isdir(thumbs) else {}
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(thumbs)
    for f, data in keep.items():
        open(f"{thumbs}/{f}", "wb").write(data)
    for d in DIRS:
        os.makedirs(f'{OUT}/{d["key"]}')
        for screen in PHONE:
            open(f'{OUT}/{d["key"]}/{screen}.html', "w").write(typeset(phone_page(d, screen)))
        for screen in DESK:
            open(f'{OUT}/{d["key"]}/{screen}-desktop.html', "w").write(typeset(desk_page(d, screen)))
        open(f'{OUT}/{d["key"]}/index.html', "w").write(f'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=home.html"><a href="home.html">{d["name"]}</a>')
    open(f"{OUT}/index.html", "w").write(typeset(index_page()))
    shutil.copy("/tmp/design-lab/proto.css", f"{OUT}/proto.css")
    print("pages:", sum(len(files) for _, _, files in os.walk(OUT)))


build()
