// src/net/replication.js : the universal entity replication store. One brain
// for "things that exist for everyone" -- today that's remote players and NPC
// companions, sharing one Map (id -> record), one keeper election, and one
// remote-drive apply path. net.js only wires Trystero lanes into this file;
// main.js only reads storeValues() for its per-frame update loop.
//
// ENTITY RECORD: { id, kind:'player'|'npc', critter, name, seed, owned,
// lastHeard, lastSentTx, lastSentTz, lastSentNap, lastSentSit, lastSentAt }. Player records
// ('p:'+peerId) are the SAME object stored in state.js's `peers` Map (keyed by
// bare peerId) -- one object, two indexes, so peers.get(peerId).critter and
// storeValues() see identical state with zero sync work. NPC records
// ('n'+8 base36 chars, stable across host migration) also live in state.js's
// `npcs` array as bare Critter refs (soaktest/instrumentation expect that
// shape untouched).
//
// KEEPER ELECTION: keeper = lexicographic min of [selfId, ...connectedPeerIds].
// No network or null selfId -> you are keeper (solo behaves like local NPCs
// always did). Only the keeper spawns/despawns NPCs and runs their wander AI
// (wanderEnabled); director.js's candidate pool is wanderEnabled critters, so
// losing keepership silently retires a critter from vignettes with no
// director changes needed (see critter/director.js top comment).
//
// LIFECYCLE:
//  - boot: manageNPCs() runs immediately from startNPCs() -- solo behaves
//    exactly as before sync existed (NPCs appear instantly, nothing to wait
//    on). Two peers booting together may each independently spawn a full
//    company before discovering each other; manageNPCs' population trim
//    (below) despawns ANY excess NPC record, owned or not, so the race
//    reconciles within a couple of ticks instead of waiting out orphan adoption.
//  - losing keepership (a lower peerId joined): every owned NPC gets one final
//    snapshot, then owned=false, wanderEnabled=false, lastHeard=now (critter
//    stays alive, now driven remotely).
//  - defensive demotion: a snapshot for an id I own arriving from a lower
//    peerId demotes me (no final snapshot, just apply theirs); from a higher
//    peerId it's dropped, mine stands.
//  - orphan adoption: keeper adopts any remote NPC silent >5s (owner left or
//    crashed) -- owned=true, wanderEnabled=true, broadcast immediately. Keeps
//    identity (seed/name/position) across host migration instead of respawn.
//
// WIRE ('sync' lane, additive, extends the move/hello/chat/act contract in
// net.js): per-NPC snapshot { id, seed, n, x, z, tx, tz, f:{nap,sit,ht,sb} }, or a
// despawn { id, gone:1 }. x/z is a drift anchor; tx/tz (nullable) is the
// destination -- remotes walk there locally with their own gait, same
// philosophy as player sync. Triggers: destination changed since last send,
// >2s since last send (keepalive/liveness), a peer just joined (full-set
// catchup), or just-adopted. A malformed snapshot (no id/seed) is dropped,
// never thrown into the frame loop. A gone message disposes locally no matter
// who sent it or whether I thought I owned it (self-heals stuck ghosts).
import { peers, npcs } from '../state.js'
import { strSeed, withSeededRng, pick } from '../engine/rng.js'
import { critterMake } from '../critter/critter.js'
import { CRITTER_ARCHES } from '../critter/recipes.js'
import { makeTag, randomName } from '../critter/tags.js'
import { setHat, setRiding, HAT_COUNT } from '../critter/gear.js'
import { applyRemoteFishing } from '../fishing.js'
import { titleFor } from '../progress.js'

const ADOPT_MS = 5000
const KEEPALIVE_MS = 2000
const TARGET_COMPANY = 3
const MAX_NPC = 3

const store = new Map()          // id -> record (see header)
let selfIdRef = null
let sendSyncFn = null
const connectedPeers = new Set() // fed by net.js's room.onPeerJoin/onPeerLeave

export function setSelfId(id) { selfIdRef = id }
export function setSendSync(fn) { sendSyncFn = fn }
export function storeValues() { return store.values() }

// ---------------------------------------------------------------------------
// keeper election
// ---------------------------------------------------------------------------
export function isKeeper() {
  if (!selfIdRef) return true // solo / pre-connect / networking failed
  for (const id of connectedPeers) if (id < selfIdRef) return false
  return true
}

function demoteNpc(rec, sendFinal) {
  if (!rec.owned) return
  // clear nap BEFORE the final snapshot: the director never cleans up a critter
  // that lost wanderEnabled mid-nap-vignette, so without this the stale nap:1
  // would ride the final snapshot and stick to the NPC forever on every peer
  rec.critter.napping = false
  rec.critter.vignette = null
  rec.critter.__seat = null
  rec.critter.seatPose = false
  rec.critter.seated = false
  if (sendFinal) sendNpcNow(rec)
  rec.owned = false
  rec.critter.wanderEnabled = false
  rec.lastHeard = Date.now()
}

// safety net, called on every peer join/leave and every 1s tick: if I'm not
// keeper, nothing I own should still be simulating (idempotent, cheap)
function enforceKeeperInvariant() {
  if (isKeeper()) return
  for (const rec of store.values()) if (rec.kind === 'npc' && rec.owned) demoteNpc(rec, true)
}

export function peerJoined(peerId) {
  connectedPeers.add(peerId)
  enforceKeeperInvariant()
  // full-set catchup for the newcomer, mirroring what sendHello does for players
  for (const rec of store.values()) if ((rec.kind === 'npc' || rec.kind === 'guest') && rec.owned) sendNpcNow(rec)
}
export function peerLeft(peerId) {
  connectedPeers.delete(peerId) // can only promote-or-hold my keeper status, never demote
  enforceKeeperInvariant()      // cheap no-op guard
  // remote couch guests die with the peer that hosts their pads
  for (const rec of [...store.values()])
    if (rec.kind === 'guest' && !rec.owned && rec.ownerPeer === peerId) disposeNpc(rec)
}

// ---------------------------------------------------------------------------
// shared remote-drive apply path: players AND npcs walk to a broadcast
// position/destination through this exact function.
// ---------------------------------------------------------------------------
function remoteDrive(c, x, z, tx, tz) {
  const dx = x - c.pos.x, dz = z - c.pos.z
  if (dx * dx + dz * dz > 64) { c.pos.set(x, 0, z); c.vel.set(0, 0, 0); c.target = null } // desync snap
  if (tx != null) c.target = { x: tx, z: tz }
  else {
    const ex = x - c.pos.x, ez = z - c.pos.z
    // when already within 0.3 leave target UNTOUCHED (matching the OG player
    // path): nulling it here stutter-stops a mid-glide walk, since 90ms move
    // broadcasts often land within 0.3 while the critter still has a live
    // target; seekTarget self-clears on arrival anyway (critter.js d<0.3)
    if (ex * ex + ez * ez > 0.09) c.target = { x, z }
  }
}

// ---------------------------------------------------------------------------
// players: id 'p:'+peerId, kind 'player'. Record IS the peers Map value (one
// object, two indexes) so peers.get(peerId) keeps its exact {critter,name,
// seed,heading} shape/behavior (upsert/relabel/status text unchanged).
// ---------------------------------------------------------------------------
function upsertPeerEntity(peerId, d) {
  let p = peers.get(peerId)
  if (p) return { p, isNew: false }
  const seed = (d && d.seed != null) ? (d.seed >>> 0) : strSeed(peerId)
  const x = d && d.x != null ? +d.x : (Math.random() - 0.5) * 8
  const z = d && d.z != null ? +d.z : 6
  const c = critterMake(seed, x, z, d && d.h != null ? +d.h : 0)
  c.tag = makeTag((d && d.n) || peerId.slice(0, 4))
  c.group.add(c.tag)
  p = { id: 'p:' + peerId, kind: 'player', peerId, critter: c, name: (d && d.n) || null, seed, heading: d && d.h != null ? +d.h : 0 }
  peers.set(peerId, p)
  store.set(p.id, p)
  return { p, isNew: true }
}
// name + warmth title redraw together (title line under the name, v1.4)
const relabel = (p, n, wt) => {
  const title = wt != null ? titleFor(+wt) : p.title
  if ((n && p.name !== n) || title !== p.title) {
    if (n) p.name = n
    p.title = title
    p.critter.tag.userData.draw(p.name || '', p.title)
  }
}

// returns true the first time a peer is seen (net.js uses this to update status text)
export function onPlayerState(d, peerId) {
  const { p, isNew } = upsertPeerEntity(peerId, d)
  const c = p.critter
  if (d && d.x != null) remoteDrive(c, +d.x, +d.z, null, null) // players carry no tx/tz, same threshold as the OG onPeerState
  if (d && d.h != null) p.heading = +d.h
  relabel(p, d && d.n, d && d.wt)
  // v1.3 additive gear + fishing fields (absent on old clients: no-ops)
  if (d && d.ht != null) setHat(c, +d.ht)
  if (d && d.sb != null) setRiding(c, !!+d.sb)
  applyRemoteFishing(c, d)   // fs/bx/bz/fseed; absent fs clears
  return isNew
}

// returns true if a peer was actually removed (net.js uses this to update status text)
export function removePeerEntity(peerId) {
  const p = peers.get(peerId); if (!p) return false
  p.critter.dispose(); peers.delete(peerId); store.delete(p.id)
  return true
}

// ---------------------------------------------------------------------------
// NPC companions: fill the fire so a solo visitor is never alone; retire
// gracefully as real humans arrive. Only the keeper spawns/despawns/wanders
// them; everyone else renders them exactly like remote players (remoteDrive).
// ---------------------------------------------------------------------------

// guaranteed archetype diversity: NPCs cycle a shuffled arch list with serpent
// forced into slot 0. NPC seeds are broadcast (unlike the old local-only
// version) but the picking mechanism (reroll until the seeded rng lands the
// wanted arch) is unchanged so critterMake + the wire protocol stay untouched.
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
// id survives host migration: random at spawn, never derived from a peerId
const randomNpcId = () => { let s = ''; while (s.length < 8) s += Math.random().toString(36).slice(2); return 'n' + s.slice(0, 8) }

function newNpcRecord(id, kind, critter, name, seed, owned) {
  return { id, kind, critter, name, seed, owned, lastHeard: Date.now(), lastSentTx: undefined, lastSentTz: undefined, lastSentNap: undefined, lastSentSit: undefined, lastSentAt: 0 }
}

function spawnNpc() {
  const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 7
  const seed = seedForArch(nextNPCArch())
  const c = critterMake(seed, Math.cos(a) * r, Math.sin(a) * r)
  c.wanderEnabled = true
  const name = randomName()
  c.tag = makeTag(name)
  c.group.add(c.tag)
  if (Math.random() < 0.3) setHat(c, (Math.random() * HAT_COUNT) | 0)  // some companions dress up
  const rec = newNpcRecord(randomNpcId(), 'npc', c, name, seed, true)
  store.set(rec.id, rec)
  npcs.push(c)
}
function spawnRemoteNpc(d) {
  const seed = d.seed >>> 0
  const c = critterMake(seed, +d.x || 0, +d.z || 0)
  c.tag = makeTag(d.n || 'Guest')
  c.group.add(c.tag)
  // neither wanderEnabled nor controlled: driven purely by broadcast target,
  // same lane-isolation invariant remote players already rely on (director.js)
  const rec = newNpcRecord(d.id, 'npc', c, d.n || null, seed, false)
  store.set(rec.id, rec)
  npcs.push(c)
  return rec
}
function disposeNpc(rec) {
  rec.critter.dispose()
  const i = npcs.indexOf(rec.critter); if (i >= 0) npcs.splice(i, 1)
  store.delete(rec.id)
}
function despawnNpc(rec) {
  if (sendSyncFn) sendSyncFn({ id: rec.id, gone: 1 })
  disposeNpc(rec)
}

function manageNPCs() {
  if (!isKeeper()) return
  // couch guests (local or remote) are company too: NPCs retire as pads join
  let guestCount = 0
  for (const rec of store.values()) if (rec.kind === 'guest') guestCount++
  const want = Math.max(0, Math.min(MAX_NPC, TARGET_COMPANY - peers.size - guestCount))
  let total = 0
  const all = []
  for (const rec of store.values()) if (rec.kind === 'npc') { total++; all.push(rec) }
  while (total < want) { spawnNpc(); total++ }
  // trim ANY excess record, owned or not: the keeper is authoritative over
  // population count regardless of who currently simulates a given NPC (a
  // gone message is obeyed by everyone no matter who sent it, see onSyncMessage),
  // so a boot-race double-spawn collapses to the target count in one tick
  // instead of waiting out adoptOrphans()'s 5s silence timer first.
  while (total > want && all.length) { despawnNpc(all.pop()); total-- }
}

// silent remote guests are gone hosts, not orphans: dispose, never adopt.
// Runs on EVERY client (tick), keeper or not.
function sweepGuests() {
  const now = Date.now()
  for (const rec of [...store.values()])
    if (rec.kind === 'guest' && !rec.owned && (now - rec.lastHeard) > ADOPT_MS) disposeNpc(rec)
}

function adoptOrphans() {
  const now = Date.now()
  for (const rec of store.values()) {
    if (rec.kind === 'npc' && !rec.owned && (now - rec.lastHeard) > ADOPT_MS) {
      rec.owned = true
      rec.critter.wanderEnabled = true
      rec.critter.napping = false // adopted critters start awake: no vignette owns them, so nothing else would ever clear a wire-inherited nap
      if (rec.critter.seatPose) rec.critter.target = null
      rec.critter.seatPose = false
      rec.critter.seated = false
      rec.lastHeard = now
      sendNpcNow(rec) // broadcast immediately: just-adopted trigger
    }
  }
}

function npcSnapshot(rec) {
  const c = rec.critter, t = c.target
  const tx = t ? t.x : null, tz = t ? t.z : null, nap = c.napping ? 1 : 0, sit = c.vignette === 'sit' ? 1 : 0
  return { tx, tz, nap, sit, perch: c.seated ? 1 : 0 }
}
function sendNpcNow(rec) {
  if (!sendSyncFn) return
  const c = rec.critter, { tx, tz, nap, sit, perch } = npcSnapshot(rec)
  sendSyncFn({ id: rec.id, seed: rec.seed, n: rec.name, x: c.pos.x, z: c.pos.z, tx, tz, f: { nap, sit, perch, ht: c.hatId ?? -1, sb: c.riding ? 1 : 0 } })
  rec.lastSentTx = tx; rec.lastSentTz = tz; rec.lastSentNap = nap; rec.lastSentSit = sit; rec.lastSentAt = Date.now()
  rec.lastSentPerch = perch
}
function maybeBroadcast(rec) {
  const { tx, tz, nap, sit, perch } = npcSnapshot(rec)
  const changed = tx !== rec.lastSentTx || tz !== rec.lastSentTz || nap !== rec.lastSentNap || sit !== rec.lastSentSit || perch !== rec.lastSentPerch
  if (changed || (Date.now() - rec.lastSentAt) > KEEPALIVE_MS) sendNpcNow(rec)
}

function tick() {
  enforceKeeperInvariant()
  sweepGuests()
  if (isKeeper()) adoptOrphans()
  for (const rec of store.values()) if (rec.kind === 'npc' && rec.owned) maybeBroadcast(rec)
}

// ---------------------------------------------------------------------------
// couch guests (kind 'guest', id 'g'+8 chars): extra local pad players
// registered by src/coop.js. Full wire entities on the sync lane at a fast
// cadence (live movement), owned by their couch's client forever: never
// adopted, disposed on gone / owner-peer leave / >5s silence.
// ---------------------------------------------------------------------------
const GUEST_SEND_MS = 120
export function registerGuest(critter, name, seed) {
  const rec = newNpcRecord('g' + randomNpcId().slice(1), 'guest', critter, name, seed, true)
  store.set(rec.id, rec)
  sendNpcNow(rec)
  return rec.id
}
export function unregisterGuest(critter) {
  for (const rec of store.values())
    if (rec.kind === 'guest' && rec.owned && rec.critter === critter) { despawnNpc(rec); return }
}
function spawnRemoteGuest(d, peerId) {
  const seed = d.seed >>> 0
  const c = critterMake(seed, +d.x || 0, +d.z || 0)
  c.tag = makeTag(d.n || 'Guest')
  c.group.add(c.tag)
  const rec = newNpcRecord(d.id, 'guest', c, d.n || null, seed, false)
  rec.ownerPeer = peerId
  store.set(rec.id, rec)
  return rec
}
function guestTick() {
  for (const rec of store.values()) if (rec.kind === 'guest' && rec.owned) sendNpcNow(rec)
}

export function startNPCs() {
  setInterval(manageNPCs, 2500)
  setInterval(tick, 1000)
  setInterval(guestTick, GUEST_SEND_MS)
  manageNPCs()
}

// incoming 'sync' lane message: an NPC snapshot or a despawn
export function onSyncMessage(d, peerId) {
  if (!d || !d.id) return
  if (d.gone) { const rec = store.get(d.id); if (rec) disposeNpc(rec); return } // obey regardless of sender/ownership
  if (d.seed == null) return // malformed, drop defensively
  let rec = store.get(d.id)
  if (rec) {
    if (rec.owned) {
      if (rec.kind === 'guest') return // my couch, my guest: never demoted (ids are random, collisions unreal)
      if (selfIdRef && peerId && peerId < selfIdRef) demoteNpc(rec, false) // lower id wins: demote, fall through to apply theirs
      else return                                                          // higher id: ignore, mine stands
    }
    if (rec.kind === 'guest') rec.ownerPeer = peerId
  } else rec = d.id[0] === 'g' ? spawnRemoteGuest(d, peerId) : spawnRemoteNpc(d)
  remoteDrive(rec.critter, +d.x, +d.z, d.tx != null ? +d.tx : null, d.tz != null ? +d.tz : null)
  rec.critter.napping = !!(d.f && d.f.nap)
  rec.critter.seatPose = !!(d.f && d.f.sit)
  rec.critter.seated = !!(d.f && d.f.perch)
  if(rec.critter.seated) {rec.critter.pos.set(+d.x,0,+d.z);rec.critter.target=null;rec.critter.vel.set(0,0,0)}
  if (d.f && d.f.ht != null) setHat(rec.critter, +d.f.ht)
  if (d.f && d.f.sb != null) setRiding(rec.critter, !!+d.f.sb)
  rec.lastHeard = Date.now()
}

// ---------------------------------------------------------------------------
// instrumentation contract (verify harness depends on this exactly)
// ---------------------------------------------------------------------------
function entState() {
  const out = []
  for (const rec of store.values()) {
    const c = rec.critter, t = c.target
    out.push({
      id: rec.id, kind: rec.kind, name: rec.name || null, seed: rec.seed, owned: !!rec.owned,
      x: +c.pos.x.toFixed(2), z: +c.pos.z.toFixed(2),
      tx: t ? +t.x.toFixed(2) : null, tz: t ? +t.z.toFixed(2) : null,
      nap: c.napping ? 1 : 0,
      sit: c.vignette === 'sit' || c.seatPose ? 1 : 0,
      remoteSeat: !!c.seatPose,
      seated: !!c.seated,
    })
  }
  return out
}
window.__entState = entState
window.__isKeeper = isKeeper
