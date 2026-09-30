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
import { rr, TAU, angleLerp } from '../engine/rng.js'
import { FIRE_R } from '../world/scene.js'
import { SEATS } from '../world/scatter.js'
import { nearestWalkable } from '../world/obstacles.js'

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
  // 1) social gaze: two idle NPCs near each other occasionally look at one another.
  // Kept short + rare (long cooldown, low weight): gaze parks wander() entirely
  // (Critter.wander() no-ops while c.vignette is set) so it must read as a quick
  // eye-contact beat, not the default idle state.
  {
    name: 'gaze', min: 2, cd: 12, weight: 0.6,
    find() {
      const p = idleNpcs(c => !c.gazeAt)
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 1; j < p.length; j++) {
          if (p[i].pos.distanceTo(p[j].pos) < 5) return [p[i], p[j]]
        }
      }
      return null
    },
    start(v) { v.dur = rr(1.5, 2.8) },
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

  // 2) nap pile: 2-3 idle NPCs near the fire get the same cluster point, settle, then release.
  // Long cooldown + low weight: this is the one vignette that goes fully still
  // (napping), so it needs to stay a rare flourish, not the resting state.
  {
    name: 'nap', min: 2, cd: 22, weight: 0.5,
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
      v.dur = rr(4, 7)
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

  // 2.5) sit: an idle NPC ambles to a free bench/stump seat and watches the
  // fire for a while. Uses the furniture (SEATS anchors from scatter.js) so the
  // benches read as seats, not decoration. Heading is steered directly toward
  // the firepit each tick (gazeAt only accepts live critters, so the same
  // angleLerp face-the-fire trick wander() uses is borrowed here).
  {
    name: 'sit', min: 1, cd: 9, weight: 0.9,
    find() {
      if (!SEATS.length) return null
      const p = idleNpcs(c => true)
      if (!p.length) return null
      // pick the idle NPC closest to any seat not already occupied by a critter
      let best = null
      for (const c of p) {
        for (const s of SEATS) {
          let taken = false
          for (const o of critters) {
            if (o !== c && (o.pos.x - s.x) ** 2 + (o.pos.z - s.z) ** 2 < 0.6) { taken = true; break }
          }
          if (taken) continue
          const d = (c.pos.x - s.x) ** 2 + (c.pos.z - s.z) ** 2
          if (!best || d < best.d) best = { c, s, d }
        }
      }
      if (!best) return null
      best.c.__seat = best.s
      return [best.c]
    },
    start(v) {
      v.dur = rr(7, 13)
      const c = v.cast[0], s = c.__seat
      const d=Math.hypot(s.x,s.z),r=Math.min(.36,Math.max(.18,c.bodyR*.55))
      v.approach=nearestWalkable({x:s.x-s.x/d*.85,z:s.z-s.z/d*.85},r)
      c.seated=false;c.__route=null;c.target=v.approach
    },
    tick(v, dt) {
      v.t = (v.t || 0) + dt
      const c = v.cast[0]
      try {
        if (!c.seated && !c.target && !c.__route?.length && c.speedN < 0.1 && c.__seat && Math.hypot(c.pos.x-v.approach.x,c.pos.z-v.approach.z)<.45) {
          c.pos.set(c.__seat.x,0,c.__seat.z);c.vel.set(0,0,0);c.seated=true
          v.rest=0
        }
        if (c.seated) {
          v.rest=(v.rest||0)+dt
          const fa = Math.atan2(-c.pos.x, -c.pos.z)   // face the firepit (origin)
          c.heading = angleLerp(c.heading, fa, Math.min(1, 2.5 * dt))
        }
      } catch (e) {}
      return v.rest>=v.dur || v.t>v.dur+12
    },
    end(v) {
      const c=v.cast[0],r=Math.min(.36,Math.max(.18,c.bodyR*.55))
      c.seated=false;c.__seat=null;c.__route=null;c.target=null;c.wanderTimer=.1
      const exit=nearestWalkable(v.approach || c.pos,r)
      if(exit)c.pos.set(exit.x,0,exit.z)
      if(c.legs)for(const leg of c.legs){leg.initd=false;leg.wasAirborne=true}
    },
  },

  // 3) tag: one idle NPC's target briefly becomes another's live position (a little chase).
  // Both sides move (the "it" chases, the other juke-flees every ~1s) so this
  // is the vignette that reads as the most motion -- kept frequent/high weight.
  // Bug fixed: originally only `a` (the chaser) ever got a target, so `b` stood
  // frozen the whole vignette (wander() no-ops while c.vignette is set).
  {
    name: 'tag', min: 2, cd: 8, weight: 1.0,
    find() {
      const p = idleNpcs(c => true)
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 1; j < p.length; j++) {
          if (p[i].pos.distanceTo(p[j].pos) < 6) return [p[i], p[j]]
        }
      }
      return null
    },
    start(v) { v.dur = rr(3, 5.5); v.fleeT = 0 },
    tick(v, dt) {
      v.t = (v.t || 0) + dt
      const [a, b] = v.cast
      try {
        a.target = { x: b.pos.x, z: b.pos.z }
        v.fleeT -= dt
        if (v.fleeT <= 0) {
          v.fleeT = rr(0.8, 1.4)
          const ang = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z) + rr(-0.6, 0.6)
          const r = rr(1.5, 3)
          let tx = b.pos.x + Math.sin(ang) * r, tz = b.pos.z + Math.cos(ang) * r
          const dd = Math.hypot(tx, tz)
          if (dd > 10) { tx *= 10 / dd; tz *= 10 / dd } // same island-ish leash wander() uses
          b.target = { x: tx, z: tz }
        }
      } catch (e) {}
      return v.t >= v.dur
    },
  },
]

export function releaseCompanion(c) {
  for(let i=director.active.length-1;i>=0;i--) {
    const v=director.active[i]
    if(!v.cast.includes(c))continue
    if(v.row.end)v.row.end({...v,cast:[c]})
    v.cast=v.cast.filter(actor=>actor!==c)
    if(v.cast.length<v.row.min)director.active.splice(i,1)
  }
  c.vignette=null;c.seated=false;c.__seat=null;c.__route=null;c.target=null;c.wanderTimer=.1
}
export function requestCompanionSeat(c,seat) {
  if(!c?.wanderEnabled||c.controlled||!seat)return false
  releaseCompanion(c)
  const row=VIGNETTES.find(row=>row.name==='sit'),v={row,cast:[c],t:0}
  c.__seat=seat;c.vignette='sit';row.start(v);director.active.push(v)
  return true
}

// called once per frame (see main.js wiring note at bottom of this file's report).
// Cheap: short-circuits to a no-op scan when nothing is eligible, defensive throughout
// so one bad critter field can never take down the render loop.
export function tickDirector(dt) {
  try {
    director.clock += dt
    for (let i = director.active.length - 1; i >= 0; i--) {
      const v = director.active[i]
      const before = v.cast
      v.cast = before.filter(c => c && critters.includes(c) && c.wanderEnabled && !c.controlled)
      // bug fix: a member dropped by the filter above (e.g. despawned mid-vignette)
      // used to keep its `vignette` claim forever since the cleanup below only
      // ever walked the post-filter cast -- clear it here so no critter can be
      // left permanently claimed (stuck refusing to wander) if this ever fires
      // on a still-live critter in the future.
      if (v.cast.length !== before.length) {
        for (const c of before) if (c && !v.cast.includes(c)) {
          try { if(v.row.end)v.row.end({...v,cast:[c]});c.vignette = null;c.seated=false;c.__seat=null;c.__route=null } catch (e) {}
        }
      }
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
