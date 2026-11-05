// HTML escaping with no dependencies, so the edge Worker (plain TypeScript, no Effect) can import it as
// `@styld/protocol/html` without growing past its budget.

const htmlEntities: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text made safe to place in HTML, as an element's text or inside a quoted attribute (either quote): the one escape
 * every page Styld writes as a string uses (the SSR head, the edge's link previews, the consent page, the seed report). */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/gu, (character) => htmlEntities[character] ?? '')
