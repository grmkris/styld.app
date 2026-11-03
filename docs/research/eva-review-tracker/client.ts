const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')]
const forms = [...document.querySelectorAll<HTMLFormElement>('[data-controls]')]
const records = [...document.querySelectorAll<HTMLDetailsElement>('[data-record]')]
const tabs = [...document.querySelectorAll<HTMLAnchorElement>('[data-tab]')]
const searchText = new Map(records.map((record) => [record, (record.textContent ?? '').toLocaleLowerCase()]))

function fieldValue(data: FormData, key: string) {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

function refresh(form: HTMLFormElement) {
  const data = new FormData(form)
  const query = fieldValue(data, 'q').trim().toLocaleLowerCase()
  const group = fieldValue(data, 'group')
  const status = fieldValue(data, 'status')
  const scope = form.dataset.for
  let visible = 0
  for (const record of records.filter((item) => item.dataset.record === scope)) {
    const matches = (!query || (searchText.get(record) ?? '').includes(query)) && (!group || (record.dataset.group ?? '').split(' ').includes(group)) && (!status || record.dataset.status === status)
    record.hidden = !matches
    if (matches) visible += 1
  }
  const count = document.querySelector(`[data-count="${scope}"]`)
  const empty = document.querySelector<HTMLElement>(`[data-empty="${scope}"]`)
  if (count) count.textContent = `${visible} ${scope} shown`
  if (empty) empty.hidden = visible !== 0
}

function restoreFilters(form: HTMLFormElement, params: URLSearchParams) {
  for (const field of ['q', 'group', 'status']) {
    const input = form.elements.namedItem(field)
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = params.get(field) ?? ''
  }
  refresh(form)
}

function showPanel(view: string) {
  for (const panel of panels) panel.hidden = panel.id !== view
  for (const tab of tabs) {
    if (tab.dataset.tab === view) tab.setAttribute('aria-current', 'page')
    else tab.removeAttribute('aria-current')
  }
}

function renderRoute(scroll: boolean) {
  const url = new URL(location.href)
  const anchor = url.hash.slice(1)
  const target = records.find((record) => record.id === anchor)
  const view = target?.dataset.record ?? panels.find((panel) => panel.id === anchor)?.id ?? panels.find((panel) => panel.id === url.searchParams.get('view'))?.id ?? 'overview'
  showPanel(view)
  for (const form of forms) {
    const params = !target && form.dataset.for === view ? url.searchParams : new URLSearchParams()
    restoreFilters(form, params)
  }
  for (const record of records) record.open = record === target
  if (scroll || target) (target ?? document.getElementById(view))?.scrollIntoView({ block: 'start' })
}

function saveFilters(form: HTMLFormElement) {
  refresh(form)
  const url = new URL(location.href)
  url.search = ''
  url.hash = form.dataset.for ?? 'tickets'
  const data = new FormData(form)
  for (const field of ['q', 'group', 'status']) {
    const value = fieldValue(data, field)
    if (value) url.searchParams.set(field, value)
  }
  history.replaceState(null, '', url)
}

for (const form of forms) {
  form.hidden = false
  form.addEventListener('submit', (event) => event.preventDefault())
  form.addEventListener('input', () => saveFilters(form))
  form.addEventListener('change', () => saveFilters(form))
  form.addEventListener('reset', () => requestAnimationFrame(() => saveFilters(form)))
}

function navigateLink(link: HTMLAnchorElement, event: MouseEvent) {
  const url = new URL(link.href)
  if (url.origin !== location.origin || url.pathname !== location.pathname || link.hasAttribute('download')) return
  if (!url.search && !url.hash) return
  if (url.hash === '#main') return
  event.preventDefault()
  // A finding or ticket link must reveal its target even after a narrow search.
  if (records.some((record) => `#${record.id}` === url.hash)) url.search = ''
  history.pushState(null, '', url)
  renderRoute(true)
}

document.addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!(event.target instanceof Element)) return
  const link = event.target.closest('a')
  if (link) {
    navigateLink(link, event)
    return
  }
  const summary = event.target.closest('.record > summary')
  if (!summary) return
  event.preventDefault()
  const record = summary.parentElement
  if (!(record instanceof HTMLDetailsElement)) return
  record.open = !record.open
  const url = new URL(location.href)
  url.hash = record.open ? record.id : record.dataset.record ?? 'tickets'
  history.replaceState(null, '', url)
})

window.addEventListener('popstate', () => renderRoute(true))
window.addEventListener('hashchange', () => renderRoute(true))
renderRoute(false)
