import type { Page } from 'playwright'

/** Native fixtures do not preselect, so the tray hides them until this control is used. */
export const revealFound = async (page: Page, heading: string) => {
  const reveal = page.getByRole('button', { name: 'Show everything detected' })
  const title = page.getByRole('heading', { name: heading })
  await reveal.or(title).waitFor({ state: 'visible', timeout: 30000 })
  if (await reveal.isVisible()) await reveal.click()
  await title.waitFor({ state: 'visible', timeout: 30000 })
}
