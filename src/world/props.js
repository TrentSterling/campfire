// src/world/props.js : static SDF blend-shell prop builders. Same toon + outline
// shader suite as the critters (CRIT_VSH_LOCAL path, 2 draw calls per shell).
// makeShell returns the live prim uniform arrays so scatter.js can animate
// canopy sway / cap wiggle by mutating them (OG updateTrees technique).
// Placement lives in ./scatter.js (imported by main.js for its side effect).
import * as THREE from 'three'
import { CRIT_MAXP, buildCritterGeo, CRIT_VSH_LOCAL, CRIT_FSH_BODY, CRIT_FSH_OUTLINE, sharedCritterUniforms } from '../engine/shaders.js'
import { CURVE } from './scene.js'

// build one blend-shell (body + outline mesh pair) from up to CRIT_MAXP prims.
// Returns { group, fA, fB, fC, fD, geo, count } - arrays are the LIVE uniform
// storage, so mutating fA/fB per frame moves prims (canopy sway, cap wiggle).
export function makeShell(prims, outlineHex) {
  const g = new THREE.Group()
  const n = prims.length
  if (n > CRIT_MAXP) console.warn('prop shell exceeds CRIT_MAXP prims:', n)
  const fA = new Float32Array(CRIT_MAXP * 4), fB = new Float32Array(CRIT_MAXP * 4), fC = new Float32Array(CRIT_MAXP * 4), fD = new Float32Array(CRIT_MAXP * 4)
  prims.forEach((pr, i) => {
    const o = i * 4
    fA[o] = pr.ka[0]; fA[o + 1] = pr.ka[1]; fA[o + 2] = pr.ka[2]; fA[o + 3] = pr.r1
    fB[o] = pr.kb[0]; fB[o + 1] = pr.kb[1]; fB[o + 2] = pr.kb[2]; fB[o + 3] = pr.r2
    fC[o] = pr.c[0]; fC[o + 1] = pr.c[1]; fC[o + 2] = pr.c[2]; fC[o + 3] = pr.k
    fD[o] = pr.gloss || 0.06; fD[o + 1] = 0; fD[o + 2] = pr.colorOnly ? 1 : 0
  })
  const geo = buildCritterGeo(prims)
  const uni = { uPrimA: { value: fA }, uPrimB: { value: fB }, uPrimC: { value: fC }, uPrimD: { value: fD }, uCount: { value: n }, uCurve: { value: CURVE }, uRim: { value: 0 }, ...sharedCritterUniforms }
  g.add(
    new THREE.Mesh(geo, new THREE.ShaderMaterial({ defines: { PRIM_COUNT: CRIT_MAXP }, vertexShader: CRIT_VSH_LOCAL, fragmentShader: CRIT_FSH_BODY, uniforms: { ...uni, uIso: { value: 0 } } })),
    new THREE.Mesh(geo, new THREE.ShaderMaterial({ defines: { PRIM_COUNT: CRIT_MAXP }, vertexShader: CRIT_VSH_LOCAL, fragmentShader: CRIT_FSH_OUTLINE, uniforms: { ...uni, uIso: { value: 0.012 }, uOutlineTint: { value: new THREE.Color(outlineHex) } }, side: THREE.BackSide }))
  )
  return { group: g, fA, fB, fC, fD, geo, count: n }
}

// static SDF blend-shell prop (rock / tree) - unchanged public surface
export function makeProp(prims, outlineHex) {
  return makeShell(prims, outlineHex).group
}
