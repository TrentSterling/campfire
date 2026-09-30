let drawer, current = null
const ids = ['controls-panel', 'settings-panel', 'progress-journal', 'hat-shop']
const names = ['Controls', 'Settings', 'Journal', 'Hats']
export function closeDrawer() {
  if (!drawer) return
  const previous = current
  current = null; drawer.hidden = true
  for (const id of ids) {
    const panel = document.getElementById(id)
    panel.hidden = true
    if (id === 'progress-journal') panel.style.display = 'none'
  }
  for (const id of ['help-button', 'settings-button']) document.getElementById(id)?.setAttribute('aria-expanded', 'false')
  document.dispatchEvent(new CustomEvent('campfire:panel-close', { detail: previous }))
}
export function showPanel(id) {
  if (!drawer || !ids.includes(id)) return
  if (current && current !== id) closeDrawer()
  current = id; drawer.hidden = false
  for (const candidate of ids) {
    const panel = document.getElementById(candidate)
    panel.hidden = candidate !== id
    if (candidate === 'progress-journal') panel.style.display = candidate === id ? 'block' : 'none'
  }
  for (const button of drawer.querySelectorAll('[data-panel]')) button.setAttribute('aria-pressed', String(button.dataset.panel === id))
  document.getElementById('help-button').setAttribute('aria-expanded', String(id === 'controls-panel'))
  document.getElementById('settings-button').setAttribute('aria-expanded', String(id === 'settings-panel'))
  document.dispatchEvent(new CustomEvent('campfire:panel-open', { detail: id }))
}
export function togglePanel(id) { if (current === id) closeDrawer(); else showPanel(id) }
export function initDrawer() {
  drawer = document.createElement('aside'); drawer.id = 'campfire-drawer'; drawer.className = 'campfire-drawer panel'; drawer.hidden = true
  drawer.setAttribute('aria-label', 'Campfire menu')
  const header = document.createElement('div'); header.className = 'drawer-header'
  const nav = document.createElement('nav'); nav.setAttribute('aria-label', 'Campfire menu sections')
  ids.forEach((id, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.panel = id; button.textContent = names[i]; button.setAttribute('aria-controls', id)
    button.addEventListener('click', () => {
      if (id === 'hat-shop') document.dispatchEvent(new Event('campfire:open-hats'))
      else showPanel(id)
    }); nav.append(button)
  })
  const close = document.createElement('button'); close.type = 'button'; close.className = 'drawer-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close menu'); close.addEventListener('click', closeDrawer)
  const body = document.createElement('div'); body.className = 'drawer-scroll'
  for (const id of ids) { const panel = document.getElementById(id); panel.hidden = true; body.append(panel) }
  header.append(nav, close); drawer.append(header, body); document.body.append(drawer)
  addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer() })
  window.__drawer = () => ({ open: !drawer.hidden, panel: current })
}
