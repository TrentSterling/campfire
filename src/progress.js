import { togglePanel } from './drawer.js'
// src/progress.js : v1.4 "the loop". Two numbers, per docs/IDEAS.md:
//   shells (currency, earned by DOING: catches, ollies, pets) and
//   warmth  (XP, earned by BEING at the fire; never spent; unlocks titles).
// Plus the fishing journal (species collection, best lengths, goldens) and the
// explicit hat purchases at the rack; trying on never spends shells.
// All localStorage ('campfire-progress', separate key from identity), last
// write wins across tabs: casual by design. Show-don't-stat: progress surfaces
// as a small HUD chip, a title line under the nametag, and richer catch brags,
// never a dashboard. J toggles the compact journal panel.
import { state } from './state.js'
import { bubble } from './critter/tags.js'
import { HAT_COUNT } from './critter/gear.js'
import { playChirp } from './audio.js'

const KEY = 'campfire-progress'

// warmth thresholds -> titles under the nametag (cosmetic status only)
export const TITLES = [
  { at: 0, name: 'Spark' },
  { at: 10, name: 'Ember' },
  { at: 30, name: 'Flame' },
  { at: 75, name: 'Beacon' },
  { at: 150, name: 'Fire Keeper' },
]
export const titleFor = w => { let t = TITLES[0].name; for (const row of TITLES) if (w >= row.at) t = row.name; return t }

// hat prices (index-aligned with gear.js HAT_NAMES); 0 = free starter
export const HAT_PRICES = [0, 12, 15, 40, 10, 8, 60, 25]

const P = load()
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY))
    if (d && typeof d === 'object') {
      return {
        shells: Number.isFinite(d.shells) ? d.shells : 0,
        warmth: Number.isFinite(d.warmth) ? d.warmth : 0,
        owned: Array.isArray(d.owned) ? d.owned.filter(Number.isFinite) : [0],
        journal: (d.journal && typeof d.journal === 'object') ? d.journal : {},
      }
    }
  } catch {}
  return { shells: 0, warmth: 0, owned: [0], journal: {} }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(P)) } catch {} }

export const getShells = () => P.shells
export const getWarmth = () => P.warmth
export const myTitle = () => titleFor(P.warmth)

// ---------------------------------------------------------------------------
// HUD chip (bottom-left, above the chat log, dusk-styled like the rest)
// ---------------------------------------------------------------------------
let chipEl = null, journalEl = null
function refreshChip() {
  if (chipEl) chipEl.innerHTML = '<b>' + P.shells + '</b> shells &nbsp;·&nbsp; <b>' + esc(myTitle()) + '</b> <span class="dim">(' + P.warmth + ' warmth)</span>'
}
const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

export function addShells(n, why) {
  n = Math.max(0, n | 0); if (!n) return
  P.shells += n; save(); refreshChip()
  if (why && state.me) bubble(state.me, '+' + n + ' shells ' + why)
}
export function addWarmth(n) {
  const before = myTitle()
  P.warmth += Math.max(0, n | 0); save(); refreshChip()
  const after = myTitle()
  if (after !== before && state.me) {
    bubble(state.me, 'warmth rises: you are now ' + after + '!')
    playChirp('wave')
    if (state.me.tag) state.me.tag.userData.draw(state.myName, after)
  }
}

// ---------------------------------------------------------------------------
// fishing journal: keyed by species (fish noun), tracks count / best / golden
// ---------------------------------------------------------------------------
export function recordCatch(fish) {
  const species = fish.name.split(' ').pop()
  let row = P.journal[species]
  const isNew = !row
  if (!row) row = P.journal[species] = { n: 0, best: 0, gold: 0 }
  row.n++
  if (fish.len > row.best) row.best = fish.len
  if (fish.golden) row.gold = 1
  const shells = Math.max(1, Math.ceil(fish.len / 10)) * (fish.golden ? 5 : 1)
  P.shells += shells
  P.warmth += 2   // a catch warms the whole fire
  save(); refreshChip(); refreshJournal()
  return { shells, isNew }
}

function refreshJournal() {
  if (!journalEl || journalEl.style.display === 'none') return
  const rows = Object.entries(P.journal).sort((a, b) => b[1].best - a[1].best)
  journalEl.innerHTML = '<b>fishing journal</b> · ' + rows.length + ' species<br>' +
    (rows.length ? rows.map(([sp, r]) =>
      esc(sp) + ' <span class="dim">x' + r.n + '</span> · best ' + r.best + 'cm' + (r.gold ? ' <span class="gold">golden!</span>' : '')
    ).join('<br>') : '<span class="dim">cast a line at the shore (F)...</span>')
}

// ---------------------------------------------------------------------------
// The rack previews freely. Only the explicit purchase action spends shells.
// ---------------------------------------------------------------------------
export function ownHat(id) { if (id >= 0 && !P.owned.includes(id)) { P.owned.push(id); save() } }
export function hatQuote(id) {
  const owned=P.owned.includes(id),price=HAT_PRICES[id]??Infinity
  return {owned,price,shells:P.shells,affordable:owned||P.shells>=price}
}
export function purchaseHat(id) {
  if(!Number.isInteger(id)||id<0||id>=HAT_COUNT)return false
  const quote=hatQuote(id)
  if(!quote.affordable)return false
  if(!quote.owned){P.shells-=quote.price;P.owned.push(id);save();refreshChip()}
  return true
}
// small earners with anti-spam cooldowns (shells stay scarce enough to matter)
let lastOllie = 0, lastPet = 0
export function ollieBonus() { const t = Date.now(); if (t - lastOllie > 15000) { lastOllie = t; addShells(1, 'for the ollie') } }
export function petBonus() { const t = Date.now(); if (t - lastPet > 30000) { lastPet = t; addShells(1, 'for the kindness') } }

// ---------------------------------------------------------------------------
// boot: HUD + journal panel + the warmth presence tick (+1/min near the fire;
// AFK by the fire is valid play, it's a campfire)
// ---------------------------------------------------------------------------
export function initProgress() {
  chipEl = document.createElement('div')
  chipEl.id = 'progress-chip'
  chipEl.title = 'J: fishing journal'
  document.body.appendChild(chipEl)
  journalEl = document.createElement('div')
  journalEl.id = 'progress-journal'
  document.body.appendChild(journalEl)
  refreshChip()
  const toggleJournal = () => { togglePanel('progress-journal'); refreshJournal() }
  document.addEventListener('campfire:panel-open',e=>{if(e.detail==='progress-journal')refreshJournal()})
  chipEl.addEventListener('click', toggleJournal)
  addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || '')) return
    if (e.code === 'KeyJ') toggleJournal()
  })
  setInterval(() => {
    const me = state.me
    if (me && Math.hypot(me.pos.x, me.pos.z) < 9) addWarmth(1)
  }, 60000)
}

// instrumentation (additive): harness reads/pokes the loop
window.__progress = () => ({ shells: P.shells, warmth: P.warmth, title: myTitle(), owned: [...P.owned], species: Object.keys(P.journal).length })
window.__grantShells = n => { P.shells += n | 0; save(); refreshChip(); return P.shells }
