// src/critter/recipes.js : genRecipe (OG: biped/quadruped/multiped/hopper) + the
// archetype table + campfire pacing constants. Recipe generation runs inside a
// seeded rng stream (see critterMake) so every client builds identical critters.
import { rr, pick, rand, lerp } from '../engine/rng.js'
import { genPalette } from './palette.js'

export const CRITTER_ARCHES = ['quadruped', 'biped', 'hopper', 'multiped', 'serpent', 'flyer']

// Campfire pacing: the island is ~2x the OG meadow, so speeds/tempo scale up.
export const SPEED_K = 2.3, TEMPO_K = 1.8, HOP_K = 1.5

export function genRecipe(arch) {
  const hue = rand() * 360
  const palette = genPalette(hue)
  const size = rr(0.9, 1.3)
  const R = { archetype: arch, size, palette }

  if (arch === 'quadruped') {
    const bear = rand() < 0.25 // chunky, low-slung, slow-lumbering variant
    const len = bear ? rr(0.95, 1.2) : rr(0.85, 1.15)
    const r1 = bear ? rr(0.46, 0.56) : rr(0.33, 0.45)
    const legL = bear ? rr(0.24, 0.32) : rr(0.3, 0.42)
    R.body = { len, r1, r2: r1 * rr(bear ? 0.85 : 0.8, 1.0), y: legL * 2 * rr(0.82, 0.92), rearLift: rr(0, 0.1) }
    R.belly = [0, R.body.y - r1 * 0.5, 0.1, r1 * rr(0.6, 0.8)]
    R.head = { r: rr(0.22, 0.32) * (bear ? 1.12 : 1), len: rr(0.3, 0.5), neckY: R.body.y + r1 * rr(0.2, 0.45), neckZ: len / 2 - 0.05, neckLen: rr(0.1, 0.3), pitch: rr(-0.05, 0.15) }
    R.legs = { count: 4, l1: legL, l2: legL, thick: rr(0.11, 0.18) * (bear ? 1.35 : 1), footR: rr(0.08, 0.13) * (bear ? 1.25 : 1), k: 0.07, hipX: r1 * rr(0.5, 0.65), hipY: R.body.y - r1 * 0.3, hipZ0: len * 0.33, hipZ1: -len * 0.34, stanceX: r1 * rr(0.7, 0.9), stanceZ: 1.0, poleUp: 0 }
    if (rand() < 0.8) R.tail = { segs: 3, len: bear ? rr(0.2, 0.35) : rr(0.35, 0.65), r0: rr(0.07, 0.12), r1: 0.035, x: 0, y: R.body.y + 0.06, z: -len / 2 }
    const deco = rand()
    if (deco < 0.45) R.decos = [
      { frame: 'head', a: [-0.08, R.head.r * 0.7, 0], b: [-0.12, R.head.r * 0.7 + rr(0.1, 0.25), -0.05], r1: 0.055, r2: 0.035, color: 'base', k: 0.05 },
      { frame: 'head', a: [0.08, R.head.r * 0.7, 0], b: [0.12, R.head.r * 0.7 + rr(0.1, 0.25), -0.05], r1: 0.055, r2: 0.035, color: 'base', k: 0.05 },
    ]
    else if (deco < 0.7) R.decos = [
      { frame: 'body', a: [0, R.body.y + r1 * 0.8, 0], b: [0, R.body.y + r1 * 0.8 + rr(0.12, 0.25), -0.06], r1: 0.07, r2: 0.04, color: 'accent', k: 0.06 },
    ]
    if (rand() < 0.7) R.spots = [[-r1 * rr(0.3, 0.6), R.body.y + r1 * 0.55, -rr(0, 0.25), rr(0.08, 0.14)]]
    R.eyes = { count: rand() < 0.12 ? 1 : 2, r: rr(0.075, 0.105), spread: R.head.r * 0.6, y: R.head.r * 0.2, z: R.head.len * 0.42 }
    R.motion = bear ? { speed: rr(0.75, 1.05), tempo: rr(0.6, 0.8), bob: rr(0.06, 0.09) } : { speed: rr(1.2, 1.8), tempo: rr(0.9, 1.2), bob: rr(0.025, 0.05) }
  }
  else if (arch === 'multiped') {
    const count = pick([6, 8])
    const r1 = rr(0.32, 0.45), reach = rr(0.7, 0.95)
    R.body = { len: rr(0.4, 0.65), r1, r2: r1 * rr(0.75, 0.95), y: reach * rr(0.66, 0.78), rearLift: rr(0, 0.08), tilt: rr(-0.1, 0) }
    R.legs = { count, l1: reach * 0.52, l2: reach * 0.62, thick: rr(0.07, 0.11), footR: 0, k: 0.04, hipX: r1 * 0.72, hipY: R.body.y - r1 * 0.35, hipZ0: R.body.len * 0.45, hipZ1: -R.body.len * 0.5, stanceX: reach * rr(0.6, 0.75), stanceZ: rr(1.3, 1.8), poleUp: rr(1.8, 2.6), taper: true }
    // antennae: springy tipBall ear-ropes
    R.ears = { segs: 3, len: rr(0.3, 0.5), r0: 0.038, r1: 0.02, x: 0.1, y: R.body.y + r1 * 0.62, z: R.body.len * 0.3, out: 0.28, back: -0.25, stiff: 8, grav: 2.5, tipBall: rr(0.045, 0.07), accent: false }
    if (rand() < 0.8) R.spots = [[-0.12, R.body.y + r1 * 0.6, -0.1, rr(0.06, 0.1)], [0.1, R.body.y + r1 * 0.55, -0.18, rr(0.05, 0.09)]]
    R.eyes = { count: rand() < 0.15 ? 1 : 2, r: rr(0.08, 0.105), spread: r1 * 0.35, y: R.body.y + r1 * 0.35, z: R.body.len * 0.3 + r1 * 0.55 }
    R.motion = { speed: rr(1.5, 2.0), tempo: rr(1.3, 1.7), bob: 0.02 }
  }
  else if (arch === 'biped') {
    const legL = rr(0.2, 0.28)
    const y0 = legL * 2 * 0.9
    const r1 = Math.min(rr(0.28, 0.36), y0 - 0.11) // keep body bottom above the knees
    R.body = { upright: true, len: rr(0.38, 0.5), r1, r2: r1 * rr(0.65, 0.85), y: y0, topZ: rr(0, 0.05), tilt: rr(0, 0.08) }
    R.belly = [0, R.body.y + 0.1, r1 * 0.55, r1 * rr(0.5, 0.7)]
    R.legs = { count: 2, l1: legL, l2: legL, thick: rr(0.13, 0.17), footR: rr(0.09, 0.12), k: 0.08, hipX: r1 * rr(0.4, 0.5), hipY: legL * 2 * 0.82, hipZ0: 0, hipZ1: 0, stanceX: r1 * rr(0.45, 0.55), stanceZ: 1, poleUp: 0 }
    if (rand() < 0.85) R.arms = { x: r1 * 0.9, y: R.body.y + R.body.len * 0.6, z: 0.03, len: rr(0.22, 0.34), thick: rr(0.06, 0.09), handR: rr(0.06, 0.09) }
    R.ears = { segs: 2, len: rr(0.2, 0.42), r0: rr(0.04, 0.07), r1: 0.03, x: 0.11, y: R.body.y + R.body.len - 0.02, z: 0, out: rr(0.1, 0.35), back: -0.15, stiff: rr(5, 8), grav: rr(2, 4), tipBall: rand() < 0.5 ? rr(0.045, 0.06) : 0, accent: rand() < 0.5 }
    if (rand() < 0.5) R.spots = [[r1 * rr(0.4, 0.7), R.body.y + rr(0.05, 0.2), r1 * 0.4, rr(0.07, 0.11)]]
    R.eyes = { count: rand() < 0.15 ? 1 : 2, r: rr(0.085, 0.12), spread: r1 * rr(0.35, 0.45), y: R.body.y + R.body.len * rr(0.55, 0.75), z: r1 * rr(0.75, 0.85) }
    R.motion = { speed: rr(1.0, 1.5), tempo: rr(1.1, 1.4), bob: rr(0.02, 0.04) }
  }
  else if (arch === 'serpent') { // OG: chain body trailing the head's ground path
    const r0 = rr(0.24, 0.36) // ~1.4x the OG radii so it reads snake, not worm-prop
    R.body = { segs: 7 + (rand() * 4 | 0), r0, r1: r0 * rr(0.18, 0.32), len: rr(1.7, 2.6) }
    R.head = { r: r0 * rr(1.15, 1.45), len: rr(0.28, 0.4), neckY: r0 * 1.15, neckZ: 0.12, neckLen: rr(0.1, 0.2), pitch: rr(-0.1, 0.05), k: 0.16 }
    if (rand() < 0.5) R.decos = [ // little back fins behind the head
      { frame: 'head', a: [-0.07, R.head.r * 0.75, -0.02], b: [-0.1, R.head.r * 0.75 + rr(0.08, 0.18), -0.06], r1: 0.045, r2: 0.03, color: 'accent', k: 0.05 },
      { frame: 'head', a: [0.07, R.head.r * 0.75, -0.02], b: [0.1, R.head.r * 0.75 + rr(0.08, 0.18), -0.06], r1: 0.045, r2: 0.03, color: 'accent', k: 0.05 },
    ]
    R.eyes = { count: rand() < 0.12 ? 1 : 2, r: rr(0.075, 0.105), spread: R.head.r * 0.55, y: R.head.r * 0.25, z: R.head.len * 0.4 }
    R.motion = { speed: rr(1.2, 1.8), tempo: rr(0.9, 1.3), bob: 0 }
  }
  else if (arch === 'flyer') { // OG: hovering propeller-back blob
    const r1 = rr(0.3, 0.4)
    R.body = { upright: true, len: rr(0.4, 0.52), r1, r2: r1 * rr(0.6, 0.8), y: 0.3, topZ: rr(-0.05, 0) }
    R.belly = [0, 0.36, r1 * 0.55, r1 * rr(0.55, 0.7)]
    R.arms = { x: r1 * 0.9, y: 0.3 + R.body.len * rr(0.3, 0.5), z: 0.02, len: rr(0.16, 0.26), thick: rr(0.05, 0.07), handR: rr(0.05, 0.075) }
    R.decos = [ // dangling leg nubs
      { frame: 'body', a: [-r1 * 0.35, 0.16, 0.06], b: [-r1 * 0.38, 0.05, 0.08], r1: 0.07, r2: 0.05, color: 'limb', k: 0.08 },
      { frame: 'body', a: [r1 * 0.35, 0.16, 0.06], b: [r1 * 0.38, 0.05, 0.08], r1: 0.07, r2: 0.05, color: 'limb', k: 0.08 },
    ]
    R.propeller = { x: 0, y: 0.3 + R.body.len + rr(0, 0.05), z: -0.02, mastLen: rr(0.1, 0.16), bladeLen: rr(0.3, 0.45), hubR: rr(0.05, 0.07) }
    R.eyes = { count: rand() < 0.5 ? 1 : 2, r: rand() < 0.5 ? rr(0.13, 0.18) : rr(0.09, 0.11), spread: r1 * 0.38, y: 0.3 + R.body.len * rr(0.4, 0.55), z: r1 * rr(0.75, 0.88) }
    if (R.eyes.count === 1) R.eyes.spread = 0
    R.motion = { speed: rr(1.8, 2.4), tempo: 1, bob: 0 }
  }
  else { // hopper
    const r1 = rr(0.3, 0.4)
    R.body = { upright: true, len: rr(0.4, 0.52), r1, r2: r1 * rr(0.55, 0.75), y: r1 + 0.03, topZ: rr(-0.06, 0) }
    R.belly = [0, R.body.y + 0.06, r1 * 0.6, r1 * rr(0.55, 0.7)]
    // floppy ears: low stiffness, high gravity
    R.ears = { segs: 2, len: rr(0.3, 0.5), r0: rr(0.07, 0.11), r1: 0.045, x: 0.11, y: R.body.y + R.body.len - 0.02, z: -0.04, out: rr(0.2, 0.4), back: -0.2, stiff: rr(4, 6), grav: rr(4, 7), tipBall: 0, accent: false }
    R.decos = [
      { frame: 'body', a: [-r1 * 0.38, 0.1, r1 * 0.4], b: [-r1 * 0.38, 0.04, r1 * 0.45], r1: 0.07, r2: 0.06, color: 'dark', k: 0.09, gloss: 0.6 },
      { frame: 'body', a: [r1 * 0.38, 0.1, r1 * 0.4], b: [r1 * 0.38, 0.04, r1 * 0.45], r1: 0.07, r2: 0.06, color: 'dark', k: 0.09, gloss: 0.6 },
    ]
    if (rand() < 0.6) R.decos.push({ frame: 'body', a: [0, r1 + 0.05, -r1 - 0.02], b: [0, r1 + 0.1, -r1 - 0.06], r1: 0.08, r2: 0.06, color: 'base', k: 0.12 })
    if (rand() < 0.7) R.spots = [[r1 * rr(0.5, 0.7), R.body.y + rr(0, 0.15), r1 * 0.25, rr(0.08, 0.12)]]
    R.eyes = { count: rand() < 0.15 ? 1 : 2, r: rr(0.09, 0.115), spread: r1 * 0.4, y: R.body.y + R.body.len * 0.5, z: r1 * rr(0.72, 0.82) }
    R.motion = { hopLen: rr(1.2, 1.9), tempo: 1, bob: 0 }
  }

  // --- bonus decoration rolls (all archetypes, OG verbatim) ---
  R.decos = R.decos || []
  if (R.head && rand() < 0.15) { // horns
    const hl = rr(0.1, 0.24), hc = pick(['dark', 'accent', 'base'])
    R.decos.push(
      { frame: 'head', a: [-0.09, R.head.r * 0.62, -0.03], b: [-0.14, R.head.r * 0.62 + hl, -0.1], r1: 0.05, r2: 0.028, color: hc, k: 0.05 },
      { frame: 'head', a: [0.09, R.head.r * 0.62, -0.03], b: [0.14, R.head.r * 0.62 + hl, -0.1], r1: 0.05, r2: 0.028, color: hc, k: 0.05 })
  } else if (R.head && rand() < 0.12) { // head crest
    const nC = 2 + (rand() * 3 | 0), cr = rr(0.045, 0.075)
    for (let i = 0; i < nC; i++) {
      const z = R.head.len * (0.25 - 0.28 * i / Math.max(1, nC - 1))
      R.decos.push({ frame: 'head', a: [0, R.head.r * 0.8, z], b: [0, R.head.r * 0.8 + rr(0.06, 0.13), z - 0.02], r1: cr, r2: cr * 0.6, color: 'accent', k: 0.05 })
    }
  }
  if ((arch === 'quadruped' || arch === 'multiped') && rand() < 0.14) { // back spikes
    const nS = 3 + (rand() * 3 | 0), sc = pick(['dark', 'accent'])
    for (let i = 0; i < nS; i++) {
      const t = i / (nS - 1)
      const z = lerp(R.body.len * 0.38, -R.body.len * 0.42, t)
      const yTop = R.body.y + R.body.r1 * 0.8
      R.decos.push({ frame: 'body', a: [0, yTop, z], b: [0, yTop + rr(0.08, 0.15) * (1 - t * 0.4), z - 0.03], r1: 0.055, r2: 0.02, color: sc, k: 0.05 })
    }
  }
  if (rand() < 0.14) { // blush cheeks (color-only decals)
    const cheekC = [0.98, 0.55, 0.55], cr = rr(0.05, 0.08)
    if (R.head) R.decos.push(
      { frame: 'head', a: [-R.head.r * 0.74, -R.head.r * 0.15, R.head.len * 0.28], b: [-R.head.r * 0.76, -R.head.r * 0.15, R.head.len * 0.28], r1: cr, r2: cr * 0.97, color: cheekC, k: 0.06, colorOnly: 1, noOutline: 1 },
      { frame: 'head', a: [R.head.r * 0.74, -R.head.r * 0.15, R.head.len * 0.28], b: [R.head.r * 0.76, -R.head.r * 0.15, R.head.len * 0.28], r1: cr, r2: cr * 0.97, color: cheekC, k: 0.06, colorOnly: 1, noOutline: 1 })
    else if (R.eyes) R.decos.push(
      { frame: 'body', a: [-(R.eyes.spread + 0.11), R.eyes.y - 0.13, R.eyes.z * 0.9], b: [-(R.eyes.spread + 0.12), R.eyes.y - 0.13, R.eyes.z * 0.9], r1: cr, r2: cr * 0.97, color: cheekC, k: 0.06, colorOnly: 1, noOutline: 1 },
      { frame: 'body', a: [R.eyes.spread + 0.11, R.eyes.y - 0.13, R.eyes.z * 0.9], b: [R.eyes.spread + 0.12, R.eyes.y - 0.13, R.eyes.z * 0.9], r1: cr, r2: cr * 0.97, color: cheekC, k: 0.06, colorOnly: 1, noOutline: 1 })
  }
  if (!R.decos.length) delete R.decos

  // campfire pacing
  if (R.motion.speed) R.motion.speed *= SPEED_K
  if (R.motion.hopLen) R.motion.hopLen *= HOP_K
  R.motion.tempo *= TEMPO_K
  return R
}
