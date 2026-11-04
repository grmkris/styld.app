import { format, type Locale, type MessageKey, type MessageValues } from '@styld/i18n'
import type { OAuthServer } from '@yielded/auth'

// The page that asks the person to let an assistant (ChatGPT, Claude) into their Styld, in the website's Gallery look
// (DESIGN.md; the sign-in page `page/LoginView.ts` is its model). Yielded renders it inside the authorization request,
// under a policy that forbids scripts and inline styles and allows a stylesheet, fonts and images from Styld's own
// origin, so its looks come from `consentStylesheet`, served at `consentStylesheetPath`.

/** Where the consent page's stylesheet is served, beside the authorization endpoint. */
export const consentStylesheetPath = '/oauth/mcp/consent.css'

/** Who is signed in, as the person knows themselves: their name and the email they sign in with. */
export interface ConsentPerson {
  readonly name: string
  readonly email: string | undefined
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/** The consent page: who asks, as whom, what it may do and where it returns, then Allow, Deny and another account.
 * It keeps Yielded's form: the POST action, the csrf field and the approve and deny decisions. */
export const consentPage = (consent: OAuthServer.Consent, person: ConsentPerson, locale: Locale) => {
  const words = <K extends MessageKey>(key: K, values: MessageValues<K>) => escapeHtml(format(locale, key, values))
  const returnHost = escapeHtml(new URL(consent.redirectUri).host)
  const clientHost = consent.registered ? undefined : escapeHtml(new URL(consent.clientId).hostname)
  const local = new URL(consent.redirectUri).protocol === 'http:'
  return [
    `<!doctype html><html lang="${locale}"><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${words('consent.title', { client: consent.clientName })}</title>`,
    `<link rel="stylesheet" href="${consentStylesheetPath}">`,
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<main class="page">',
    `<img class="wordmark" src="/brand/wordmark.svg" alt="Styld" width="96" height="28">`,
    `<h1>${words('consent.title', { client: consent.clientName })}</h1>`,
    `<p class="lede">${words('consent.lede', { client: consent.clientName })}</p>`,
    '<section class="card">',
    `<p class="label">${words('consent.signedInAs', {})}</p>`,
    `<p class="who">${escapeHtml(person.name)}</p>`,
    person.email === undefined ? '' : `<p class="meta">${escapeHtml(person.email)}</p>`,
    `<p class="label">${words('consent.canDo', {})}</p>`,
    `<ul class="can">`,
    `<li>${words('consent.readWardrobe', {})}</li>`,
    `<li>${words('consent.changeWardrobe', {})}</li>`,
    `<li>${words('consent.credits', {})}</li>`,
    '</ul>',
    `<p class="meta">${clientHost === undefined ? '' : `${words('consent.client', { host: clientHost })} · `}${words('consent.returnTo', { host: returnHost })}</p>`,
    local ? `<p class="warning" role="alert">${words('consent.local', {})}</p>` : '',
    '</section>',
    `<form method="post" action="${escapeHtml(consent.action)}" class="actions">`,
    `<input type="hidden" name="csrf" value="${escapeHtml(consent.csrf)}">`,
    `<button class="primary" name="decision" value="approve">${words('consent.allow', {})}</button>`,
    `<button class="secondary" name="decision" value="deny">${words('consent.deny', {})}</button>`,
    '</form>',
    `<p class="other"><a href="${escapeHtml(consent.loginPath)}">${words('consent.otherAccount', {})}</a></p>`,
    `<p class="meta">${words('consent.revoke', { client: consent.clientName })}</p>`,
    '</main></html>',
  ].join('')
}

/** The Gallery values the consent page uses, from `apps/web/src/zyzz.config.ts` (paper, stock, ink, ink-2, rule,
 * signal; the pill and panel radii) and the sign-in page's layout. The website itself is styled with zyzz; this one
 * document is rendered by the authorization server and can load only a stylesheet of its own origin. */
export const consentStylesheet = `
:root{color-scheme:light dark;--paper:light-dark(#f1eee7,#17120f);--stock:light-dark(#fbf9f5,#211b17);--ink:light-dark(#1c1410,#f2ebe2);--ink2:light-dark(#5d554e,#bdb1a4);--rule:light-dark(#ddd6cc,#3a312a);--signal:light-dark(#2f4f7c,#9db8e0);--on-ink:light-dark(#fbf9f5,#17120f)}
*{box-sizing:border-box}
html{background:var(--paper);color:var(--ink);font-family:'Hanken Grotesk Variable','Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
body{margin:0}
.page{max-inline-size:30rem;margin-inline:auto;padding:clamp(24px,6vw,72px) 20px 48px}
.wordmark{display:block;block-size:28px;inline-size:auto;margin-block-end:32px}
@media (prefers-color-scheme:dark){.wordmark{filter:invert(1) hue-rotate(180deg)}}
h1{margin:0;font-size:clamp(28px,22px + 2vw,36px);line-height:1.15;font-weight:600;letter-spacing:-0.01em}
.lede{margin:8px 0 0;font-size:18px;color:var(--ink2)}
.card{margin-block-start:24px;padding:20px;background:var(--stock);border:1px solid var(--rule);border-radius:16px}
.label{margin:0;font-size:13px;font-weight:600;color:var(--ink2);text-transform:uppercase;letter-spacing:.06em}
.label+.who,.label+.can{margin-block-start:4px}
.who{margin:0;font-size:18px;font-weight:600;overflow-wrap:anywhere}
.meta{margin:4px 0 0;font-size:14px;color:var(--ink2);overflow-wrap:anywhere}
.card .label:not(:first-child){margin-block-start:16px}
.can{margin:0;padding-inline-start:20px}
.can li{margin-block:2px}
.card>.meta:last-child{margin-block-start:16px}
.warning{margin:16px 0 0;font-size:14px;font-weight:600}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-block-start:24px}
button{display:inline-flex;align-items:center;justify-content:center;min-block-size:48px;padding-inline:20px;border-radius:999px;font:inherit;font-size:16px;font-weight:600;cursor:pointer;transition:transform .12s ease,background-color .12s ease}
button:active{transform:scale(.96)}
.primary{flex:1 1 auto;border:0;background:var(--ink);color:var(--on-ink)}
.secondary{border:1.5px solid var(--ink);background:transparent;color:var(--ink)}
button:focus-visible,a:focus-visible{outline:2px solid var(--signal);outline-offset:3px}
.other{margin:16px 0 0}
.other a{color:var(--ink);font-weight:600;text-decoration:underline;text-decoration-color:var(--signal);text-decoration-thickness:1.5px;text-underline-offset:4px}
.page>.meta:last-child{margin-block-start:24px}
`
