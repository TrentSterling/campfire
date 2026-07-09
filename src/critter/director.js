// src/critter/director.js : Lane D - Director AI, autonomous social behaviors for idle NPCs.
// Ported/trimmed from the OG critters vignette director (C:/trontstack/critters/index.html,
// see "autonomous ecology: a tiny vignette director" + tickDirector + VIGNETTES). The OG runs
// a data table of group behaviors that scan for idle critters, claim them via a `vignette`
// flag, write onto fields the Critter class already animates (target / gazeAt / gazeT /
// squashVel / napping), then release the claim after a timeout. This port keeps that shape
// but only ever touches fields that already exist on campfire's ported Critter (src/critter/
// critter.js) -- nothing new was added there.
//
// SAFETY / LANE ISOLATION: the candidate pool below is restricted to critters with
// `wanderEnabled === true` and `controlled === false`. In campfire only NPC companions
// (src/net/net.js spawnNPC) ever get wanderEnabled = true; the local player critter is
// `controlled = true` and network peer critters (src/net/net.js upsertPeer) are neither
// controlled nor wanderEnabled -- they're driven purely by broadcast `target` writes from
// onPeerState. So this pool can never include the human player or a remote peer. Critter.
// wander() already no-ops while `c.vignette` is truthy (`if (this.vignette) return`), which
// is exactly the guard the OG relies on to keep its own idle-retarget timer from clobbering
// a vignette's target -- so claiming a critter here (setting c.vignette) safely suspends its
// normal wander AI for the duration.
import { critters } from '../state.js'
import { rr, TAU } from '../engine/rng.js'
import { FIRE_R } from '../world/scene.js'

const director = { active: [], cool: new Map(), clock: 0 }

// idle/wandering local NPCs only; never mid-vignette already, never fast-moving.
function idleNpcs(pred) {
  const out = []
  try {
    for (const c of critters) {
      if (!c || !c.wanderEnabled || c.controlled || c.vignette) continue
      if (typeof c.speedN === 'number' && c.speedN > 0.35) continue
      if (pred && !pred(c)) continue
      out.push(c)
    }
  } catch (e) { /* a bad critter shouldn't kill the director */ }
  return out
}

const VIGNETTES = [
  // 1) social gaze: two idle NPCs near each other occasionally look at one another
  {
    name: 'gaze', min: 2, cd: 6, weight: 1.2,
    find() {
      const p = idleNpcs(c => !c.gazeAt)
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 1; j < p.length; j++) {
          if (p[i].pos.distanceTo(p[j].pos) < 5) return [p[i], p[j]]
        }
      }
      return null
    },
    start(v) { v.dur = rr(2.5, 5) },
    tick(v, dt) {
      v.t = (v.t || 0) + dt
      const [a, b] = v.cast
      try {
        if (!a.gazeAt) { a.gazeAt = b; a.gazeT = v.dur }
        if (!b.gazeAt && Math.random() < 0.5) { b.gazeAt = a; b.gazeT = v.dur * 0.7 }
      } catch (e) {}
      return v.t >= v.dur
    },
  },

  // 2) nap pile: 2-3 idle NPCs near the fire get the same cluster point, settle, then release
  {
    name: 'nap', min: 2, cd: 15, weight: 1.0,
    find() {
      const near = idleNpcs(c => Math.hypot(c.pos.x, c.pos.z) < FIRE_R + 6)
      return near.length >= 2 ? near.slice(0, 3) : null
    },
    start(v) {
      let cx = 0, cz = 0
      for (const c of v.cast) { cx += c.pos.x; cz += c.pos.z }
      cx /= v.cast.length; cz /= v.cast.length
      const d = Math.hypot(cx, cz)
      if (d < FIRE_R + 1.2) { const s = (FIRE_R + 1.2) / (d || 1); cx *= s; cz *= s }
      v.dur = rr(6, 11)
      v.cast.forEach((c, i) => {
        const a = (i / v.cast.length) * TAU
        try { c.target = { x: cx + Math.sin(a) * 0.35, z: cz + Math.cos(a) * 0.35 } } catch (e) {}
      })
    },
    tick(v, dt) {
      v.t = (v.t || 0) + dt
      for (const c of v.cast) {
        try { c.napping = !c.target && c.speedN < 0.1 } catch (e) {}
      }
      return v.t >= v.dur
    },
    end(v) { for (const c of v.cast) { try { c.napping = false } catch (e) {} } },
  },

  // 3) tag: one idle NPC's target briefly becomes another's live position (a little chase)
  {
    name: 'tag', min: 2, cd: 10, weight: 0.8,
    find() {
      const p = idleNpcs(c => true)
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 1; j < p.length; j++) {
          if (p[i].pos.distanceTo(p[j].pos) < 6) return [p[i], p[j]]
        }
      }
      return null
    },
    start(v) { v.dur = rr(4, 7) },
    tick(v, dt) {
      v.t = (v.t || 0) + dt
      const [a, b] = v.cast
      try { a.target = { x: b.pos.x, z: b.pos.z } } catch (e) {}
      return v.t >= v.dur
    },
  },
]

// called once per frame (see main.js wiring note at bottom of this file's report).
// Cheap: short-circuits to a no-op scan when nothing is eligible, defensive throughout
// so one bad critter field can never take down the render loop.
export function tickDirector(dt) {
  try {
    director.clock += dt
    for (let i = director.active.length - 1; i >= 0; i--) {
      const v = director.active[i]
      v.cast = v.cast.filter(c => c && critters.includes(c) && c.wanderEnabled && !c.controlled)
      const done = v.cast.length < v.row.min || v.row.tick(v, dt)
      if (done) {
        if (v.cast.length && v.row.end) { try { v.row.end(v) } catch (e) {} }
        for (const c of v.cast) { try { c.vignette = null } catch (e) {} }
        director.cool.set(v.row.name, director.clock + v.row.cd)
        director.active.splice(i, 1)
      }
    }
    // at most 2 vignettes running at once, matching the OG's pacing
    if (director.active.length < 2) {
      const opts = []
      for (const row of VIGNETTES) {
        if (director.clock < (director.cool.get(row.name) || 0)) continue
        let cast = null
        try { cast = row.find() } catch (e) { cast = null }
        if (cast && cast.length >= row.min) opts.push({ row, cast })
      }
      if (opts.length) {
        let tot = 0; for (const o of opts) tot += o.row.weight || 1
        let pick = Math.random() * tot, chosen = opts[0]
        for (const o of opts) { pick -= o.row.weight || 1; if (pick <= 0) { chosen = o; break } }
        const v = { row: chosen.row, cast: chosen.cast, t: 0 }
        for (const c of v.cast) { try { c.vignette = chosen.row.name } catch (e) {} }
        try { chosen.row.start(v) } catch (e) {}
        director.active.push(v)
      }
    }
  } catch (e) { /* director must never kill the frame loop */ }
}
