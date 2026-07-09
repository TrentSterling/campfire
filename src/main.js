// src/main.js : boot + frame loop + wiring. Creates the local player critter,
// starts networking + NPCs, and runs the render loop. Owns the instrumentation
// contract (window.__frames, window.__peers) that the verify harness reads;
// window.campfire itself is installed by ./net/api.js. No domain logic here.
import * as THREE from 'three'
import { renderer, scene, camera, updateWorld } from './world/scene.js'
import './world/scatter.js'                        // side effect: seeded meadow scatter + ambient life (Lane B)
import { critterMake } from './critter/critter.js'
import { makeTag, placeSprites } from './critter/tags.js'
import { state, peers, npcs } from './state.js'
import { angleLerp } from './engine/rng.js'
import { updateMovement, updateCamera } from './player.js'
import { connect, startNPCs } from './net/net.js'
import { updateMoves, onPeerAct } from './moves.js' // gamepad + jump/pet/wave moves
import { onChat } from './net/api.js'              // side effect: chat UI + window.campfire
import { getOrCreateIdentity, saveIdentity, initIdentityUI } from './identity.js' // Lane A: persistent identity
import { isTouchDevice, initTouchControls, update as updateTouch } from './touch.js' // Lane B: mobile joystick + buttons
import { initAudio, update as updateAudio } from './audio.js'                        // Lane C: fire crackle + chirps + dust
import { tickDirector } from './critter/director.js'                                 // Lane D: idle NPC social vignettes

// ---------------------------------------------------------------------------
// Local player: a controlled critter (WASD writes critter.input, camera-relative;
// the critter integrates pos/vel/heading itself via seekTarget). Identity (seed +
// name) is persisted across reloads (Lane A) so a returning player keeps the same
// critter recipe/palette and display name instead of rerolling every visit.
// ---------------------------------------------------------------------------
const { seed, name } = getOrCreateIdentity()
state.mySeed = seed
state.myName = name
const me = state.me = critterMake(state.mySeed, (Math.random() - 0.5) * 8, 6 + Math.random() * 3, Math.PI)
me.tag = makeTag(state.myName)
me.tag.userData.own = true          // your own tag renders dimmed (you know who you are)
me.group.add(me.tag)
// touch users get joystick/button instructions instead of WASD/Space/E/Q (which
// don't apply on a phone); net/api.js's setMyName mirrors this same ternary so a
// rename doesn't revert the hint to desktop-only copy.
document.querySelector('.hint').innerHTML = 'you are <b style="color:#ffd39b">' + state.myName + '</b> &nbsp;·&nbsp; ' +
  (isTouchDevice ? 'joystick to walk · buttons to hop/pet/wave · drag to look' : 'WASD walk · Space hop · E pet · Q wave · drag to look · gamepad works')

// bottom-right "click to rename" affordance; persists the rename back to localStorage
initIdentityUI(() => state.myName, newName => {
  window.campfire.setName(newName)
  saveIdentity(state.mySeed, newName)
})

initAudio() // suspended AudioContext; self-unlocks on first pointerdown/keydown

// touch/mobile: virtual joystick (bottom-left) + hop/pet/wave buttons (bottom-right).
// No-op (zero DOM) on non-touch devices. onMove mirrors moves.js's gamepad stick math.
const touchFwd = new THREE.Vector3(), touchRight = new THREE.Vector3(), touchUp = new THREE.Vector3(0, 1, 0)
initTouchControls({
  onMove: (x, z) => {
    camera.getWorldDirection(touchFwd); touchFwd.y = 0; touchFwd.normalize()
    touchRight.crossVectors(touchFwd, touchUp).normalize()
    state.autoTarget = null; state.followName = null
    me.controlled = true
    me.input.set(touchRight.x * x - touchFwd.x * z, 0, touchRight.z * x - touchFwd.z * z)
    if (me.arch !== 'hopper') me.target = null
  },
  onHop: () => window.campfire.hop(),
  onPet: () => window.campfire.pet(),
  onWave: () => window.campfire.wave(),
})
// avoid the identity tag/input overlapping the touch button column, and the
// bottom-center hint text overlapping the joystick (bottom-left, 108px tall), on phones
if (isTouchDevice) {
  const idTag = document.getElementById('identity-tag'), idInput = document.getElementById('identity-input')
  if (idTag) idTag.style.bottom = '236px'
  if (idInput) idInput.style.bottom = '236px'
  const hintEl = document.querySelector('.hint')
  if (hintEl) hintEl.style.bottom = '145px'
}

connect({ onChat, onAct: onPeerAct })   // resilient: solo mode if the relays are unreachable
startNPCs()

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock()
function frame() {
  window.__frames = (window.__frames | 0) + 1
  window.__peers = peers.size
  window.__npcs = npcs               // additive instrumentation: live NPC array
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime

  updateMovement(dt)
  updateMoves(dt)   // gamepad stick/buttons layer over the keyboard input
  updateTouch(dt)   // touch joystick layer (mobile), same "last write wins" slot
  tickDirector(dt)  // idle NPC social vignettes (gaze/nap/tag) claim wanderEnabled critters
  me.update(dt)
  updateCamera(dt)
  placeSprites(me)

  // remote critters walk to their broadcast targets with their own gait; when
  // idle, settle their heading toward the broadcast one
  for (const p of peers.values()) {
    const c = p.critter
    if (!c.target && c.speedN < 0.08 && (c.arch !== 'hopper' || c.hState === 'idle'))
      c.heading = angleLerp(c.heading, p.heading, 1 - Math.pow(0.02, dt))
    c.update(dt)
    placeSprites(c)
  }

  // NPC companions wander via the OG AI (inside Critter.update)
  for (const c of npcs) { c.update(dt); placeSprites(c) }

  // fire flicker + sparks + fireflies
  updateWorld(t, dt)
  updateAudio(dt)   // dust pool: rise/fade/dispose (audio itself is event-driven, no per-frame work)

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
frame()

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
