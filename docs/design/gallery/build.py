"""Styld in Gallery, refined: a clickable static prototype of every main screen."""
import html
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = f"{ROOT}/site"
MEN = json.load(open(f"{ROOT}/men.json"))
svg = open("/home/kristjan/code/stylelab/apps/web/public/brand/wordmark.svg").read()
LOGO = (f'<svg class="logo" viewBox="{re.search(r"viewBox=.([^\"]+)", svg).group(1)}" role="img" aria-label="Styld">'
        f'<path fill="currentColor" d="{re.search(r" d=.([^\"]+)", svg).group(1)}"/></svg>')
e = html.escape


def norm(t):
    t = t.replace(" – ", ", ").replace(" - ", ", ").replace("–", ",")
    return t[:1].upper() + t[1:].lower() if t.upper() == t else t


for p in MEN:
    p["title"] = norm(p["title"])


def eur(p):
    return f"{float(p['price']):.2f} €".replace(".", ",")


def m(*idx):
    return [MEN[i] for i in idx]


# Shop pieces for the feed and the shop (menswear, real, from styld.app)
FEED = m(0, 13, 25, 38, 1, 54, 3, 27, 39, 65, 10, 28)
SHOP = m(2, 15, 4, 32, 58, 23, 40, 48, 6, 7, 19, 64)
PIECE = MEN[38]  # the coat the piece page shows
SENS = [p for p in MEN if p["shop"] == "Sens"]

# Your wardrobe: real cutouts from styld.app (assets/w/*.webp)
W = {
    "shirt-denim": ("Denim shirt", "Tops", "Shirts"), "shirt-sky": ("Oxford shirt", "Tops", "Shirts"),
    "shirt-flannel": ("Flannel shirt", "Tops", "Shirts"), "tee-white-folded": ("White tee", "Tops", "T-shirts"),
    "tee-black": ("Black tee", "Tops", "T-shirts"), "tee-grey": ("Graphic tee", "Tops", "T-shirts"),
    "tee-black-adidas": ("Training tee", "Tops", "Sports"), "polo-navy": ("Navy polo", "Tops", "Polos"),
    "henley-charcoal": ("Henley", "Tops", "Long sleeves"), "longsleeve-stripe": ("Breton stripe", "Tops", "Long sleeves"),
    "longsleeve-black": ("Black long sleeve", "Tops", "Long sleeves"), "vneck-navy": ("V-neck tee", "Tops", "T-shirts"),
    "knit-cable-navy": ("Cable knit", "Tops", "Knitwear"), "knit-navy": ("Navy jumper", "Tops", "Knitwear"),
    "crew-grey": ("Grey crewneck", "Tops", "Knitwear"), "turtleneck-black": ("Turtleneck", "Tops", "Knitwear"),
    "hoodie-grey": ("Grey hoodie", "Tops", "Hoodies"), "fleece-cream": ("Fleece jacket", "Outerwear", "Jackets"),
    "jacket-track-black": ("Track jacket", "Outerwear", "Jackets"), "shorts-denim": ("Denim shorts", "Bottoms", "Shorts"),
    "shorts-sky": ("Swim shorts", "Bottoms", "Shorts"), "shorts-navy-adidas": ("Training shorts", "Bottoms", "Sports"),
    "af1-white": ("White trainers", "Shoes", "Trainers"), "converse-high": ("High tops", "Shoes", "Trainers"),
    "converse-low": ("Low tops", "Shoes", "Trainers"), "derby-black": ("Derby shoes", "Shoes", "Formal"),
    "sandals-birkenstock": ("Sandals", "Shoes", "Sandals"), "boots-football": ("Football boots", "Shoes", "Sports"),
}


def wsrc(key, root="../"):
    return f"{root}assets/w/{key}.webp"


I = {
    "home": '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
    "shop": '<path d="M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2"/>',
    "boards": '<rect x="3" y="3" width="8" height="10" rx="1"/><rect x="13" y="3" width="8" height="6" rx="1"/><rect x="13" y="11" width="8" height="10" rx="1"/><rect x="3" y="15" width="8" height="6" rx="1"/>',
    "wardrobe": '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    "save": '<path d="M6 3h12v18l-6-5-6 5z"/>',
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
    "shuffle": '<path d="M3 7h3c4 0 6 10 10 10h5M3 17h3c1.5 0 2.7-1.3 3.7-3M14.3 10c1-1.7 2.2-3 3.7-3h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    "edit": '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
    "grid": '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
}


def icon(name, cls=""):
    return f'<svg class="ic {cls}" viewBox="0 0 24 24" aria-hidden="true">{I[name]}</svg>'


GOOGLE = ('<svg class="ic g" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z"/>'
          '<path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z"/>'
          '<path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9z"/>'
          '<path fill="#EA4335" d="M12 5.9c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.7 9.3 5.9 12 5.9z"/></svg>')

SCREENS = [
    ("Start", [("landing", "Landing"), ("login", "Sign in"), ("onboarding", "Pick what you like")]),
    ("Browse", [("home", "Home"), ("shop", "Shop"), ("filters", "Shop filters"), ("piece", "A shop piece"), ("shop-page", "A shop's page")]),
    ("Wardrobe", [("wardrobe", "Wardrobe"), ("item", "A piece you own"), ("looks", "Looks"), ("add", "Add pieces")]),
    ("Boards", [("boards", "Boards"), ("board", "A board"), ("profile", "A person's profile")]),
    ("You", [("account", "Account")]),
]
NAMES = {k: n for _, items in SCREENS for k, n in items}
DESKTOP = ["home", "shop", "piece", "wardrobe", "item", "looks", "board", "profile"]
TAB = {"home": "home", "shop": "shop", "filters": "shop", "piece": "shop", "shop-page": "shop", "wardrobe": "wardrobe",
       "item": "wardrobe", "looks": "wardrobe", "boards": "boards", "board": "boards", "profile": "boards", "account": "account"}
NO_BAR = {"landing", "login", "onboarding", "add", "piece", "item", "board"}


# ---------------------------------------------------------------- shared pieces

def tabbar(active):
    items = [("home", "Home"), ("shop", "Shop"), ("boards", "Boards"), ("wardrobe", "Wardrobe")]
    out = "".join(f'<a href="{k}.html" class="tab{" on" if k == active else ""}"{" aria-current=page" if k == active else ""}>{icon(k)}<span>{label}</span></a>' for k, label in items)
    return f'<nav class="tabbar" aria-label="App">{out}<a href="account.html" class="tab{" on" if active == "account" else ""}"><span class="av">K</span><span>You</span></a></nav>'


def top(right=None, title=None):
    right = right if right is not None else '<a href="account.html" class="av" aria-label="Your account">K</a>'
    left = f'<a href="home.html" class="logo-link" aria-label="Styld home">{LOGO}</a>' if title is None else title
    return f'<header class="top">{left}{right}</header>'


def bar(back, title="", actions=""):
    return f'<header class="top"><a class="round" href="{back}" aria-label="Back">{icon("back")}</a><span class="bar-t">{title}</span><span class="acts">{actions}</span></header>'


def btn(label, href="#", kind="", ic=None):
    return f'<a class="btn {kind}" href="{href}">{icon(ic) if ic else ""}<span>{label}</span></a>'


def chip(label, on=False, href=None):
    tag = f'a href="{href}"' if href else "button"
    return f'<{tag} class="chip{" on" if on else ""}"{" aria-pressed=true" if on and not href else ""}>{label}</{tag.split()[0]}>'


def tabs(labels, on=0, extra=""):
    links = "".join(f'<a class="tl{" on" if i == on else ""}" href="{href}">{label}</a>' for i, (label, href) in enumerate(labels))
    return f'<div class="tabs">{links}<span class="grow"></span>{extra}</div>'


def card(p, saved=False, href="piece.html"):
    sale = f'<span class="sale">−{round(100 - float(p["price"]) / float(p["compareAt"]) * 100)} %</span>' if p.get("compareAt") and p.get("onSale") else ""
    return (f'<article class="card"><div class="ph"><a href="{href}" class="ph-link"><img src="{e(p["img"])}" alt="{e(p["title"])}" loading="lazy"></a>'
            f'<button class="save{" is-saved" if saved else ""}" aria-label="{"Saved" if saved else "Save"}" aria-pressed="{str(saved).lower()}">{icon("save")}</button>{sale}</div>'
            f'<a href="{href}" class="meta"><span class="t">{e(p["title"])}</span><span class="m"><span>{e(p["shop"])}</span><span class="price">{eur(p)}</span></span></a></article>')


def board_card(name, owner, keys, href="board.html"):
    return (f'<article class="card bcard"><a href="{href}" class="ph-link"><span class="lay mini">{lay(keys)}</span></a>'
            f'<a href="{href}" class="meta"><span class="t">{name}</span><span class="m"><span>{owner}</span><span>Board</span></span></a></article>')


def piece(key, href="item.html", cap=True, root="../"):
    name = W[key][0]
    caption = f'<span class="cap">{name}</span>' if cap else ""
    return f'<a class="cut" href="{href}"><img src="{wsrc(key, root)}" alt="{name}" loading="lazy">{caption}</a>'


def lay(keys, cls=""):
    """A flat-lay: your pieces laid out on paper, never overlapping."""
    imgs = "".join(f'<img class="s{i}" src="{wsrc(k)}" alt="{W[k][0]}">' for i, k in enumerate(keys))
    return f'<span class="flat n{len(keys)} {cls}">{imgs}</span>'


def spectrum(active=None):
    cols = ["white", "beige", "brown", "pink", "red", "purple", "navy", "blue", "green", "grey", "black"]
    return '<div class="spec">' + "".join(f'<a class="sw{" on" if c == active else ""}" href="shop.html" style="--sw:var(--c-{c})" aria-label="{c.title()}"></a>' for c in cols) + "</div>"


# ---------------------------------------------------------------- phone screens

def s_landing():
    return f'''{top('<a class="txt" href="login.html">Sign in</a>')}
<section class="hero"><h1 class="display">Your wardrobe, laid out.</h1>
<p class="lede">Save pieces from 23 Slovenian shops, keep your own clothes in one place, and get dressed from them.</p>
<div class="row-acts">{btn("Start free", "onboarding.html")}{btn("Browse the shops", "shop.html", "ghost")}</div></section>
<a class="hero-lay" href="looks.html" aria-label="An example look">{lay(["shirt-denim", "shorts-denim", "converse-low", "knit-navy"], "big")}</a>
<p class="note">Works in ChatGPT and Claude too.</p>'''


def s_login():
    return f'''{bar("landing.html")}
<section class="form"><h1 class="h1">Sign in</h1><p class="lede">We'll email you a six-digit code. New here? The same code creates your account.</p>
<label class="field"><span>Email</span><input type="email" autocomplete="email" placeholder="ana@example.com"></label>
{btn("Send code", "onboarding.html", "block")}<div class="or"><span>or</span></div>
<a class="btn ghost block" href="onboarding.html">{GOOGLE}<span>Continue with Google</span></a>
<p class="fine">By continuing you agree to the <a class="txt" href="#">terms</a> and <a class="txt" href="#">privacy policy</a>.</p></section>'''


def s_onboarding():
    a, b = MEN[38], MEN[1]
    return f'''<header class="top"><a class="txt muted" href="home.html">Skip</a><span class="step">4 of 10</span></header>
<div class="progress" role="progressbar" aria-valuenow="4" aria-valuemin="0" aria-valuemax="10"><span style="width:40%"></span></div>
<h1 class="h1 center">Would you wear it?</h1><p class="lede center">Swipe right to save, left to pass.</p>
<div class="deck"><div class="dk back"><img src="{e(b["img"])}" alt=""></div><a href="piece.html" class="dk front"><img src="{e(a["img"])}" alt="{e(a["title"])}">
<span class="dk-meta"><span class="t">{e(a["title"])}</span><span class="m">{e(a["shop"])}, {eur(a)}</span></span></a></div>
<div class="dk-acts"><a class="round big" href="home.html" aria-label="Pass">{icon("x")}</a><a class="round big dark" href="home.html" aria-label="Save">{icon("save")}</a></div>'''


def s_home():
    feed = (card(FEED[0]) + card(FEED[1], True) + board_card("Autumn layers", "@styld", ["knit-cable-navy", "shirt-sky", "derby-black", "crew-grey"])
            + card(FEED[2]) + card(FEED[3]) + card(FEED[4]) + card(FEED[5]) + board_card("Piran weekend", "Luka Novak", ["tee-white-folded", "shorts-sky", "sandals-birkenstock", "longsleeve-stripe"]) + card(FEED[6]) + card(FEED[7]))
    return f'''{top()}
<section class="today"><div class="today-h"><h2 class="h3">Today's look</h2><span class="small muted">{icon("sun", "inl")}14°, dry in Ljubljana</span></div>
<a href="looks.html" class="today-lay" aria-label="Today's look">{lay(["shirt-denim", "knit-navy", "shorts-denim", "converse-low"])}</a>
<div class="row-acts">{btn("Wear this", "#", "sm")}{btn("Spin again", "#", "sm ghost", "shuffle")}</div></section>
<div class="sec"><h1 class="h1">Inspiration</h1>{tabs([("For you", "home.html"), ("Following", "home.html")], 0, chip("Men", True))}</div>
<div class="grid">{feed}</div>'''


def s_shop():
    return f'''{top()}<h1 class="h1">Shop</h1>
<label class="search">{icon("search")}<input type="search" placeholder="Search pieces, try “linen shirt”"></label>
{spectrum()}
<div class="tools"><a class="tool" href="filters.html">{icon("filter")}<span>Filters</span></a>{chip("Men", True)}{chip("On sale")}<span class="grow"></span><a class="sort" href="#">Newest</a></div>
<p class="count"><span class="num">557</span> pieces for men from 23 shops</p>
<div class="grid">{"".join(card(p) for p in SHOP[:8])}</div>'''


def s_filters():
    shops = ["Sens", "Extraordinary", "Utopiast", "Stajling", "Avocado"]
    return f'''{top()}<h1 class="h1">Shop</h1><div class="grid">{"".join(card(p) for p in SHOP[:4])}</div>
<a class="scrim" href="shop.html" aria-label="Close filters"></a>
<section class="sheet" role="dialog" aria-label="Filters"><span class="grab"></span>
<div class="sheet-h"><h2 class="h2">Filters</h2><a class="txt" href="#">Clear all</a></div>
<h3 class="label">Category</h3><div class="chips wrap">{"".join(chip(c, c == "Knitwear") for c in ["All", "Knitwear", "Shirts", "Coats", "Trousers", "Jeans", "Shoes", "Bags"])}</div>
<h3 class="label">Colour</h3>{spectrum("navy")}
<h3 class="label">Price</h3><div class="range"><span class="num">0 €</span><span class="track"><span></span></span><span class="num">120 €</span></div>
<h3 class="label">Shops</h3><div class="chips wrap">{"".join(chip(s, s == "Sens") for s in shops)}</div>
{btn("Show 48 pieces", "shop.html", "block")}</section>'''


def goes_with():
    return '<div class="goes">' + "".join(piece(k) for k in ["shirt-sky", "knit-cable-navy", "derby-black"]) + "</div>"


def s_piece():
    p = PIECE
    more = "".join(card(x) for x in SENS[30:32])
    return f'''<div class="pd-photo"><img src="{e(p["img"])}" alt="{e(p["title"])}"><div class="pd-bar"><a class="round light" href="shop.html" aria-label="Back">{icon("back")}</a><span class="grow"></span><a class="round light" href="#" aria-label="Share">{icon("share")}</a></div><div class="dots" aria-hidden="true"><span class="on"></span><span></span><span></span></div></div>
<section class="pd"><a class="shoplink" href="shop-page.html">{e(p["shop"])}</a><h1 class="h1 tight">{e(p["title"])}</h1><p class="price-lg num">{eur(p)}</p>
<div class="row-acts fill">{btn("Save", "#", "", "save")}{btn("I own this", "wardrobe.html", "ghost")}</div>
<h2 class="h3">Goes with what you own</h2>{goes_with()}
<a class="row" href="#">{icon("wardrobe")}<span>Try it on you</span><span class="grow"></span><span class="muted small">Members</span>{icon("chev")}</a>
<a class="row" href="shop-page.html">{icon("out")}<span>Buy at {e(p["shop"])}</span><span class="grow"></span>{icon("chev")}</a>
<h2 class="h3">More from {e(p["shop"])}</h2><div class="grid flush">{more}</div></section>'''


def s_shop_page():
    return f'''{bar("shop.html", "", '<a class="round" href="#" aria-label="More">' + icon("dots") + "</a>")}
<section class="ph-head"><span class="avatar-lg">S</span><div><h1 class="h1 tight">Sens</h1><p class="muted small">{icon("pin", "inl")}Ljubljana, menswear since 1991</p></div></section>
<p class="bio">Suits, shirts and knitwear for men, from Slovenian and Italian makers.</p>
<div class="row-acts pad">{btn("Follow")}{btn("Visit shop", "#", "ghost", "out")}</div>
{tabs([("Pieces", "#"), ("Boards", "#")], 0, '<a class="sort" href="#">Newest</a>')}
<div class="grid">{"".join(card(p) for p in SENS[:6])}</div>'''


WARD = ["shirt-denim", "knit-cable-navy", "tee-white-folded", "polo-navy", "shirt-flannel", "hoodie-grey", "fleece-cream", "shorts-denim",
        "longsleeve-stripe", "converse-high", "turtleneck-black", "af1-white", "crew-grey", "sandals-birkenstock"]


def s_wardrobe():
    add = f'<a class="round dark" href="add.html" aria-label="Add pieces">{icon("plus")}</a>'
    cats = "".join(f'<a class="{"on" if c == "All" else ""}" href="#">{c} <span class="num">{n}</span></a>' for c, n in [("All", 28), ("Tops", 17), ("Bottoms", 3), ("Outerwear", 2), ("Shoes", 6)])
    return f'''{top(add)}<h1 class="h1">Wardrobe</h1>
{tabs([("Pieces", "wardrobe.html"), ("Looks", "looks.html"), ("Wishlist", "#")], 0, '<a class="round ghost" href="#" aria-label="Edit categories">' + icon("edit") + "</a>")}
<div class="cats">{cats}</div>
<div class="cuts">{"".join(piece(k) for k in WARD)}</div>'''


def s_item():
    k = "knit-cable-navy"
    looks = "".join(f'<a class="look" href="looks.html">{lay(keys, "mini")}</a>' for keys in [["knit-cable-navy", "shirt-sky", "shorts-denim", "derby-black"], ["knit-cable-navy", "tee-white-folded", "shorts-sky", "converse-high"]])
    return f'''{bar("wardrobe.html", "", '<a class="round" href="#" aria-label="Edit">' + icon("edit") + '</a><a class="round" href="#" aria-label="More">' + icon("dots") + "</a>")}
<div class="it-photo"><img src="{wsrc(k)}" alt="Cable knit"></div>
<section class="pd"><h1 class="h1 tight">Cable knit</h1><p class="muted">Tops, knitwear</p>
<div class="swatches"><span style="--sw:var(--c-navy)" aria-label="Navy"></span></div>
<div class="row-acts fill">{btn("Make a look", "looks.html")}{btn("Add to a board", "boards.html", "ghost")}</div>
<h2 class="h3">In your looks</h2><div class="looks-row">{looks}</div>
<dl class="facts"><div><dt>Season</dt><dd>Autumn, winter</dd></div><div><dt>Worn</dt><dd>4 times, last on Sunday</dd></div><div><dt>Notes</dt><dd>Hand wash, dry flat.</dd></div></dl></section>'''


LOOKS = [("Sunday market", ["knit-cable-navy", "shirt-sky", "shorts-denim", "derby-black"]),
         ("Office, but soft", ["turtleneck-black", "crew-grey", "derby-black", "af1-white"]),
         ("Coast", ["tee-white-folded", "shorts-sky", "sandals-birkenstock", "longsleeve-stripe"]),
         ("Five-a-side", ["tee-black-adidas", "shorts-navy-adidas", "boots-football", "jacket-track-black"])]


def s_looks():
    tiles = "".join(f'<a class="look" href="item.html">{lay(keys, "mini")}<span class="cap">{n}</span></a>' for n, keys in LOOKS)
    return f'''{top(f'<a class="round dark" href="#" aria-label="New look">{icon("plus")}</a>')}<h1 class="h1">Wardrobe</h1>
{tabs([("Pieces", "wardrobe.html"), ("Looks", "looks.html"), ("Wishlist", "#")], 1)}
<div class="looks">{tiles}</div>'''


def s_add():
    found = ["fleece-cream", "polo-navy", "converse-low", "henley-charcoal"]
    tiles = "".join(f'<figure class="found"><img src="{wsrc(k)}" alt="{W[k][0]}"><button class="tick" aria-label="Keep {W[k][0]}" aria-pressed="true">{icon("check")}</button><figcaption>{W[k][0]}<span>{W[k][1]}, {W[k][2].lower()}</span></figcaption></figure>' for k in found)
    return f'''{bar("wardrobe.html", "Scan")}
<h1 class="h1">4 pieces found</h1><p class="lede">They're cut out and ready. Untick anything that isn't yours.</p>
<div class="cuts found-grid">{tiles}</div>
<div class="list pad">
<a class="row" href="#">{icon("camera")}<span>Scan more photos</span><span class="grow"></span>{icon("chev")}</a>
<a class="row" href="#">{icon("tag")}<span>Add a piece by hand</span><span class="grow"></span>{icon("chev")}</a></div>
<div class="footer-cta">{btn("Add 4 to my wardrobe", "wardrobe.html", "block")}</div>'''


def s_boards():
    boards = [("Autumn layers", ["knit-cable-navy", "shirt-sky", "derby-black", "crew-grey"], "12 pins", "Public"),
              ("Coats to try", None, "8 pins", "Private"),
              ("Piran weekend", ["tee-white-folded", "shorts-sky", "sandals-birkenstock", "longsleeve-stripe"], "9 pins", "Public"),
              ("First picks", None, "10 pins", "Private")]
    tiles = []
    for i, (n, keys, c, v) in enumerate(boards):
        cover = f'<span class="lay mini">{lay(keys)}</span>' if keys else f'<span class="bcover"><img src="{e(MEN[38 + i]["img"])}" alt=""><img src="{e(MEN[40 + i]["img"])}" alt=""><img src="{e(MEN[48 + i]["img"])}" alt=""></span>'
        tiles.append(f'<a class="board" href="board.html">{cover}<span class="t">{n}</span><span class="m"><span>{c}</span><span>{v}</span></span></a>')
    return f'''{top()}<div class="sec-row"><h1 class="h1">Boards</h1>{btn("New board", "#", "sm", "plus")}</div>
{tabs([("Boards", "boards.html"), ("Saved", "#")])}<div class="boards">{"".join(tiles)}</div>'''


def s_board():
    pins = [MEN[38], MEN[0], MEN[54], MEN[25], MEN[39], MEN[61]]
    pin_html = "".join(f'<a class="pin p{i % 3}" href="piece.html"><img src="{e(x["img"])}" alt="{e(x["title"])}"></a>' for i, x in enumerate(pins))
    return f'''{bar("boards.html", "", '<a class="round" href="#" aria-label="Share">' + icon("share") + '</a><a class="round" href="#" aria-label="More">' + icon("dots") + "</a>")}
<section class="bd-head"><h1 class="h1 tight">Autumn layers</h1><p class="muted small">12 pins, public on your <a class="txt" href="profile.html">profile</a></p></section>
<div class="collage">{lay(["knit-cable-navy", "shirt-sky", "derby-black", "crew-grey"], "big")}<span class="ctag">Collage</span></div>
<div class="pins">{pin_html}</div>'''


def s_profile():
    tiles = "".join(f'<a class="board" href="board.html"><span class="lay mini">{lay(keys)}</span><span class="t">{n}</span></a>' for n, keys in LOOKS[:4])
    return f'''{bar("boards.html", "", '<a class="round" href="#" aria-label="More">' + icon("dots") + "</a>")}
<section class="ph-head"><span class="avatar-lg">LN</span><div><h1 class="h1 tight">Luka Novak</h1><p class="muted small">@luka.novak, Ljubljana</p></div></section>
<p class="bio">Navy, denim and white. Football on Thursdays.</p><div class="row-acts pad">{btn("Follow")}</div>
{tabs([("Boards", "#"), ("Looks", "#")])}<div class="boards">{tiles}</div>'''


def s_account():
    def row(ic, label, href="#", val=""):
        v = f'<span class="muted small">{val}</span>' if val else ""
        return f'<a class="row" href="{href}">{icon(ic) if ic else ""}<span>{label}</span><span class="grow"></span>{v}{icon("chev")}</a>'
    return f'''{top("<span></span>", '<span class="bar-t big">You</span>')}
<section class="me"><span class="av lg">K</span><div><p class="t">Kristjan</p><p class="muted small">kristjan@example.com</p></div></section>
<section class="member"><div><p class="t">Member</p><p class="m"><span class="num">957</span> credits, renews 12 November</p></div><a class="txt" href="#">Manage</a></section>
<div class="list pad">{row("chat", "Use Styld in ChatGPT or Claude")}{row("pin", "Public profile", "profile.html", "@kristjan")}{row("shop", "Shops you follow", "shop-page.html", "6")}{row("wardrobe", "Style profile")}{row("tag", "Activity")}{row("", "Language", "#", "Slovenščina")}
<a class="row" href="landing.html"><span>Sign out</span></a></div>'''


PHONE = {"landing": s_landing, "login": s_login, "onboarding": s_onboarding, "home": s_home, "shop": s_shop, "filters": s_filters,
         "piece": s_piece, "shop-page": s_shop_page, "wardrobe": s_wardrobe, "item": s_item, "looks": s_looks, "add": s_add,
         "boards": s_boards, "board": s_board, "profile": s_profile, "account": s_account}


# ---------------------------------------------------------------- desktop screens

def dtop(active):
    nav = "".join(f'<a href="{k}-desktop.html" class="{"on" if k == active else ""}">{n}</a>' if k in DESKTOP else f'<a href="{k}.html" class="{"on" if k == active else ""}">{n}</a>'
                  for k, n in [("home", "Home"), ("shop", "Shop"), ("boards", "Boards"), ("wardrobe", "Wardrobe")])
    return (f'<header class="dtop"><a href="home-desktop.html" class="logo-link" aria-label="Styld home">{LOGO}</a><nav class="dnav" aria-label="App">{nav}</nav><span class="grow"></span>'
            f'<label class="search small">{icon("search")}<input type="search" placeholder="Search Styld"></label><a href="account.html" class="av" aria-label="Your account">K</a></header>')


def dhref(html_):
    return html_.replace('href="piece.html"', 'href="piece-desktop.html"').replace('href="item.html"', 'href="item-desktop.html"').replace('href="board.html"', 'href="board-desktop.html"').replace('href="looks.html"', 'href="looks-desktop.html"')


def d_home():
    feed = (card(FEED[0]) + card(FEED[1], True) + board_card("Autumn layers", "@styld", ["knit-cable-navy", "shirt-sky", "derby-black", "crew-grey"]) + card(FEED[2]) + card(FEED[3])
            + card(FEED[4]) + card(FEED[5]) + card(FEED[6]) + board_card("Piran weekend", "Luka Novak", ["tee-white-folded", "shorts-sky", "sandals-birkenstock", "longsleeve-stripe"]) + card(FEED[7]))
    return dtop("home") + dhref(f'''<div class="dbody"><section class="dtoday"><div class="dtoday-t"><h2 class="h2">Today's look</h2><p class="muted">{icon("sun", "inl")}14°, dry in Ljubljana. Layers for a cool morning.</p>
<div class="row-acts">{btn("Wear this")}{btn("Spin again", "#", "ghost", "shuffle")}</div></div><a href="looks.html" class="today-lay">{lay(["shirt-denim", "knit-navy", "shorts-denim", "converse-low"])}</a></section>
<div class="drow"><h1 class="h1">Inspiration</h1>{tabs([("For you", "#"), ("Following", "#")])}<span class="grow"></span>{chip("Men", True)}{chip("All")}</div><div class="grid g5">{feed}</div></div>''')


def d_shop():
    side = "".join(f'<a href="#" class="{"on" if i == 0 else ""}">{c}</a>' for i, c in enumerate(["All pieces", "Knitwear", "Shirts", "Coats", "Suits", "Trousers", "Jeans", "Shoes", "Bags", "Accessories"]))
    shops = "".join(f'<a href="#">{s}</a>' for s in ["Sens", "Extraordinary", "Utopiast"])
    return dtop("shop") + dhref(f'''<div class="dshop"><aside class="side"><h1 class="h1">Shop</h1><nav class="sidenav" aria-label="Categories">{side}</nav>
<h3 class="label">Colour</h3>{spectrum()}<h3 class="label">Price</h3><div class="range"><span class="num">0 €</span><span class="track"><span></span></span><span class="num">250 €</span></div><h3 class="label">Shops</h3><nav class="sidenav">{shops}</nav></aside>
<div><div class="drow first"><p class="count"><span class="num">557</span> pieces for men from 23 shops</p><span class="grow"></span>{chip("Men", True)}{chip("On sale")}<a class="sort" href="#">Newest</a></div><div class="grid g4">{"".join(card(p) for p in SHOP)}</div></div></div>''')


def d_piece():
    p = PIECE
    more = "".join(card(x) for x in SENS[28:33])
    return dtop("shop") + dhref(f'''<div class="dpiece"><div class="dp-photos"><img src="{e(p["img"])}" alt="{e(p["title"])}"><img src="{e(MEN[39]["img"])}" alt=""></div>
<section class="pd"><a class="shoplink" href="shop-page.html">{e(p["shop"])}</a><h1 class="h1 tight xl">{e(p["title"])}</h1><p class="price-lg num">{eur(p)}</p>
<div class="row-acts fill">{btn("Save", "#", "", "save")}{btn("I own this", "wardrobe-desktop.html", "ghost")}</div>
<h2 class="h3">Goes with what you own</h2>{goes_with()}
<a class="row" href="#">{icon("wardrobe")}<span>Try it on you</span><span class="grow"></span><span class="muted small">Members</span>{icon("chev")}</a>
<a class="row" href="shop-page.html">{icon("out")}<span>Buy at {e(p["shop"])}</span><span class="grow"></span>{icon("chev")}</a>
<p class="desc">A wool-blend overcoat with a notched collar, cut to sit above the knee. Sizes 46 to 56 at the shop.</p></section></div>
<div class="dbody"><h2 class="h2 sp">More from {e(p["shop"])}</h2><div class="grid g5">{more}</div></div>''')


def d_wardrobe():
    keys = list(W)[:24]
    cats = "".join(f'<a class="{"on" if c == "All" else ""}" href="#">{c} <span class="num">{n}</span></a>' for c, n in [("All", 28), ("Tops", 17), ("Bottoms", 3), ("Outerwear", 2), ("Shoes", 6)])
    return dtop("wardrobe") + dhref(f'''<div class="dbody"><div class="drow"><h1 class="h1">Wardrobe</h1>{tabs([("Pieces", "wardrobe-desktop.html"), ("Looks", "looks-desktop.html"), ("Wishlist", "#")])}<span class="grow"></span>{btn("Edit categories", "#", "ghost sm", "edit")}{btn("Add pieces", "add.html", "sm", "plus")}</div>
<div class="cats">{cats}</div><div class="cuts c6">{"".join(piece(k) for k in keys)}</div></div>''')


def d_item():
    k = "knit-cable-navy"
    looks = "".join(f'<a class="look" href="looks.html">{lay(keys, "mini")}<span class="cap">{n}</span></a>' for n, keys in [LOOKS[0], ("Weekend", ["knit-cable-navy", "tee-white-folded", "shorts-sky", "converse-high"])])
    return dtop("wardrobe") + dhref(f'''<div class="ditem"><div class="it-photo"><img src="{wsrc(k)}" alt="Cable knit"></div>
<section class="pd"><a class="txt small" href="wardrobe-desktop.html">Wardrobe</a><h1 class="h1 tight xl">Cable knit</h1><p class="muted">Tops, knitwear</p>
<div class="swatches"><span style="--sw:var(--c-navy)" aria-label="Navy"></span></div>
<div class="row-acts">{btn("Make a look", "looks.html")}{btn("Add to a board", "board.html", "ghost")}{btn("Edit", "#", "ghost", "edit")}</div>
<dl class="facts"><div><dt>Season</dt><dd>Autumn, winter</dd></div><div><dt>Worn</dt><dd>4 times, last on Sunday</dd></div><div><dt>Notes</dt><dd>Hand wash, dry flat.</dd></div></dl>
<h2 class="h3">In your looks</h2><div class="looks-row">{looks}</div></section></div>''')


def d_looks():
    tiles = "".join(f'<a class="look" href="item.html">{lay(keys, "mini")}<span class="cap">{n}</span></a>' for n, keys in LOOKS + [("Weekend", ["knit-cable-navy", "tee-white-folded", "shorts-sky", "converse-high"]), ("Rain", ["fleece-cream", "hoodie-grey", "shorts-denim", "converse-high"])])
    return dtop("wardrobe") + dhref(f'''<div class="dbody"><div class="drow"><h1 class="h1">Wardrobe</h1>{tabs([("Pieces", "wardrobe-desktop.html"), ("Looks", "looks-desktop.html"), ("Wishlist", "#")], 1)}<span class="grow"></span>{btn("New look", "#", "sm", "plus")}</div>
<div class="looks c3">{tiles}</div></div>''')


def d_board():
    pins = [MEN[38], MEN[0], MEN[54], MEN[25], MEN[39], MEN[61], MEN[3], MEN[65], MEN[13]]
    pin_html = "".join(f'<a class="pin p{i % 3}" href="piece.html"><img src="{e(x["img"])}" alt="{e(x["title"])}"></a>' for i, x in enumerate(pins))
    return dtop("boards") + dhref(f'''<div class="dboard"><section class="bd-side"><a class="txt small" href="boards.html">Boards</a><h1 class="h1 tight xl">Autumn layers</h1><p class="muted">12 pins, public on your <a class="txt" href="profile-desktop.html">profile</a></p>
<div class="row-acts">{btn("Add pins", "#", "", "plus")}{btn("Share", "#", "ghost", "share")}</div>
<div class="collage">{lay(["knit-cable-navy", "shirt-sky", "derby-black", "crew-grey"], "big")}<span class="ctag">Collage</span></div></section><div class="pins d">{pin_html}</div></div>''')


def d_profile():
    tiles = "".join(f'<a class="board" href="board.html"><span class="lay mini">{lay(keys)}</span><span class="t">{n}</span></a>' for n, keys in LOOKS)
    return dtop("boards") + dhref(f'''<div class="dbody"><section class="ph-head wide"><span class="avatar-lg">LN</span><div><h1 class="h1 tight xl">Luka Novak</h1><p class="muted">@luka.novak, Ljubljana</p><p class="bio">Navy, denim and white. Football on Thursdays.</p></div><span class="grow"></span>{btn("Follow")}</section>
{tabs([("Boards", "#"), ("Looks", "#")])}<div class="boards c4">{tiles}</div></div>''')


DESK = {"home": d_home, "shop": d_shop, "piece": d_piece, "wardrobe": d_wardrobe, "item": d_item, "looks": d_looks, "board": d_board, "profile": d_profile}


# ---------------------------------------------------------------- pages

HEAD = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{title}</title><meta name="description" content="A clickable prototype of Styld in the Gallery direction.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{root}gallery.css"></head>'''
OPEN = '<script>if (matchMedia("(min-width: 900px)").matches) document.querySelector(".screens")?.setAttribute("open", "");</script>'
FIT = '''<script>
// Fit the 1440px desktop frame to the space; without scripting it scrolls sideways instead.
(() => { const s = document.querySelector(".desk-stage"), f = s && s.querySelector(".frame.desk"); if (!f) return;
  const fit = () => { const k = Math.min(1, s.clientWidth / 1440); f.style.transform = `scale(${k})`; s.style.height = `${900 * k}px`; };
  fit(); addEventListener("resize", fit); })();
</script>'''


def side(screen, desk):
    groups = "".join(f'<p class="sg">{g}</p>' + "".join(f'<a href="{k}.html" class="{"on" if k == screen and not desk else ""}">{n}</a>' for k, n in items) for g, items in SCREENS)
    dl = "".join(f'<a href="{k}-desktop.html" class="{"on" if k == screen and desk else ""}">{NAMES[k]}</a>' for k in DESKTOP)
    view = (f'<div class="view"><a href="{screen}.html" class="{"" if desk else "on"}">Phone</a><a href="{screen}-desktop.html" class="{"on" if desk else ""}">Desktop</a></div>'
            if screen in DESKTOP else "")
    return f'''<aside class="side-nav"><a class="back-all" href="../index.html">All screens</a><h1 class="dir-name">{NAMES[screen]}</h1>{view}
<details class="screens"><summary>Screens</summary><nav aria-label="Screens">{groups}<p class="sg">Desktop</p>{dl}</nav></details></aside>'''


def typeset(page):
    parts = re.split(r"(<[^>]+>)", page)
    for i, part in enumerate(parts):
        if part and not part.startswith("<"):
            parts[i] = re.sub(r"(?<=[A-Za-zčšž])'(?=[A-Za-z])", "’", part)
    return "".join(parts)


def phone_page(screen):
    b = "" if screen in NO_BAR else tabbar(TAB.get(screen))
    return typeset(HEAD.format(title=f"{NAMES[screen]}, Styld", root="../") + f'<body class="proto">{side(screen, False)}'
                   f'<main class="stage"><div class="frame phone{" has-bar" if b else ""}"><div class="screen s-{screen}">{PHONE[screen]()}</div>{b}</div></main>{OPEN}</body></html>')


def desk_page(screen):
    return typeset(HEAD.format(title=f"{NAMES[screen]} on desktop, Styld", root="../") + f'<body class="proto is-desk">{side(screen, True)}'
                   f'<main class="stage desk-stage"><div class="frame desk"><div class="dscreen">{DESK[screen]()}</div></div></main>{OPEN}{FIT}</body></html>')


def index_page():
    groups = []
    for g, items in SCREENS:
        cards = "".join(f'<a class="sc" href="s/{k}.html"><img src="thumbs/{k}.jpg" alt="" width="370" height="600" loading="lazy"><span>{n}</span></a>' for k, n in items)
        groups.append(f'<section class="sgroup"><h2>{g}</h2><div class="sgrid">{cards}</div></section>')
    desks = "".join(f'<a class="sc wide" href="s/{k}-desktop.html"><img src="thumbs/{k}-desktop.jpg" alt="" width="720" height="450" loading="lazy"><span>{NAMES[k]}</span></a>' for k in DESKTOP)
    return typeset(HEAD.format(title="Styld in Gallery", root="") + f'''<body class="index"><header class="ix-top">{LOGO}<div><h1>Styld in Gallery</h1>
<p>Every main screen of the app in the Gallery direction, as a clickable prototype. Things you could buy are photos from Slovenian shops; things you own are cutouts on paper, taken from a real Styld wardrobe. Tap any screen and walk on from there.</p>
<p class="small-note">People, boards, looks and counts on personal screens are examples. <a href="archive/index.html">Earlier directions</a></p></div></header>
<main class="ix-main">{"".join(groups)}<section class="sgroup"><h2>Desktop</h2><div class="sgrid wide">{desks}</div></section></main></body></html>''')


def build():
    thumbs = f"{OUT}/thumbs"
    keep = {f: open(f"{thumbs}/{f}", "rb").read() for f in os.listdir(thumbs)} if os.path.isdir(thumbs) else {}
    archive = f"{OUT}/archive"
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(f"{OUT}/s")
    os.makedirs(thumbs)
    for f, data in keep.items():
        open(f"{thumbs}/{f}", "wb").write(data)
    shutil.copytree("/tmp/design-proto", archive, ignore=shutil.ignore_patterns(".wrangler"))
    shutil.copytree(f"{ROOT}/assets", f"{OUT}/assets")
    for k in PHONE:
        open(f"{OUT}/s/{k}.html", "w").write(phone_page(k))
    for k in DESK:
        open(f"{OUT}/s/{k}-desktop.html", "w").write(desk_page(k))
    open(f"{OUT}/index.html", "w").write(index_page())
    shutil.copy(f"{ROOT}/gallery.css", f"{OUT}/gallery.css")
    print("files:", sum(len(f) for _, _, f in os.walk(OUT)))


build()
