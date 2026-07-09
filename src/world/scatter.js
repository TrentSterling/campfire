// src/world/scatter.js : set dressing. Deterministic seeded meadow scatter (every
// client sees the same island) + ambient life, ported wholesale from the OG
// critters engine (Prop recipes: mushroom/flower/rock verbatim, updateTrees sway
// + wiggle, spawnMote/updateMotes pollen + leaf drift, butterflies + bees).
//
// Technique (honest accounting): every prop is an SDF blend-shell (same CRIT
// shader programs as the critters, 2 draw calls per shell). Big props (rocks,
// shore trees) stay one shell each. Tiny scatter (grass tufts, flowers,
// mushrooms, stones, stumps, bushes) is BATCHED: many mini-props' prims are
// packed into shared CRIT_MAXP-prim shells with world-space endpoints baked in,
// so 80+ ground plants cost ~9 shells (~18 draw calls) instead of ~170.
// Butterflies / bees / pollen motes are soft-textured sprites (no gl.POINTS).
import * as THREE from 'three'
import { makeShell } from './props.js'
import { scene, softCircleTexture, GY, ISLAND_R } from './scene.js'
import { CRIT_MAXP } from '../engine/shaders.js'
import { withSeededRng, rand, rr, pick, TAU } from '../engine/rng.js'

const SCATTER_SEED = 20260709        // fixed: identical island on every client
const S = 1.35                       // OG flora units -> campfire island scale

function hsl(h, s, l) { const c = new THREE.Color(); c.setHSL((((h % 360) + 360) % 360) / 360, s, l); return [c.r, c.g, c.b] }
const mrr = (a, b) => a + (b - a) * Math.random()   // runtime (non-synced) stream

// animated registry: trees sway, flower heads + mushroom caps wiggle (OG F4)
const flora = []          // { fA, fB, sway? , wiggle?, pollen? }
const flowerSpots = []    // {x,z} butterfly / bee destinations
let shellCount = 0

function addShellToScene(shell, worldBaked) {
  if (worldBaked) shell.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, GY + 1, 0), ISLAND_R + 8)
  scene.add(shell.group)
  shellCount++
  return shell
}

// ---------------------------------------------------------------------------
// Mini-prop recipes (prims in WORLD space, ready for batching). Flower /
// mushroom / stone are the OG Prop recipes verbatim, scaled by S.
// ---------------------------------------------------------------------------
function flowerPrims(x, z) {
  const prims = [], wiggle = [], heads = []
  const nStems = 2 + (rand() * 2 | 0)
  const stemColor = hsl(110, 0.35, 0.34)
  for (let i = 0; i < nStems; i++) {
    const a = rand() * TAU, rad = rr(0, 0.08) * S
    const sx = x + Math.sin(a) * rad, sz = z + Math.cos(a) * rad
    const h = rr(0.14, 0.24) * S
    prims.push({ ka: [sx, GY, sz], kb: [sx, GY + h, sz], r1: 0.02 * S, r2: 0.015 * S, c: stemColor, k: 0.03 * S, gloss: 0.08 })
    const hr = rr(0.055, 0.09) * S
    const headCol = hsl(rr(0, 360), 0.6, rr(0.6, 0.72))
    const headBaseY = GY + h + hr * 0.75
    const idx = prims.length
    prims.push({ ka: [sx, headBaseY, sz], kb: [sx, headBaseY + hr * 0.6, sz], r1: hr, r2: hr * 0.55, c: headCol, k: 0.045 * S, gloss: 0.2 })
    wiggle.push(idx); heads.push(idx)
  }
  flowerSpots.push({ x, z })
  return { prims, wiggle, heads }
}

function mushroomPrims(x, z) {
  const prims = [], wiggle = []
  const stemH = rr(0.2, 0.32) * S, stemR = rr(0.045, 0.06) * S
  prims.push({ ka: [x, GY, z], kb: [x, GY + stemH, z], r1: stemR, r2: stemR * 0.82, c: hsl(42, 0.28, 0.82), k: 0.03 * S, gloss: 0.08 })
  const capR = rr(0.15, 0.24) * S
  const cap = hsl(pick([6, 18, 30]), rr(0.45, 0.6), rr(0.42, 0.52))
  const capBaseY = GY + stemH + capR * 0.8      // wide end must sit ABOVE the stem tip
  const capI = prims.length
  prims.push({ ka: [x, capBaseY, z], kb: [x, capBaseY + capR * 0.7, z], r1: capR, r2: capR * 0.45, c: cap, k: 0.05 * S, gloss: 0.15 })
  wiggle.push(capI)
  const nSpots = 1 + (rand() < 0.5 ? 1 : 0)
  for (let i = 0; i < nSpots; i++) {          // white spot decals at the true cap radius
    const a = rand() * TAU, rad = capR * rr(0.78, 0.9)
    const sx = x + Math.sin(a) * rad, sz = z + Math.cos(a) * rad
    const sy = capBaseY + capR * rr(0, 0.12), sr = rr(0.06, 0.09) * S
    prims.push({ ka: [sx, sy, sz], kb: [sx, sy + 0.006, sz], r1: sr, r2: sr * 0.97, c: [1, 1, 1], k: 0.1, gloss: 0.1, colorOnly: 1 })
  }
  flowerSpots.push({ x, z })
  return { prims, wiggle, heads: [] }
}

function stonePrims(x, z) {                    // OG buildRock at pebble scale
  const prims = [], hue = rr(70, 100)
  const nBlob = 1 + (rand() * 2 | 0)
  for (let i = 0; i < nBlob; i++) {
    const a = rand() * TAU, rad = i === 0 ? 0 : rr(0.08, 0.18)
    const bx = x + Math.sin(a) * rad, bz = z + Math.cos(a) * rad
    const r = rr(0.11, 0.2), by = GY - r * rr(0.3, 0.4)
    prims.push({ ka: [bx, by, bz], kb: [bx, by + 0.02, bz], r1: r, r2: r * 0.97, c: hsl(hue + rr(-8, 8), rr(0.12, 0.22), rr(0.42, 0.55)), k: 0.16, gloss: 0.06 })
  }
  return { prims, wiggle: [], heads: [] }
}

function grassPrims(x, z) {                    // OG-style recipe: 4 leaning blades
  const prims = [], hue = rr(95, 130)
  for (let b = 0; b < 4; b++) {
    const a = rand() * TAU, rad = rr(0.02, 0.09)
    const sx = x + Math.sin(a) * rad, sz = z + Math.cos(a) * rad
    const h = rr(0.22, 0.45), lean = rr(0.05, 0.16), la = rand() * TAU
    prims.push({
      ka: [sx, GY - 0.02, sz], kb: [sx + Math.sin(la) * lean, GY + h, sz + Math.cos(la) * lean],
      r1: 0.03, r2: 0.008, c: hsl(hue + rr(-8, 8), rr(0.35, 0.5), rr(0.28, 0.42)), k: 0.02, gloss: 0.05,
    })
  }
  return { prims, wiggle: [], heads: [] }
}

function stumpPrims(x, z) {
  const prims = [], h = rr(0.24, 0.36)
  prims.push({ ka: [x, GY - 0.08, z], kb: [x, GY + h, z], r1: 0.34, r2: 0.26, c: hsl(rr(30, 55), 0.28, rr(0.2, 0.28)), k: 0.06, gloss: 0.06 })
  prims.push({ ka: [x, GY + h + 0.02, z], kb: [x, GY + h + 0.03, z], r1: 0.22, r2: 0.21, c: hsl(45, 0.32, 0.58), k: 0.05, gloss: 0.1, colorOnly: 1 })
  return { prims, wiggle: [], heads: [] }
}

function benchPrims(x, z, yaw) {   // camp furniture: a fallen-log seat by the fire
  const prims = []
  const woodC = hsl(rr(26, 40), 0.32, rr(0.26, 0.32)), barkC = hsl(30, 0.3, 0.17)
  const L = rr(1.0, 1.25) * S, R = 0.17 * S
  const tx = Math.sin(yaw), tz = Math.cos(yaw)
  const y = GY + R + 0.05
  prims.push({ ka: [x - tx * L, y, z - tz * L], kb: [x + tx * L, y + 0.02, z + tz * L], r1: R, r2: R * 0.92, c: woodC, k: 0.05 * S, gloss: 0.1 })
  prims.push({ ka: [x - tx * (L + 0.02), y, z - tz * (L + 0.02)], kb: [x - tx * (L + 0.04), y, z - tz * (L + 0.04)], r1: R * 0.8, r2: R * 0.76, c: hsl(42, 0.3, 0.5), k: 0.03, gloss: 0.12, colorOnly: 1 })
  for (const s of [-0.55, 0.55]) {
    prims.push({ ka: [x + tx * L * s, GY + 0.04, z + tz * L * s], kb: [x + tx * L * s, GY + 0.1, z + tz * L * s], r1: R * 0.55, r2: R * 0.5, c: barkC, k: 0.04 * S, gloss: 0.06 })
  }
  return { prims, wiggle: [], heads: [] }
}

function bushPrims(x, z) {
  const prims = [], leafHue = rr(96, 132)
  const n = 2 + (rand() * 2 | 0)
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU, rad = i === 0 ? 0 : rr(0.2, 0.45)
    const bx = x + Math.sin(a) * rad, bz = z + Math.cos(a) * rad
    const r = rr(0.32, 0.55)
    prims.push({ ka: [bx, GY + r * 0.5, bz], kb: [bx, GY + r * 0.5 + 0.04, bz], r1: r, r2: r * 0.95, c: hsl(leafHue + rr(-10, 10), rr(0.38, 0.52), rr(0.3, 0.42)), k: 0.3, gloss: 0.1 })
  }
  return { prims, wiggle: [], heads: [] }
}

// pack mini-props into shared shells (<= CRIT_MAXP prims each), keep wiggle refs
function buildBatches(minis, outlineHex) {
  let prims = [], wig = [], pol = []
  const flush = () => {
    if (!prims.length) return
    const shell = addShellToScene(makeShell(prims, outlineHex), true)
    if (wig.length || pol.length) flora.push({
      fA: shell.fA, fB: shell.fB,
      wiggle: wig.map(i => ({ i, bx: shell.fA[i * 4], bz: shell.fA[i * 4 + 2], phase: mrr(0, TAU) })),
      pollen: pol.map(i => ({ i, t: mrr(3, 10) })),
    })
    prims = []; wig = []; pol = []
  }
  for (const m of minis) {
    if (prims.length + m.prims.length > CRIT_MAXP) flush()
    const base = prims.length
    prims.push(...m.prims)
    for (const w of m.wiggle) wig.push(base + w)
    for (const h of m.heads) pol.push(base + h)
  }
  flush()
}

// ---------------------------------------------------------------------------
// Deterministic scatter (fixed seed -> same island for every peer). Layout:
// clearing kept prop-free near the firepit (r < ~4.2), grass + flower meadow
// ring through the walkable band, mushrooms clustered near rocks and trees,
// stumps + bushes toward the shore, big trees ringing the water line.
// ---------------------------------------------------------------------------
withSeededRng(SCATTER_SEED, () => {
  const anchors = []   // rock + tree spots, for mushroom clustering

  // big rocks (recipe unchanged from the first campfire pass, now seeded)
  const rockC = [0.24, 0.26, 0.36], rockC2 = [0.19, 0.21, 0.3]
  for (let i = 0; i < 7; i++) {
    const a = rand() * TAU, r = ISLAND_R * (0.5 + rand() * 0.36), s = 0.6 + rand() * 0.5
    const rp = [
      { ka: [0, 0.45 * s, 0], kb: [0, 0.55 * s, 0.04 * s], r1: 0.5 * s, r2: 0.46 * s, c: rockC, k: 0.22 * s, gloss: 0.04 },
      { ka: [0.38 * s, 0.28 * s, 0.08 * s], kb: [0.42 * s, 0.36 * s, 0.1 * s], r1: 0.36 * s, r2: 0.3 * s, c: rockC, k: 0.22 * s, gloss: 0.04 },
      { ka: [-0.28 * s, 0.3 * s, -0.06 * s], kb: [-0.22 * s, 0.4 * s, -0.02 * s], r1: 0.32 * s, r2: 0.28 * s, c: rockC2, k: 0.22 * s, gloss: 0.04 },
    ]
    const rock = addShellToScene(makeShell(rp, 0x0e1018), false).group
    rock.position.set(Math.cos(a) * r, 1.0, Math.sin(a) * r); rock.rotation.y = rand() * Math.PI
    anchors.push({ x: rock.position.x, z: rock.position.z, pad: 1.2 * s })
  }

  // shore trees (recipe unchanged, now seeded) + OG canopy sway registration
  const trunkC = [0.4, 0.28, 0.17], grnA = [0.26, 0.5, 0.28], grnB = [0.22, 0.44, 0.26]
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.4, r = ISLAND_R + 0.6 + rand() * 1.2, s = 0.9 + rand() * 0.4
    const tp = [
      { ka: [0, 0, 0], kb: [0, 1.4 * s, 0], r1: 0.26 * s, r2: 0.3 * s, c: trunkC, k: 0.18, gloss: 0.06 },
      { ka: [0, 1.85 * s, 0], kb: [0, 2.0 * s, 0], r1: 0.92 * s, r2: 0.88 * s, c: grnA, k: 0.42, gloss: 0.1 },
      { ka: [0.32 * s, 2.45 * s, 0.08 * s], kb: [0.36 * s, 2.5 * s, 0.08 * s], r1: 0.58 * s, r2: 0.52 * s, c: grnB, k: 0.42, gloss: 0.1 },
      { ka: [-0.26 * s, 2.55 * s, -0.1 * s], kb: [-0.2 * s, 2.6 * s, -0.08 * s], r1: 0.5 * s, r2: 0.45 * s, c: grnA, k: 0.42, gloss: 0.1 },
    ]
    const shell = addShellToScene(makeShell(tp, 0x14200f), false)
    const tree = shell.group
    tree.position.set(Math.cos(a) * r, 0.8, Math.sin(a) * r); tree.rotation.y = rand() * Math.PI
    anchors.push({ x: tree.position.x, z: tree.position.z, pad: 1.6 })
    // OG updateTrees sway: trunk-top lean + per-blob ripple (local coords here,
    // amplitudes scaled ~1.8x because these canopies are ~2x the OG's)
    flora.push({
      fA: shell.fA, fB: shell.fB, amp: 1.8 * s,
      sway: {
        phase: mrr(0, TAU),
        trunk: { i: 0, tx: 0, tz: 0 },
        list: tp.slice(1).map((p, j) => ({ i: j + 1, bx: p.ka[0], bz: p.ka[2], phase: mrr(0, TAU) })),
      },
      leafWorld: tp.slice(1).map(p => {          // baked world canopy centers for leaf motes
        const cs = Math.cos(tree.rotation.y), sn = Math.sin(tree.rotation.y)
        return { x: tree.position.x + p.ka[0] * cs + p.ka[2] * sn, y: 0.8 + p.ka[1], z: tree.position.z - p.ka[0] * sn + p.ka[2] * cs }
      }),
      leafT: mrr(3, 6),
    })
  }

  // batched ground flora (world-space baked prims, shared shells)
  const grass = [], flowers = [], shrooms = [], stones = [], wood = []
  for (let i = 0; i < 48; i++) { const a = rand() * TAU, r = rr(4.2, 16.4); grass.push(grassPrims(Math.sin(a) * r, Math.cos(a) * r)) }
  for (let i = 0; i < 18; i++) { const a = rand() * TAU, r = rr(5, 15.5); flowers.push(flowerPrims(Math.sin(a) * r, Math.cos(a) * r)) }
  for (let i = 0; i < 9; i++) {                 // mushrooms cluster near rocks / trees
    const an = pick(anchors), a = rand() * TAU, d = an.pad + rr(0.3, 1.2)
    let mx = an.x + Math.sin(a) * d, mz = an.z + Math.cos(a) * d
    const rd = Math.hypot(mx, mz)
    if (rd > 17.2) { mx *= 17.2 / rd; mz *= 17.2 / rd }   // keep on the grass top
    shrooms.push(mushroomPrims(mx, mz))
  }
  for (let i = 0; i < 10; i++) { const a = rand() * TAU, r = rr(5, 16); stones.push(stonePrims(Math.sin(a) * r, Math.cos(a) * r)) }
  for (let i = 0; i < 3; i++) { const a = rand() * TAU, r = rr(9, 15); wood.push(stumpPrims(Math.sin(a) * r, Math.cos(a) * r)) }
  for (let i = 0; i < 5; i++) { const a = rand() * TAU, r = rr(12.5, 16.8); wood.push(bushPrims(Math.sin(a) * r, Math.cos(a) * r)) }
  // campfire furniture: log benches ringing the pit (gaps left for walking in),
  // plus a stump seat, so the fire reads as a hangout spot instead of open ground
  for (const a of [0.9, 2.9, 4.9]) {
    wood.push(benchPrims(Math.cos(a) * 3.8, Math.sin(a) * 3.8, a + Math.PI / 2 + rr(-0.12, 0.12)))
  }
  wood.push(stumpPrims(Math.cos(6.05) * 3.4, Math.sin(6.05) * 3.4))

  buildBatches(grass, 0x14260f)
  buildBatches(flowers, 0x243a1c)
  buildBatches(shrooms, 0x3a2015)
  buildBatches(stones, 0x2c332a)
  buildBatches(wood, 0x26331b)
})

console.log('[scatter] seed', SCATTER_SEED, ':', shellCount, 'blend-shells =', shellCount * 2,
  'prop draw calls (7 rocks + 9 trees individual, 48 grass + 18 flowers + 9 mushrooms + 10 stones + 3 stumps + 5 bushes batched)')

// ---------------------------------------------------------------------------
// Ambient meadow motes (OG spawnMote/updateMotes verbatim): pollen off flower
// heads, leaves drifting off tree canopies. Soft-circle sprites, alpha faded.
// ---------------------------------------------------------------------------
const moteTex = softCircleTexture(0.2)
const motePool = []
for (let i = 0; i < 40; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: moteTex, transparent: true, opacity: 0, depthWrite: false }))
  s.visible = false
  s.userData = { life: 0, dur: 1, size: 1, vy: 0, sway: 0, phase: 0 }
  scene.add(s)
  motePool.push(s)
}
let moteIdx = 0
function spawnMote(x, y, z, color, size, dur, vy, sway) {
  const s = motePool[moteIdx++ % motePool.length]
  s.material.color.set(color)
  s.position.set(x, y, z)
  const u = s.userData
  u.life = 0; u.dur = dur; u.size = size; u.vy = vy; u.sway = sway; u.phase = mrr(0, TAU)
  s.visible = true
}
function updateMotes(dt) {
  for (const s of motePool) {
    if (!s.visible) continue
    const u = s.userData; u.life += dt; const t = u.life / u.dur
    if (t >= 1) { s.visible = false; continue }
    u.phase += dt * 1.5
    s.position.y += u.vy * dt
    s.position.x += Math.sin(u.phase) * u.sway * dt
    s.position.z += Math.cos(u.phase * 0.8) * u.sway * dt
    const sc = u.size * (0.6 + Math.min(1, t * 3) * 0.4)
    s.scale.set(sc, sc, 1)
    s.material.opacity = (t < 0.15 ? t / 0.15 : (1 - t) / 0.85) * 0.7
  }
}

// ---------------------------------------------------------------------------
// Canopy sway + head/cap wiggle (OG updateTrees verbatim, adapted to the
// registry above), spawning leaf drift + pollen motes as it goes.
// ---------------------------------------------------------------------------
let propTime = 0
function updateFlora(dt) {
  propTime += dt
  for (const p of flora) {
    if (p.sway) {
      const ph = p.sway.phase, amp = p.amp
      const windX = (Math.sin(propTime * 0.5 + ph) * 0.10 + Math.sin(propTime * 0.32 + ph * 1.7) * 0.045) * amp
      const windZ = (Math.sin(propTime * 0.42 + ph + 1.3) * 0.08 + Math.sin(propTime * 0.27 + ph * 1.4) * 0.03) * amp
      const t = p.sway.trunk, to = t.i * 4
      p.fB[to] = t.tx + windX * 0.4; p.fB[to + 2] = t.tz + windZ * 0.4
      for (const s of p.sway.list) {
        const ripple = Math.sin(propTime * 1.8 + s.phase) * 0.03 * amp
        const rippleZ = Math.sin(propTime * 1.3 + s.phase * 1.4) * 0.02 * amp
        const nx = s.bx + windX + ripple, nz = s.bz + windZ * 0.7 + rippleZ
        const o = s.i * 4
        p.fA[o] = nx; p.fA[o + 2] = nz
        p.fB[o] = nx; p.fB[o + 2] = nz
      }
      p.leafT -= dt
      if (p.leafT <= 0) {
        p.leafT = mrr(4, 9)
        const lw = p.leafWorld[(Math.random() * p.leafWorld.length) | 0]
        spawnMote(lw.x, lw.y, lw.z, '#86ad4c', mrr(0.06, 0.1), mrr(3.5, 5.5), -0.32, 0.35)
      }
    } else {
      for (const s of p.wiggle) {
        const off = Math.sin(propTime * 1.1 + s.phase) * 0.018 * S
        const offZ = Math.sin(propTime * 0.8 + s.phase * 1.6) * 0.013 * S
        const nx = s.bx + off, nz = s.bz + offZ
        const o = s.i * 4
        p.fA[o] = nx; p.fA[o + 2] = nz
        p.fB[o] = nx; p.fB[o + 2] = nz
      }
      for (const h of p.pollen) {
        h.t -= dt
        if (h.t <= 0) {
          h.t = mrr(6, 14)   // slower than OG: campfire has ~45 flower heads, not ~5
          const o = h.i * 4
          spawnMote(p.fA[o], p.fA[o + 1], p.fA[o + 2], '#ffe6a0', mrr(0.035, 0.055), mrr(2.5, 4), 0.1, 0.28)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ambient butterflies + bees (OG verbatim): canvas-glyph sprites that flap via
// x-scale, drift between flowers / mushrooms, pause on them for a beat.
// ---------------------------------------------------------------------------
function glyphTex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')
  draw(g)
  return new THREE.CanvasTexture(c)
}
const butterflyTex = glyphTex(g => {
  g.translate(32, 32)
  g.fillStyle = '#ffffff'
  g.beginPath(); g.ellipse(-11, -2, 11, 16, -0.35, 0, TAU); g.fill()
  g.beginPath(); g.ellipse(11, -2, 11, 16, 0.35, 0, TAU); g.fill()
  g.beginPath(); g.ellipse(-9, 13, 8, 10, -0.2, 0, TAU); g.fill()
  g.beginPath(); g.ellipse(9, 13, 8, 10, 0.2, 0, TAU); g.fill()
  g.fillStyle = '#3a2f42'; g.beginPath(); g.ellipse(0, 2, 3, 17, 0, 0, TAU); g.fill()
})
const beeTex = glyphTex(g => {
  g.translate(32, 32)
  g.fillStyle = 'rgba(255,255,255,0.85)'
  g.beginPath(); g.ellipse(-10, -9, 8, 6, -0.4, 0, TAU); g.fill()
  g.beginPath(); g.ellipse(10, -9, 8, 6, 0.4, 0, TAU); g.fill()
  g.fillStyle = '#f2c94c'; g.beginPath(); g.ellipse(0, 4, 12, 16, 0, 0, TAU); g.fill()
  g.fillStyle = '#3a2f1a'; g.fillRect(-12, -2, 24, 4); g.fillRect(-11, 7, 22, 4)
})
const butterflies = []
function addFlutter(kind) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: kind === 'bee' ? beeTex : butterflyTex, transparent: true, opacity: 0.96, depthWrite: false }))
  if (kind === 'bee') s.material.color.set('#ffffff'); else s.material.color.setHSL(Math.random(), 0.55, 0.68)
  s.visible = false; scene.add(s)
  butterflies.push({
    spr: s, kind, pos: new THREE.Vector3(mrr(-8, 8), 0, mrr(-8, 8)), target: null, t: mrr(0, TAU), retarget: 0,
    h: kind === 'bee' ? mrr(0.3, 0.6) : mrr(0.5, 1.1), spd: kind === 'bee' ? 1.15 : 0.55,
    sz: kind === 'bee' ? 0.22 : 0.38, flap: kind === 'bee' ? 42 : 15, rest: 0,
  })
}
for (let i = 0; i < 4; i++) addFlutter('butterfly')
for (let i = 0; i < 2; i++) addFlutter('bee')
function updateButterflies(dt) {
  for (const b of butterflies) {
    b.t += dt
    if (b.rest > 0) { b.rest -= dt }   // pause on a flower for a beat
    else {
      b.retarget -= dt
      if (!b.target || b.retarget <= 0) {
        b.retarget = b.kind === 'bee' ? mrr(1.5, 3) : mrr(2.5, 5.5)
        if (flowerSpots.length && Math.random() < (b.kind === 'bee' ? 0.85 : 0.7)) {
          const f = flowerSpots[(Math.random() * flowerSpots.length) | 0]
          b.target = { x: f.x + mrr(-0.5, 0.5), z: f.z + mrr(-0.5, 0.5) }
        } else b.target = { x: mrr(-12, 12), z: mrr(-12, 12) }
      }
      const dx = b.target.x - b.pos.x, dz = b.target.z - b.pos.z, d = Math.hypot(dx, dz) || 1
      const step = Math.min(1, b.spd * dt / d)
      b.pos.x += dx * step; b.pos.z += dz * step
      if (d < 0.4) { b.target = null; b.rest = b.kind === 'bee' ? mrr(0.4, 1.0) : mrr(0.8, 2.2) }
    }
    const wob = b.kind === 'bee' ? 0.1 : 0.16
    b.spr.position.set(b.pos.x + Math.sin(b.t * 3.1) * wob, GY + b.h + Math.sin(b.t * (b.kind === 'bee' ? 4 : 2)) * 0.12, b.pos.z + Math.cos(b.t * 2.5) * wob)
    const base = b.sz
    b.spr.scale.set(base * (0.9 + 0.5 * Math.abs(Math.sin(b.t * b.flap))), base, 1)
    b.spr.visible = true
  }
}

// ---------------------------------------------------------------------------
// Self-driving ticker: registered at import time, so it runs before main.js's
// render callback each frame (rAF preserves registration order). Keeps the
// main loop untouched beyond the single import line.
// ---------------------------------------------------------------------------
// additive debug instrumentation (window.campfire and window.__frames untouched)
window.__scatter = {
  shells: () => shellCount,
  drawCalls: () => shellCount * 2,
  flutters: () => butterflies.filter(b => b.spr.visible).length,
  motes: () => motePool.filter(s => s.visible).length,
}

const clock = new THREE.Clock()
function tick() {
  requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)
  updateFlora(dt)
  updateMotes(dt)
  updateButterflies(dt)
}
requestAnimationFrame(tick)
