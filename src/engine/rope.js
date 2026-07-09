// src/engine/rope.js : verlet ropes (OG verbatim). Tails, ears, antennae all use
// these; shape memory pulls toward quaternion-rotated rest dirs, 2 stiffen passes.
import * as THREE from 'three'
import { V } from './rng.js'

export function makeRope(nSegs, segLen, stiff, grav, restDirs) {
  const pts = [], prev = []
  for (let i = 0; i <= nSegs; i++) { pts.push(new THREE.Vector3()); prev.push(new THREE.Vector3()) }
  return { n: nSegs, segLen, stiff, grav, restDirs, pts, prev, init: false }
}

export function updateRope(rope, dt, rootX, rootY, rootZ, quat) {
  const { pts, prev, n, segLen, stiff, grav, restDirs } = rope
  if (!rope.init) {
    rope.init = true
    pts[0].set(rootX, rootY, rootZ)
    for (let i = 1; i <= n; i++) {
      V[0].copy(restDirs[i - 1]).applyQuaternion(quat).multiplyScalar(segLen)
      pts[i].copy(pts[i - 1]).add(V[0])
      prev[i].copy(pts[i])
    }
  }
  pts[0].set(rootX, rootY, rootZ)
  const damp = Math.max(0, 1 - 2.2 * dt)
  for (let i = 1; i <= n; i++) {
    const p = pts[i], pr = prev[i]
    const vx = (p.x - pr.x) * damp, vy = (p.y - pr.y) * damp, vz = (p.z - pr.z) * damp
    pr.copy(p)
    p.x += vx; p.y += vy - grav * dt * dt; p.z += vz
    // shape memory
    V[0].copy(restDirs[i - 1]).applyQuaternion(quat)
    V[1].copy(pts[i - 1]).addScaledVector(V[0], segLen)
    p.lerp(V[1], Math.min(1, stiff * dt))
  }
  for (let k = 0; k < 2; k++) {
    for (let i = 1; i <= n; i++) {
      V[0].subVectors(pts[i], pts[i - 1])
      const l = V[0].length() || 1e-6
      pts[i].copy(pts[i - 1]).addScaledVector(V[0], segLen / l)
    }
  }
}
