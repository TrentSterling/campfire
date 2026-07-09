// src/identity.js : persistent player identity (localStorage). A returning
// player keeps the same seed (so the same critter recipe/palette regenerates)
// and the same display name across reloads, instead of rerolling every visit.
// Pure data helpers (getOrCreateIdentity/saveIdentity) plus a tiny DOM affordance
// (initIdentityUI) for renaming in place. No network/critter code lives here.
import { randomName } from './critter/tags.js'

const KEY = 'campfire-identity'

// reads {seed, name} from localStorage; generates + persists a fresh random
// identity (same convention as net/net.js NPC seeds: (Math.random()*1e9)|0,
// and tags.js randomName()) if absent or corrupt. seed is compatible with
// critterMake(seed, x, z) as-is.
export function getOrCreateIdentity() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (d && Number.isFinite(d.seed) && typeof d.name === 'string' && d.name) return { seed: d.seed, name: d.name }
    }
  } catch {} // corrupt/inaccessible storage: fall through to a fresh identity
  const seed = (Math.random() * 1e9) | 0
  const name = randomName()
  saveIdentity(seed, name)
  return { seed, name }
}

// persists {seed, name} to localStorage; silently no-ops if storage is unavailable
// (private browsing, quota, etc.) since identity is a nice-to-have, never required.
export function saveIdentity(seed, name) {
  try { localStorage.setItem(KEY, JSON.stringify({ seed, name: String(name).slice(0, 24) })) } catch {}
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) }

// injects a tiny bottom-right "you are X · click to rename" affordance styled to
// match the game's dusk HUD (colors/font lifted from index.html's .hint/.badge).
// getCurrentName() is called whenever the tag (re)draws, so it always reflects the
// live name even if it changed elsewhere. onRename(newName) fires on submit; the
// caller decides how to apply it (e.g. window.campfire.setName + saveIdentity).
export function initIdentityUI(getCurrentName, onRename) {
  const style = document.createElement('style')
  style.textContent = `
    #identity-tag {
      position: fixed; right: 14px; bottom: 14px; z-index: 10;
      font: 500 12px/1.4 ui-rounded, "Segoe UI", system-ui, sans-serif;
      color: #ffe9c7cc; text-shadow: 0 1px 3px rgba(0,0,0,.6);
      user-select: none; text-align: right; cursor: pointer; pointer-events: auto;
    }
    #identity-tag b { color: #ffd39b; }
    #identity-tag .edit-hint { opacity: .6; margin-left: 6px; }
    #identity-tag:hover .edit-hint { opacity: 1; text-decoration: underline; }
    #identity-input {
      position: fixed; right: 14px; bottom: 14px; z-index: 11;
      width: 170px; padding: 6px 14px; border-radius: 999px;
      border: 1px solid #ffd39b88; background: rgba(40,30,56,0.85); color: #ffe9c7;
      font: 500 13px "Segoe UI", system-ui, sans-serif; outline: none; backdrop-filter: blur(4px);
      display: none; text-align: right;
    }
    #identity-input:focus { border-color: #ffd39b; }
  `
  document.head.appendChild(style)

  const tag = document.createElement('div')
  tag.id = 'identity-tag'
  document.body.appendChild(tag)

  const input = document.createElement('input')
  input.id = 'identity-input'
  input.maxLength = 24
  input.autocomplete = 'off'
  input.spellcheck = false
  input.placeholder = 'new name...'
  document.body.appendChild(input)

  function redraw() {
    tag.innerHTML = 'you are <b>' + escHtml(getCurrentName()) + '</b><span class="edit-hint">click to rename</span>'
  }
  redraw()

  function openEditor() {
    input.value = getCurrentName()
    tag.style.display = 'none'; input.style.display = 'block'
    input.focus(); input.select()
  }
  function closeEditor() { input.style.display = 'none'; tag.style.display = 'block'; redraw() }

  tag.addEventListener('click', openEditor)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const v = input.value.trim()
      if (v) onRename(v)
      closeEditor()
    } else if (e.key === 'Escape') closeEditor()
  })
  input.addEventListener('blur', closeEditor)

  return { redraw } // caller may force a refresh if the name changes off-screen (e.g. remote rename echo)
}
