// src/player.js : local input + camera. WASD/arrows write camera-relative input
// into the controlled critter (it integrates pos/vel/heading itself via
// seekTarget); mouse-drag orbits; auto-walk (campfire.moveTo) and follow
// (campfire.follow) feed critter.target when no manual input is held.
import * as THREE from 'three'
import { renderer, camera, GY } from './world/scene.js'
import { state, peers } from './state.js'
import { localCritters } from './coop.js'

const keys = {}
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')
addEventListener('keydown', e => { if (typing()) return; keys[e.key.toLowerCase()] = true })
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false })

// mouse-drag orbit. Default pitch sits ~17 degrees above horizon (OG's near-
// horizontal framing) so silhouettes and faces read instead of splayed top-downs.
let camYaw = 0.08, camPitch = 0.48, dragging = false, lastX = 0, lastY = 0
renderer.domElement.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY })
addEventListener('pointerup', () => dragging = false)
addEventListener('pointermove', e => {
  if (!dragging) return
  camYaw -= (e.clientX - lastX) * 0.006
  camPitch = Math.min(1.15, Math.max(0.22, camPitch - (e.clientY - lastY) * 0.005))
  lastX = e.clientX; lastY = e.clientY
})

// camera distance: OG framing (~8.8) by default, wheel-zoomable 6..18 so players
// can frame wide shots of the whole fire or push in close on faces
const ZOOM_MIN = 6, ZOOM_MAX = 18
let camDist = 12.5
export function setZoom(d) { d = +d; if (isFinite(d)) camDist = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, d)); return camDist }
export function getZoom() { return camDist }
renderer.domElement.addEventListener('wheel', e => { camDist = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camDist + e.deltaY * 0.01)) }, { passive: true })
addEventListener('blur', () => { for (const key of Object.keys(keys)) keys[key] = false; dragging = false })
document.addEventListener('focusin', () => { if (typing()) for (const key of Object.keys(keys)) keys[key] = false })

const camTarget = new THREE.Vector3()
export function updateCamera(dt) {
  // couch co-op: frame the whole local group (centroid + zoom out to fit the
  // spread); solo this degenerates to exactly the old me-follow camera
  const locals = localCritters()
  const me = state.me
  const nearFire = Math.max(0, 1 - Math.hypot(me.pos.x, me.pos.z) / 15)
  // Close zoom follows the player; centering the fire at six units pushed the
  // foreground avatar below the viewport and behind chat.
  const fireFocus=nearFire*.8*Math.min(1,Math.max(0,(camDist-6)/6.5))
  let cx = me.pos.x * (1 - fireFocus), cz = me.pos.z * (1 - fireFocus), dist = camDist
  if (innerWidth < 640) dist *= 1.18
  if (locals.length > 1) {
    cx = 0; cz = 0
    for (const c of locals) { cx += c.pos.x; cz += c.pos.z }
    cx /= locals.length; cz /= locals.length
    let spread = 0
    for (const c of locals) spread = Math.max(spread, Math.hypot(c.pos.x - cx, c.pos.z - cz))
    dist = Math.max(camDist, Math.min(26, spread * 2.1 + 7))
  }
  const ox = Math.sin(camYaw) * Math.cos(camPitch) * dist
  const oy = Math.sin(camPitch) * dist + 1.6
  const oz = Math.cos(camYaw) * Math.cos(camPitch) * dist
  camTarget.set(cx + ox, GY + oy, cz + oz)
  camera.position.lerp(camTarget, 1 - Math.pow(0.001, dt))
  camera.lookAt(cx, GY + 1.1, cz)
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), move = new THREE.Vector3()

function resolveFollow(name) {
  const me = state.me
  let best = null, bestD = Infinity
  for (const p of peers.values()) {
    if (name && (p.name || '').toLowerCase() !== name.toLowerCase()) continue
    const dx = p.critter.pos.x - me.pos.x, dz = p.critter.pos.z - me.pos.z
    const d = dx * dx + dz * dz
    if (d < bestD) { bestD = d; best = p.critter.pos }
  }
  return best
}

export function updateMovement(dt) {
  const me = state.me
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize()
  right.crossVectors(fwd, up).normalize()
  move.set(0, 0, 0)
  if (keys['w'] || keys['arrowup']) move.add(fwd)
  if (keys['s'] || keys['arrowdown']) move.sub(fwd)
  if (keys['d'] || keys['arrowright']) move.add(right)
  if (keys['a'] || keys['arrowleft']) move.sub(right)
  if (move.lengthSq() > 0.0001) {           // manual input always overrides auto/follow
    state.autoTarget = null; state.followName = null
    move.normalize()
    me.controlled = true
    me.input.set(move.x, 0, move.z)
    if (me.arch !== 'hopper') me.target = null // hoppers steer by their own hop targets
    return
  }
  me.controlled = false
  me.input.set(0, 0, 0)
  // auto-walk (moveTo) or follow a peer: both just feed critter.target
  if (state.followName !== null) {
    const g = resolveFollow(state.followName)
    if (g) {
      const dx = g.x - me.pos.x, dz = g.z - me.pos.z, d = Math.hypot(dx, dz)
      if (d > 2.4) me.target = { x: g.x - dx / d * 2.2, z: g.z - dz / d * 2.2 }
    }
  } else if (state.autoTarget) {
    if (Math.hypot(state.autoTarget.x - me.pos.x, state.autoTarget.z - me.pos.z) < 0.35) state.autoTarget = null
    else me.target = { x: state.autoTarget.x, z: state.autoTarget.z }
  }
}
