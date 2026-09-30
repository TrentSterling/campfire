// src/coop.js : couch co-op. Up to 3 extra local players on gamepads share the
// screen with P1 (keyboard and/or the first pad). Any OTHER connected pad
// pressing A joins as a guest critter; Back/Select (button 8) leaves; pad
// disconnect leaves automatically. Guests are FULL wire entities: replication
// registers them as owned kind-'guest' records broadcast on the sync lane, so
// remote peers see all four of you at the fire (Trent's call: full entities).
//
// Pad ownership handshake (no import cycles): moves.js writes state.p1Pad
// (the pad index it drives P1 with) and skips pads in state.guestPads; this
// file owns state.guestPads and never touches state.p1Pad's pad.
// Camera: player.js frames the whole local group via localCritters().
import * as THREE from 'three'
import { camera } from './world/scene.js'
import { state, critters } from './state.js'
import { critterMake } from './critter/critter.js'
import { makeTag, randomName } from './critter/tags.js'
import { setRiding, setHat, HAT_COUNT } from './critter/gear.js'
import { registerGuest, unregisterGuest } from './net/replication.js'
import { playChirp, spawnDust } from './audio.js'
import { GY } from './world/scene.js'

const MAX_GUESTS = 3
const guests = []   // { pad, critter, prevButtons }
state.guestPads = new Set()

export const localCritters = () => [state.me, ...guests.map(g => g.critter)].filter(Boolean)

function joinGuest(padIndex) {
  if (guests.length >= MAX_GUESTS) return
  const me = state.me
  const a = Math.random() * Math.PI * 2
  const seed = (Math.random() * 1e9) | 0
  const c = critterMake(seed, me.pos.x + Math.sin(a) * 1.6, me.pos.z + Math.cos(a) * 1.6)
  const name = randomName()
  c.tag = makeTag(name)
  c.group.add(c.tag)
  if (Math.random() < 0.4) setHat(c, (Math.random() * HAT_COUNT) | 0)   // party guests arrive dressed
  registerGuest(c, name, seed)
  guests.push({ pad: padIndex, critter: c, prevButtons: [] })
  state.guestPads.add(padIndex)
  playChirp('pet')
  spawnDust(c.pos.x, GY, c.pos.z, 8, 0.3, 0.08, 0.6)
}

function leaveGuest(i) {
  const g = guests[i]
  state.guestPads.delete(g.pad)
  unregisterGuest(g.critter)   // sends {id, gone:1} + disposes
  guests.splice(i, 1)
}

// nearest pettable for a guest (moves.js's version is hardwired to state.me)
function petFrom(c) {
  let best = null, bd = 3.2 * 3.2
  for (const o of critters) {
    if (o === c) continue
    const d = (o.pos.x - c.pos.x) ** 2 + (o.pos.z - c.pos.z) ** 2
    if (d < bd) { bd = d; best = o }
  }
  if (best) { best.petBy(c); c.squashVel -= 0.8 }
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0)

export function updateCoop(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []

  // join scan: connected pads that are neither P1's pad nor an existing guest
  for (const p of pads) {
    if (!p || !p.connected || p.index === state.p1Pad || state.guestPads.has(p.index)) continue
    if (p.buttons[0] && p.buttons[0].pressed) joinGuest(p.index)
  }

  for (let i = guests.length - 1; i >= 0; i--) {
    const g = guests[i], c = g.critter
    if (g.pad < 0) continue   // harness guest (__coopJoin): driven by __coopMove targets, no pad
    const p = pads[g.pad]
    if (!p || !p.connected) { leaveGuest(i); continue }
    const btn = j => !!(p.buttons[j] && p.buttons[j].pressed)
    const edge = j => btn(j) && !g.prevButtons[j]
    if (edge(8)) { leaveGuest(i); continue }   // Back/Select bows out

    // left stick: camera-relative walk, same radial deadzone math as moves.js.
    // controlled only while steering so an idle guest can still be target-driven.
    const lx = p.axes[0] || 0, ly = p.axes[1] || 0
    const m = Math.hypot(lx, ly)
    let s = 0
    if (m > 0.18) s = Math.min(1, (m - 0.18) / 0.78) / m
    if (s > 0) {
      camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize()
      right.crossVectors(fwd, UP).normalize()
      c.controlled = true
      c.input.set((right.x * lx - fwd.x * ly) * s, 0, (right.z * lx - fwd.z * ly) * s)
      if (c.arch !== 'hopper') c.target = null
    } else { c.controlled = false; c.input.set(0, 0, 0) }

    if (edge(0)) {   // A: hop (+ ollie if riding)
      c.wantJump = true
      if (c.riding) c.boardSpin = 0.55
      playChirp('hop')
      spawnDust(c.pos.x, GY, c.pos.z, 6, 0.22, 0.07, 0.5)
    }
    if (edge(1)) petFrom(c)             // B: pet
    if (edge(2)) c.wave()               // X: wave
    if (edge(3)) setRiding(c, !c.riding) // Y: skateboard
    for (let j = 0; j < p.buttons.length; j++) g.prevButtons[j] = btn(j)
  }
}

// instrumentation (additive): headless harness joins/drives fake pad-less guests
window.__coopJoin = () => { joinGuest(-1 - guests.length); return guests.length }
window.__coopLeave = () => { if (guests.length) leaveGuest(guests.length - 1); return guests.length }
window.__coopMove = (i, x, z) => { const g = guests[i]; if (g) g.critter.target = { x: +x, z: +z } }
