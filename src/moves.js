// src/moves.js : gamepad + action moves for the local critter (Lane A).
// Left stick = walk (camera-relative, OG radial deadzone), A/cross = jump-hop
// (walkers: ballistic jump; hoppers: bigHop dash; serpents: lunge; flyers: boost),
// B/circle or E = pet the nearest critter (OG reaction: puff 1.28, squash -2.2,
// gaze at the petter), X/square or Q = wave shimmy. Space = jump/hop.
// Also owns the ADDITIVE 'act' network payload {t:'hop'|'pet'|'wave', target?}:
// unknown act types are ignored (forward compatible), and the base
// move/hello/chat protocol is untouched. Solo mode: every send is null-guarded.
import * as THREE from 'three'
import { camera, GY } from './world/scene.js'
import { state, peers, critters } from './state.js'
import { net } from './net/net.js'
import { critterMakeArch } from './critter/critter.js'
import { makeTag, placeSprites, randomName } from './critter/tags.js'
import { playChirp, spawnDust } from './audio.js'

const PET_RANGE = 3.2

function nearestPettable() {
  const me = state.me
  let best = null, bd = PET_RANGE * PET_RANGE
  for (const c of critters) {
    if (c === me) continue
    const d = (c.pos.x - me.pos.x) ** 2 + (c.pos.z - me.pos.z) ** 2
    if (d < bd) { bd = d; best = c }
  }
  return best
}

function peerIdOf(critter) {
  for (const [id, p] of peers) if (p.critter === critter) return id
  return undefined
}

// ---------------------------------------------------------------------------
// the three moves (local + broadcast)
// ---------------------------------------------------------------------------
export function doJump() {
  const me = state.me; if (!me) return
  me.wantJump = true
  playChirp('hop')
  spawnDust(me.pos.x, GY, me.pos.z, 6, 0.22, 0.07, 0.5)
  if (net.sendAct) net.sendAct({ t: 'hop' })
}

export function doPet() {
  const me = state.me; if (!me) return
  const c = nearestPettable(); if (!c) return
  c.petBy(me)
  me.squashVel -= 0.8 // little petting bob on the petter too
  if (net.sendAct) net.sendAct({ t: 'pet', target: peerIdOf(c) })
}

export function doWave() {
  const me = state.me; if (!me) return
  me.wave()
  if (net.sendAct) net.sendAct({ t: 'wave' })
}

// receive side: a remote peer performed an act; mirror it on their critter.
// target (pet only) is a peerId; our own selfId means OUR critter got petted.
export function onPeerAct(d, peerId) {
  const p = peers.get(peerId); if (!p || !d) return
  const c = p.critter
  if (d.t === 'hop') {
    c.wantJump = true
    playChirp('hop')
    spawnDust(c.pos.x, GY, c.pos.z, 6, 0.22, 0.07, 0.5)
  }
  else if (d.t === 'wave') c.wave()
  else if (d.t === 'pet' && d.target != null) {
    let victim = null
    if (net.selfId && d.target === net.selfId) victim = state.me
    else { const tp = peers.get(d.target); victim = tp && tp.critter }
    if (victim) victim.petBy(c)
  }
  // unknown t: ignored on purpose (protocol is additive)
}

// ---------------------------------------------------------------------------
// keyboard: Space = jump/hop, E = pet, Q = wave (chat input stays untouched)
// ---------------------------------------------------------------------------
const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT'
addEventListener('keydown', e => {
  if (typing() || e.repeat) return
  if (e.code === 'Space') { e.preventDefault(); doJump() }
  else if (e.code === 'KeyE') doPet()
  else if (e.code === 'KeyQ') doWave()
})

// ---------------------------------------------------------------------------
// gamepad: polled every frame (runs AFTER player.js updateMovement so the stick
// overrides the keyboard's idle reset; released stick is re-zeroed by
// updateMovement on the next frame)
// ---------------------------------------------------------------------------
let prevButtons = []
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0)

export function updateMoves(dt) {
  // debug critters (window.__spawnArch) live outside npcs[] so manageNPCs
  // never retires them; they are updated here instead of in main.js
  for (const c of debugCritters) { c.update(dt); placeSprites(c) }
  const me = state.me; if (!me) return
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  let gp = null
  for (const p of pads) if (p && p.connected) { gp = p; break }
  if (!gp) { if (prevButtons.length) prevButtons = []; return }

  // left stick -> camera-relative run direction (radial deadzone, OG values)
  const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0
  const m = Math.hypot(lx, ly)
  let s = 0
  if (m > 0.18) s = Math.min(1, (m - 0.18) / 0.78) / m
  if (s > 0) {
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize()
    right.crossVectors(fwd, UP).normalize()
    state.autoTarget = null; state.followName = null // manual input overrides auto/follow
    me.controlled = true
    me.input.set((right.x * lx - fwd.x * ly) * s, 0, (right.z * lx - fwd.z * ly) * s)
    if (me.arch !== 'hopper') me.target = null // hoppers steer by their own hop targets
  }

  // buttons (edge-triggered): A = jump/hop, B = pet, X = wave
  const btn = i => !!(gp.buttons[i] && gp.buttons[i].pressed)
  const edge = i => btn(i) && !prevButtons[i]
  if (edge(0)) doJump()
  if (edge(1)) doPet()
  if (edge(2)) doWave()
  for (let i = 0; i < gp.buttons.length; i++) prevButtons[i] = btn(i)
}

// debug/test hook for the verify harness: spawn a forced archetype as a wandering
// NPC-like local critter (instrumentation, not part of the campfire API contract)
const debugCritters = []
window.__debugCritters = debugCritters
window.__spawnArch = (arch, x = 3, z = 3) => {
  const c = critterMakeArch(arch, x, z)
  c.wanderEnabled = true
  c.tag = makeTag(randomName())
  c.group.add(c.tag)
  debugCritters.push(c)
  return { arch: c.arch, id: c.id }
}
