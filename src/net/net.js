// src/net/net.js : Trystero networking + NPC management. Resilient: the scene
// still runs if this fails (solo mode never crashes the page).
// PROTOCOL (do not break, extend additively only): move/hello payloads are
// {seed, n, x, z, h}; chat payloads are {n, text}. Remote critters are BUILT
// from the seed and WALK to the broadcast position with their own gait
// (target mode, no lerping).
import { state, peers, npcs } from '../state.js'
import { strSeed, withSeededRng, pick } from '../engine/rng.js'
import { critterMake } from '../critter/critter.js'
import { CRITTER_ARCHES } from '../critter/recipes.js'
import { makeTag, randomName } from '../critter/tags.js'

const statusEl = document.getElementById('status'), dotEl = document.getElementById('dot')
export function setStatus(txt, on) { statusEl.textContent = txt; dotEl.classList.toggle('on', !!on) }

// live send fns (null until connect succeeds); other modules read net.sendChat etc.
// sendAct + selfId: additive 'act' lane ({t:'hop'|'pet'|'wave', target?}, see src/moves.js)
export const net = { sendMove: null, sendHello: null, sendChat: null, sendAct: null, selfId: null }

// normalize Trystero makeAction across tuple-form and object-form APIs
function wireAction(room, id, handler) {
  const a = room.makeAction(id)
  if (Array.isArray(a)) { const [send, get] = a; get((data, peerId) => handler(data, peerId)); return send }
  a.onMessage = (data, meta) => handler(data, meta && meta.peerId); return a.send.bind(a)
}

function upsertPeer(peerId, d) {
  let p = peers.get(peerId)
  if (!p) {
    const seed = (d && d.seed != null) ? (d.seed >>> 0) : strSeed(peerId)
    const x = d && d.x != null ? +d.x : (Math.random() - 0.5) * 8
    const z = d && d.z != null ? +d.z : 6
    const c = critterMake(seed, x, z, d && d.h != null ? +d.h : 0)
    c.tag = makeTag((d && d.n) || peerId.slice(0, 4))
    c.group.add(c.tag)
    p = { critter: c, name: (d && d.n) || null, seed, heading: d && d.h != null ? +d.h : 0 }
    peers.set(peerId, p)
    setStatus(`${peers.size} here at the fire`, true)
  }
  return p
}
function removePeer(peerId) {
  const p = peers.get(peerId); if (!p) return
  p.critter.dispose(); peers.delete(peerId)
  setStatus(peers.size ? `${peers.size} here at the fire` : 'you have the fire to yourself', true)
}
const relabel = (p, n) => { if (n && p.name !== n) { p.name = n; p.critter.tag.userData.draw(n) } }

function onPeerState(d, peerId) {
  const p = upsertPeer(peerId, d)
  const c = p.critter
  if (d && d.x != null) {
    const dx = d.x - c.pos.x, dz = d.z - c.pos.z, d2 = dx * dx + dz * dz
    if (d2 > 64) { c.pos.set(+d.x, 0, +d.z); c.vel.set(0, 0, 0); c.target = null } // desync snap
    else if (d2 > 0.09) c.target = { x: +d.x, z: +d.z }                            // walk there
  }
  if (d && d.h != null) p.heading = +d.h
  relabel(p, d && d.n)
}

// onChat/onAct are injected by main.js (they live in net/api.js and moves.js)
// to avoid an import cycle
export async function connect({ onChat, onAct }) {
  try {
    const { joinRoom, selfId } = await import('trystero')
    const room = joinRoom({ appId: 'tront-campfire' }, 'main')
    setStatus('at the fire, waiting for company...', true)
    net.selfId = selfId

    net.sendMove = wireAction(room, 'move', onPeerState)
    net.sendHello = wireAction(room, 'hello', onPeerState)
    net.sendChat = wireAction(room, 'chat', (d, peerId) => onChat(peerId, d))
    if (onAct) net.sendAct = wireAction(room, 'act', (d, peerId) => onAct(d, peerId))

    const myState = () => ({ seed: state.mySeed, n: state.myName, x: state.me.pos.x, z: state.me.pos.z, h: state.me.heading })
    room.onPeerJoin = peerId => { net.sendHello(myState()) }
    room.onPeerLeave = peerId => removePeer(peerId)

    // heartbeat + throttled movement broadcast
    setInterval(() => { if (net.sendMove) net.sendMove(myState()) }, 90)
    console.log('[campfire] connected, selfId', selfId)
  } catch (err) {
    console.warn('[campfire] networking unavailable, running solo:', err)
    setStatus('solo by the fire (no network)', false)
  }
}

// ---------------------------------------------------------------------------
// NPC companions - fill the fire so a solo visitor is never alone; they retire
// gracefully as real humans arrive. Random archetype seeds + the OG wander AI.
// ---------------------------------------------------------------------------
const TARGET_COMPANY = 3
const MAX_NPC = 3

// Guaranteed archetype diversity: NPCs cycle a shuffled arch list with serpent
// forced into slot 0 (so a snake is always at the fire). NPC seeds are LOCAL
// ONLY (never broadcast), so rerolling random seeds until the seeded rng picks
// the wanted arch keeps critterMake and the {seed,n,x,z,h} protocol untouched.
let archQueue = []
function nextNPCArch() {
  if (!archQueue.length) {
    const rest = CRITTER_ARCHES.filter(a => a !== 'serpent')
    for (let i = rest.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = rest[i]; rest[i] = rest[j]; rest[j] = t }
    archQueue = ['serpent', ...rest]
  }
  return archQueue.shift()
}
function seedForArch(arch) {
  for (let t = 0; t < 800; t++) { // expected ~6 tries (uniform pick over 6 arches)
    const seed = (Math.random() * 1e9) | 0
    if (withSeededRng(seed, () => pick(CRITTER_ARCHES)) === arch) return seed
  }
  return (Math.random() * 1e9) | 0 // statistically unreachable fallback
}
function spawnNPC() {
  const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 7
  const c = critterMake(seedForArch(nextNPCArch()), Math.cos(a) * r, Math.sin(a) * r)
  c.wanderEnabled = true
  c.tag = makeTag(randomName())
  c.group.add(c.tag)
  npcs.push(c)
}
export function manageNPCs() {
  const want = Math.max(0, Math.min(MAX_NPC, TARGET_COMPANY - peers.size))
  while (npcs.length < want) spawnNPC()
  while (npcs.length > want) { const c = npcs.pop(); if (c) c.dispose() }
}
export function startNPCs() {
  setInterval(manageNPCs, 2500)
  manageNPCs()
}
