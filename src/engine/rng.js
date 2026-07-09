// src/engine/rng.js : OG utils verbatim. Seeded rng stream (mulberry32 swap via
// withSeededRng), rr/pick/clamp/lerp, string seeding, angle helpers, and the
// shared zero-GC scratch pools (V vectors, Q1/Q2 quats, E1 euler).
import * as THREE from 'three'

export const TAU = Math.PI * 2
export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let rng = Math.random            // swapped to a seeded stream while a recipe is generated
export const rand = () => rng()  // draw from the CURRENT stream (recipes/palettes use this)
export const rr = (a, b) => lerp(a, b, rng())
export const pick = arr => arr[(rng() * arr.length) | 0]

// deterministic factory support: run fn with rng = mulberry32(seed), then restore
export function withSeededRng(seed, fn) {
  const saved = rng
  rng = mulberry32(seed >>> 0)
  try { return fn() } finally { rng = saved }
}

export const strSeed = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

// scratch (zero-GC)
export const V = []; for (let i = 0; i < 16; i++) V.push(new THREE.Vector3())
export const Q1 = new THREE.Quaternion(), Q2 = new THREE.Quaternion()
export const E1 = new THREE.Euler()

export function angleLerp(a, b, t) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return a + d * t }
export function angleDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d }
