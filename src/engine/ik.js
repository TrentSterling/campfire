// src/engine/ik.js : 2-bone analytic IK (OG verbatim). Legs solve hip -> knee -> foot
// with a pole vector; degenerate poles fall back to a perpendicular basis.
import { clamp } from './rng.js'

export function solveIK(hip, target, l1, l2, pole, outKnee) {
  const dx = target.x - hip.x, dy = target.y - hip.y, dz = target.z - hip.z
  let dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (dl < 1e-5) { outKnee.set(hip.x, hip.y - l1, hip.z); return }
  const reach = clamp(dl, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
  const ax = dx / dl, ay = dy / dl, az = dz / dl
  const ca = clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1)
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca))
  // pole perpendicular to axis
  const pd = pole.x * ax + pole.y * ay + pole.z * az
  let px = pole.x - ax * pd, py = pole.y - ay * pd, pz = pole.z - az * pd
  let pl = Math.sqrt(px * px + py * py + pz * pz)
  if (pl < 1e-5) { px = -az; py = 0; pz = ax; pl = Math.sqrt(px * px + pz * pz) || 1 }
  px /= pl; py /= pl; pz /= pl
  outKnee.set(
    hip.x + ax * ca * l1 + px * sa * l1,
    hip.y + ay * ca * l1 + py * sa * l1,
    hip.z + az * ca * l1 + pz * sa * l1)
}
