import html
import json
import re

P = json.load(open("/tmp/design-lab/pieces.json"))
C = json.load(open("/tmp/design-lab/colors.json"))
K = json.load(open("/tmp/design-lab/cats.json"))
svg = open("/home/kristjan/code/stylelab/apps/web/public/brand/wordmark.svg").read()
VB = re.search(r'viewBox="([^"]+)"', svg).group(1)
D = re.search(r' d="([^"]+)"', svg).group(1)
LOGO = f'<svg class="logo" viewBox="{VB}" aria-label="Styld"><path fill="currentColor" d="{D}"/></svg>'
HEX = {"white": "#FFFFFF", "beige": "#D8C3A5", "brown": "#7B4B2A", "pink": "#E8A0B4", "red": "#C0392B", "purple": "#7D4CA6",
       "navy": "#1F2A44", "blue": "#3B6FD8", "green": "#3C7A4A", "grey": "#8A8A8A", "black": "#111111"}
ORDER = list(HEX)
e = html.escape


def cat(c, n=5):
    return [p for p in K if p["cat"] == c][:n]


def eur(p):
    return f"{float(p['price']):.2f} €".replace(".", ",")


I = {
    "home": '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
    "shop": '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2"/></svg>',
    "boards": '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="10"/><rect x="13" y="3" width="8" height="6"/><rect x="13" y="11" width="8" height="10"/><rect x="3" y="15" width="8" height="6"/></svg>',
    "wardrobe": '<svg viewBox="0 0 24 24"><path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/></svg>',
    "save": '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-5-6 5z"/></svg>',
    "saved": '<svg viewBox="0 0 24 24" class="filled"><path d="M6 3h12v18l-6-5-6 5z"/></svg>',
    "x": '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    "search": '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    "filter": '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    "back": '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    "share": '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/></svg>',
    "plus": '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    "camera": '<svg viewBox="0 0 24 24"><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></svg>',
    "tag": '<svg viewBox="0 0 24 24"><path d="M3 12V3h9l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/></svg>',
    "shirt": '<svg viewBox="0 0 24 24"><path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/></svg>',
    "pin": '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    "out": '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
    "chev": '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    "dots": '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
    "check": '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
    "chat": '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    "google": '<svg viewBox="0 0 24 24" class="g"><path fill="#4285F4" stroke="none" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z"/><path fill="#34A853" stroke="none" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z"/><path fill="#FBBC05" stroke="none" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9z"/><path fill="#EA4335" stroke="none" d="M12 5.9c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.7 9.3 5.9 12 5.9z"/></svg>',
}


def tabbar(active):
    items = [("home", "Home"), ("shop", "Shop"), ("boards", "Boards"), ("wardrobe", "Wardrobe")]
    links = "".join(f'<a class="{"on" if k == active else ""}">{I[k]}<span>{label}</span></a>' for k, label in items)
    return f'<nav class="tabbar">{links}<a class="{"on" if active == "you" else ""}"><span class="av">K</span><span>You</span></a></nav>'


def top(right='<span class="av">K</span>'):
    return f'<header class="top">{LOGO}{right}</header>'


def phone(label, inner, active=None, cls=""):
    bar = tabbar(active) if active else ""
    return f'<figure class="shot"><div class="frame phone {cls}"><div class="screen">{inner}</div>{bar}</div><figcaption>{label}</figcaption></figure>'


def card(p, saved=False):
    sale = '<span class="sale">Sale</span>' if p.get("onSale") else ""
    return (f'<article class="card"><div class="ph"><img src="{e(p["img"])}" alt="">'
            f'<button class="save">{I["saved" if saved else "save"]}</button>{sale}</div>'
            f'<div class="meta"><p class="t">{e(p["title"])}</p><p class="m"><span class="shop">{e(p["shop"])}</span>'
            f'<span class="price">{eur(p)}</span></p></div></article>')


def grid(items, saved_idx=()):
    return '<div class="grid">' + "".join(card(p, i in saved_idx) for i, p in enumerate(items)) + "</div>"


def spectrum(active=None):
    return '<div class="spec">' + "".join(
        f'<a class="{"on" if c == active else ""}" style="--sw:{HEX[c]}"></a>' for c in ORDER) + "</div>"


def chips(labels, on=0, cls="chips"):
    return f'<div class="{cls}">' + "".join(
        f'<span class="chip{" on" if i == on else ""}">{label}</span>' for i, label in enumerate(labels)) + "</div>"


# ---------------- Phone screens ----------------

def s_landing():
    peek = "".join(f'<img src="{e(p["img"])}" alt="">' for p in [P[1], P[13], P[21], P[5]])
    return phone("Landing, signed out", f'''{top('<a class="txt">Sign in</a>')}
<section class="hero"><h1 class="display">A wardrobe shaped by you.</h1><p class="lede">Save what you love from 23 Slovenian shops, build boards, and dress from your own closet.</p>
<div class="acts"><button class="btn">Start free</button><button class="btn ghost">Browse the shops</button></div></section>
<div class="peek">{peek}</div>
<p class="note">Also in ChatGPT and Claude.</p>''')


def s_login():
    return phone("Sign in", f'''{top('<span></span>')}
<section class="form"><h1 class="h1">Sign in</h1><p class="lede">We'll email you a six-digit code. New here? The same code creates your account.</p>
<label class="field"><span>Email</span><span class="input">ana@example.com</span></label>
<button class="btn block">Send code</button>
<div class="or"><span>or</span></div>
<button class="btn ghost block">{I["google"]}Continue with Google</button></section>''')


def s_onboarding():
    a, b = P[13], P[21]
    return phone("Onboarding: pick what you love", f'''<header class="top"><a class="txt muted">Skip</a><span class="step">4 of 10</span></header>
<div class="progress"><span style="width:40%"></span></div>
<h1 class="h1 center">Would you wear it?</h1><p class="lede center">Swipe right to save, left to pass. We'll fill your feed from your picks.</p>
<div class="deck"><div class="dk back"><img src="{e(b["img"])}" alt=""></div><div class="dk front"><img src="{e(a["img"])}" alt=""><div class="dk-meta"><p class="t">{e(a["title"])}</p><p class="m">{e(a["shop"])}, {eur(a)}</p></div></div></div>
<div class="dk-acts"><button class="round">{I["x"]}</button><button class="round dark">{I["save"]}</button></div>''')


def s_home():
    pick = cat("trousers")[1]
    return phone("Home", f'''{top()}
<section class="today"><p class="small muted">Today from your wardrobe</p><div class="pick"><img src="{e(pick["img"])}" alt=""><div><p class="t">{e(pick["title"])}</p><p class="m">Make an outfit around it</p></div><button class="btn sm">Spin</button></div></section>
<div class="sec-head"><h2 class="h2">Inspiration</h2></div>
<div class="tabs"><a class="on">For you</a><a>Following</a><span class="grow"></span><a class="chip on">Women</a></div>
{grid(P[:6], saved_idx=(1,))}''', "home")


def s_shop():
    return phone("Shop, with the colour bar", f'''{top()}
<h1 class="h1">Shop</h1>
<label class="search">{I["search"]}<span>Search pieces, try "linen dress"</span></label>
{spectrum()}
<div class="tools"><button class="tool">{I["filter"]}<span>Filters</span></button><span class="chip on">Women</span><span class="chip">On sale</span><span class="grow"></span><span class="sort">Newest</span></div>
<p class="count">6,271 pieces from 23 shops</p>
{grid(P[8:14])}''', "shop")


def s_filters():
    shops = ["Stajling", "Secretstylex", "Joe & Luca", "Fiore", "Avocado", "Extraordinary"]
    return phone("Shop filters (one sheet)", f'''{top()}<h1 class="h1">Shop</h1>{grid(P[8:12])}
<div class="scrim"></div>
<section class="sheet"><div class="grab"></div><div class="sheet-head"><h2 class="h2">Filters</h2><a class="txt">Clear</a></div>
<h3 class="label">Category</h3>{chips(["All", "Knitwear", "Coats", "Dresses", "Jeans", "Shoes", "Bags"], 2, "chips wrap")}
<h3 class="label">Colour</h3>{spectrum("brown")}
<h3 class="label">Price</h3><div class="range"><span>0 €</span><div class="track"><span></span></div><span>100 €</span></div>
<h3 class="label">Shops</h3>{chips(shops, -1, "chips wrap")}
<button class="btn block">Show 312 pieces</button></section>''', "shop")


def s_piece():
    p = P[21]
    more = "".join(f'<img src="{e(x["img"])}" alt="">' for x in [P[1], P[2], P[11], P[12]])
    return phone("Piece", f'''<div class="pd-photo"><img src="{e(p["img"])}" alt=""><div class="pd-bar"><button class="round light">{I["back"]}</button><span class="grow"></span><button class="round light">{I["share"]}</button></div><div class="dots"><span class="on"></span><span></span><span></span></div></div>
<section class="pd"><p class="small"><a class="shoplink">{e(p["shop"])}</a></p><h1 class="h1 tight">{e(p["title"])}</h1><p class="price-lg">{eur(p)}</p>
<div class="pd-acts"><button class="btn">{I["save"]}Save</button><button class="btn ghost">I own this</button></div>
<a class="row">{I["shirt"]}<span>Try it on you</span><span class="grow"></span><span class="muted small">Members</span>{I["chev"]}</a>
<a class="row">{I["out"]}<span>Buy at {e(p["shop"])}</span><span class="grow"></span>{I["chev"]}</a>
<h2 class="h3">More from {e(p["shop"])}</h2><div class="strip">{more}</div></section>''')


def s_shop_page():
    stj = [x for x in P if x["shop"] == "Stajling"][:4]
    return phone("A shop's page", f'''{top()}
<section class="ph-head"><div class="avatar-lg">S</div><h1 class="h1">Stajling</h1><p class="muted">{I["pin"]}Ulica Eve Lovše 1, Maribor</p><p class="bio">Women's fashion for every day and evening, from Maribor.</p>
<div class="acts"><button class="btn">Follow</button><button class="btn ghost">{I["out"]}Visit shop</button></div></section>
<div class="tabs"><a class="on">Pieces</a><a>Boards</a><span class="grow"></span><span class="sort">Newest</span></div>
{grid(stj)}''', "shop")


def s_wardrobe():
    items = cat("knitwear", 2) + cat("jeans", 2) + cat("dresses", 2)
    tiles = "".join(f'<figure class="wd"><img src="{e(x["img"])}" alt=""><figcaption>{e(x["title"])}</figcaption></figure>' for x in items)
    return phone("Wardrobe", f'''{top('<button class="round dark sm">' + I["plus"] + '</button>')}
<h1 class="h1">Wardrobe</h1>
<div class="tabs"><a class="on">Pieces</a><a>Looks</a><a>Wishlist</a><span class="grow"></span><span class="small muted">42</span></div>
<div class="cats"><a class="on">All</a><a>Tops</a><a>Bottoms</a><a>Dresses</a><a>Outerwear</a><a>Shoes</a></div>
{chips(["Knitwear", "Shirts", "T-shirts", "Sports"], -1, "chips sub")}
<div class="wgrid">{tiles}</div>''', "wardrobe")


def s_item():
    x = cat("knitwear")[0]
    return phone("Wardrobe piece", f'''<header class="top"><button class="round light">{I["back"]}</button><span class="grow"></span><button class="round light">{I["dots"]}</button></header>
<div class="it-photo"><img src="{e(x["img"])}" alt=""></div>
<section class="pd"><h1 class="h1 tight">{e(x["title"])}</h1><p class="muted">Tops, Knitwear</p>
<div class="swatches"><span style="--sw:#d9c8b4"></span><span style="--sw:#3a2a20"></span></div>
<div class="pd-acts"><button class="btn">Make an outfit</button><button class="btn ghost">Add to a board</button></div>
<dl class="facts"><div><dt>Season</dt><dd>Autumn, winter</dd></div><div><dt>Worn</dt><dd>3 times, last on Monday</dd></div><div><dt>Notes</dt><dd>Wash cold, dry flat.</dd></div></dl></section>''', "wardrobe")


def s_add():
    found = cat("outerwear", 2) + cat("shoes", 1) + cat("bags", 1)
    tiles = "".join(f'<figure class="found"><img src="{e(x["img"])}" alt=""><span class="tick">{I["check"]}</span><figcaption>{e(x["title"])}</figcaption></figure>' for x in found)
    return phone("Add pieces: scan result", f'''<header class="top"><button class="round light">{I["x"]}</button><span class="step">Scan</span><span style="width:40px"></span></header>
<h1 class="h1">4 pieces found</h1><p class="lede">Product shots are on their way. Untick anything that isn't yours.</p>
<div class="wgrid found-grid">{tiles}</div>
<div class="add-ways"><a class="row">{I["camera"]}<span>Scan more photos</span>{I["chev"]}</a><a class="row">{I["tag"]}<span>Add a piece by hand</span>{I["chev"]}</a></div>
<div class="footer-cta"><button class="btn block">Add 4 to my wardrobe</button></div>''')


def s_boards():
    def cover(ps):
        a, b, c = ps
        return f'<div class="cover"><img class="c1" src="{e(a["img"])}" alt=""><img class="c2" src="{e(b["img"])}" alt=""><img class="c3" src="{e(c["img"])}" alt=""></div>'
    boards = [("Winter in Ljubljana", [P[3], P[21], P[1]], "14 pins", "Public"),
              ("Brown, all over", [P[0], C[24], P[16]], "9 pins", "Private"),
              ("Wedding guest", [cat("dresses")[0], cat("bags")[0], cat("shoes")[1]], "6 pins", "Private"),
              ("First picks", [P[5], P[13], P[9]], "10 pins", "Private")]
    tiles = "".join(f'<article class="board">{cover(ps)}<p class="t">{n}</p><p class="m"><span>{c}</span><span>{v}</span></p></article>' for n, ps, c, v in boards)
    return phone("Boards", f'''{top()}
<div class="sec-head"><h1 class="h1">Boards</h1><button class="btn sm">{I["plus"]}New board</button></div>
<div class="tabs"><a class="on">Boards</a><a>Collages</a><a>Saved</a></div>
<div class="bgrid">{tiles}</div>''', "boards")


def s_board():
    pins = [P[3], P[1], P[21], cat("bags")[1], P[13], cat("shoes")[0]]
    mason = "".join(f'<figure class="pin p{i % 4}"><img src="{e(x["img"])}" alt=""></figure>' for i, x in enumerate(pins))
    coll = [P[21], P[1], cat("bags")[0], cat("jewelry")[0]]
    return phone("A board", f'''<header class="top"><button class="round light">{I["back"]}</button><span class="grow"></span><button class="round light">{I["share"]}</button><button class="round light">{I["dots"]}</button></header>
<section class="bd-head"><h1 class="h1">Winter in Ljubljana</h1><p class="muted small">14 pins, public on your profile</p></section>
<div class="collage"><img class="k1" src="{e(coll[0]["img"])}" alt=""><img class="k2" src="{e(coll[1]["img"])}" alt=""><img class="k3" src="{e(coll[2]["img"])}" alt=""><img class="k4" src="{e(coll[3]["img"])}" alt=""><span class="ctag">Collage</span></div>
<div class="mason">{mason}</div>''', "boards")


def s_profile():
    bs = [("Winter in Ljubljana", P[21]), ("Piran weekend", cat("dresses")[2]), ("Office, but soft", cat("suits_blazers")[0]), ("Black tie", cat("dresses")[4])]
    tiles = "".join(f'<article class="board"><img class="cover1" src="{e(x["img"])}" alt=""><p class="t">{n}</p></article>' for n, x in bs)
    return phone("A person's profile", f'''{top()}
<section class="ph-head"><div class="avatar-lg photo"><img src="{e(cat("knitwear")[3]["img"])}" alt=""></div><h1 class="h1">Maja Novak</h1><p class="muted">@maja.novak</p><p class="bio">Ljubljana. Neutral colours, good coats, too many boots.</p>
<div class="acts"><button class="btn">Follow</button><button class="round light">{I["dots"]}</button></div></section>
<div class="tabs"><a class="on">Boards</a><a>Looks</a></div>
<div class="bgrid">{tiles}</div>''')


def s_account():
    return phone("You: account", f'''{top('<span></span>')}
<section class="me"><span class="av lg">K</span><div><h1 class="h2">Kristjan</h1><p class="muted small">kris@example.com</p></div></section>
<section class="member"><div><p class="t">Member</p><p class="m">397 credits, renews 12 November</p></div><a class="txt">Manage</a></section>
<div class="list">
<a class="row">{I["chat"]}<span>Use Styld in ChatGPT or Claude</span><span class="grow"></span>{I["chev"]}</a>
<a class="row">{I["pin"]}<span>Public profile</span><span class="grow"></span><span class="muted small">@kristjan</span>{I["chev"]}</a>
<a class="row">{I["shop"]}<span>Shops you follow</span><span class="grow"></span><span class="muted small">6</span>{I["chev"]}</a>
<a class="row">{I["tag"]}<span>Activity</span><span class="grow"></span>{I["chev"]}</a>
<a class="row">{I["shirt"]}<span>Style profile</span><span class="grow"></span>{I["chev"]}</a>
<a class="row"><span>Language</span><span class="grow"></span><span class="muted small">Slovenščina</span>{I["chev"]}</a>
<a class="row"><span>Sign out</span></a></div>''', "you")


# ---------------- Desktop screens ----------------

def desk(label, inner, active="Home"):
    navs = "".join(f'<a class="{"on" if n == active else ""}">{n}</a>' for n in ["Home", "Shop", "Boards", "Wardrobe", "Stylist"])
    return (f'<figure class="shot wide"><div class="frame desk"><div class="dscreen"><header class="dtop">{LOGO}<nav class="dnav">{navs}</nav>'
            f'<span class="grow"></span><label class="search small">{I["search"]}<span>Search</span></label><span class="av">K</span></header>'
            f'{inner}</div></div><figcaption>{label}</figcaption></figure>')


def dgrid(items, cols=5):
    return f'<div class="grid dg{cols}">' + "".join(card(p) for p in items) + "</div>"


def d_home():
    pick = cat("trousers")[1]
    return desk("Home, desktop", f'''<div class="dbody"><section class="today wide"><img src="{e(pick["img"])}" alt=""><div><p class="small muted">Today from your wardrobe</p><p class="t lg">{e(pick["title"])}</p></div><span class="grow"></span><button class="btn">Spin</button><button class="btn ghost">Make an outfit</button></section>
<div class="drow"><h1 class="h1">Inspiration</h1><div class="tabs"><a class="on">For you</a><a>Following</a></div><span class="grow"></span><span class="chip on">Women</span><span class="chip">All</span></div>{dgrid(P[12:22])}</div>''')


def d_shop():
    cats = "".join(f'<a class="{"on" if i == 0 else ""}">{c}</a>' for i, c in enumerate(["All pieces", "Knitwear", "Coats", "Dresses", "Skirts", "Jeans", "Trousers", "Shoes", "Bags", "Jewellery"]))
    return desk("Shop, desktop", f'''<div class="dshop"><aside class="side"><h1 class="h1">Shop</h1><nav class="sidenav">{cats}</nav><h3 class="label">Colour</h3>{spectrum()}<h3 class="label">Price</h3><div class="range"><span>0 €</span><div class="track"><span></span></div><span>250 €</span></div><h3 class="label">Shops</h3><nav class="sidenav small">{"".join(f"<a>{s}</a>" for s in ["Stajling", "Secretstylex", "Joe & Luca", "Fiore", "Avocado"])}</nav></aside>
<div><div class="drow"><p class="count">6,271 pieces from 23 shops</p><span class="grow"></span><span class="chip on">Women</span><span class="chip">On sale</span><span class="sort">Newest</span></div>{dgrid(C[0:8] + C[12:16], 4)}</div></div>''', "Shop")


def d_piece():
    p = P[21]
    more = "".join(card(x) for x in [P[1], P[2], P[11], P[12], P[4]])
    return desk("Piece, desktop", f'''<div class="dpiece"><div class="dp-photos"><img src="{e(p["img"])}" alt=""><img src="{e(P[22]["img"])}" alt=""></div>
<section class="pd"><p class="small"><a class="shoplink">{e(p["shop"])}</a></p><h1 class="h1 tight xl">{e(p["title"])}</h1><p class="price-lg">{eur(p)}</p>
<div class="pd-acts"><button class="btn">{I["save"]}Save</button><button class="btn ghost">I own this</button></div>
<a class="row">{I["shirt"]}<span>Try it on you</span><span class="grow"></span><span class="muted small">Members</span>{I["chev"]}</a>
<a class="row">{I["out"]}<span>Buy at {e(p["shop"])}</span><span class="grow"></span>{I["chev"]}</a>
<p class="desc">Wool-blend coat with a notched collar and a tie belt. Falls below the knee. Sizes S to XL at the shop.</p></section></div>
<div class="dbody"><h2 class="h2">More from {e(p["shop"])}</h2><div class="grid dg5">{more}</div></div>''', "Shop")


def d_wardrobe():
    items = cat("knitwear", 3) + cat("shirts_blouses", 2) + cat("jeans", 3) + cat("dresses", 2) + cat("outerwear", 2)
    tiles = "".join(f'<figure class="wd"><img src="{e(x["img"])}" alt=""><figcaption>{e(x["title"])}</figcaption></figure>' for x in items)
    return desk("Wardrobe, desktop", f'''<div class="dbody"><div class="drow"><h1 class="h1">Wardrobe</h1><div class="tabs"><a class="on">Pieces</a><a>Looks</a><a>Wishlist</a></div><span class="grow"></span><button class="btn ghost">Edit categories</button><button class="btn">{I["plus"]}Add pieces</button></div>
<div class="cats"><a class="on">All 42</a><a>Tops 14</a><a>Bottoms 9</a><a>Dresses 6</a><a>Outerwear 5</a><a>Shoes 6</a><a>Accessories 2</a></div>
<div class="wgrid dw">{tiles}</div></div>''', "Wardrobe")


def d_board():
    pins = [P[3], P[1], P[21], cat("bags")[1], P[13], cat("shoes")[0], P[4], cat("jewelry")[1], P[22], P[5]]
    mason = "".join(f'<figure class="pin p{i % 4}"><img src="{e(x["img"])}" alt=""></figure>' for i, x in enumerate(pins))
    coll = [P[21], P[1], cat("bags")[0], cat("jewelry")[0]]
    return desk("A board, desktop", f'''<div class="dboard"><section class="bd-side"><p class="small muted">Board</p><h1 class="h1 xl">Winter in Ljubljana</h1><p class="muted">14 pins, public on your profile</p>
<div class="pd-acts"><button class="btn">{I["plus"]}Add pins</button><button class="btn ghost">{I["share"]}Share</button></div>
<div class="collage"><img class="k1" src="{e(coll[0]["img"])}" alt=""><img class="k2" src="{e(coll[1]["img"])}" alt=""><img class="k3" src="{e(coll[2]["img"])}" alt=""><img class="k4" src="{e(coll[3]["img"])}" alt=""><span class="ctag">Collage</span></div></section>
<div class="mason d">{mason}</div></div>''', "Boards")


def d_profile():
    bs = [("Winter in Ljubljana", P[21]), ("Piran weekend", cat("dresses")[2]), ("Office, but soft", cat("suits_blazers")[0]), ("Black tie", cat("dresses")[4]), ("Knits", cat("knitwear")[1])]
    tiles = "".join(f'<article class="board"><img class="cover1" src="{e(x["img"])}" alt=""><p class="t">{n}</p></article>' for n, x in bs)
    return desk("A person's profile, desktop", f'''<div class="dbody"><section class="ph-head row-l"><div class="avatar-lg photo"><img src="{e(cat("knitwear")[3]["img"])}" alt=""></div><div><h1 class="h1 xl">Maja Novak</h1><p class="muted">@maja.novak</p><p class="bio">Ljubljana. Neutral colours, good coats, too many boots.</p></div><span class="grow"></span><button class="btn">Follow</button></section>
<div class="tabs"><a class="on">Boards</a><a>Looks</a></div><div class="bgrid d5">{tiles}</div></div>''')


PHONES = [s_landing, s_login, s_onboarding, s_home, s_shop, s_filters, s_piece, s_shop_page, s_wardrobe, s_item, s_add,
          s_boards, s_board, s_profile, s_account]
DESKS = [d_home, d_shop, d_piece, d_wardrobe, d_board, d_profile]

phones = "".join(f() for f in PHONES)
desks = "".join(f() for f in DESKS)
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Styld in Gallery</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="gallery.css"></head><body>
<header class="page-head"><div class="ph-in">{LOGO}<div><h1>Styld in Gallery</h1><p>Every main screen in the Gallery direction: warm paper, one sans typeface, no outlines, photos first. Phone screens first, then desktop. The pieces are real, from Styld's shops; names and counts on the profile, boards and account are made up.</p>
<nav class="jump"><a href="#phones">Phone screens</a><a href="#desktop">Desktop screens</a><a href="index.html">All directions</a></nav></div></div></header>
<section class="wall" id="phones"><h2 class="wall-h">Phone</h2><div class="phones">{phones}</div></section>
<section class="wall" id="desktop"><h2 class="wall-h">Desktop</h2><div class="desks">{desks}</div></section>
</body></html>'''
open("/tmp/design-lab/gallery.html", "w").write(page)
print("ok", len(page))
