// src/main.js : boot + frame loop + wiring. Creates the local player critter,
// starts networking + NPCs, and runs the render loop. Owns the instrumentation
// contract (window.__frames, window.__peers) that the verify harness reads;
// window.campfire itself is installed by ./net/api.js. No domain logic here.
import * as THREE from 'three'
import { renderer, scene, camera, updateWorld, resizeView } from './world/scene.js'
import './world/scatter.js'                        // side effect: seeded meadow scatter + ambient life (Lane B)
import './world/campsite.js'
import { updateShore } from './world/shore.js'
import { critterMake } from './critter/critter.js'
import { makeTag, placeSprites } from './critter/tags.js'
import { state, peers, npcs } from './state.js'
import { angleLerp } from './engine/rng.js'
import { updateMovement, updateCamera } from './player.js'
import { connect, startNPCs } from './net/net.js'
import { storeValues } from './net/replication.js'  // unified remote-entity loop (players + NPCs)
import { updateMoves, onPeerAct } from './moves.js' // gamepad + jump/pet/wave moves
import { onChat, doSay } from './net/api.js'       // side effect: chat UI + window.campfire
import { initFishing, updateFishing } from './fishing.js'  // v1.3: shoreline fishing
import { updateCoop } from './coop.js'                     // v1.3: couch co-op pads
import { initProgress, myTitle, ownHat } from './progress.js'  // v1.4: shells/warmth/journal/shop
import { getOrCreateIdentity, saveIdentity, initIdentityUI } from './identity.js' // Lane A: persistent identity
import { setHat, placeGear } from './critter/gear.js'  // v1.3: hats + skateboards (side effect: hat rack landmark)
import { isTouchDevice, initTouchControls, update as updateTouch } from './touch.js' // Lane B: mobile joystick + buttons
import { initAudio, update as updateAudio } from './audio.js'                        // Lane C: fire crackle + chirps + dust
import { tickDirector } from './critter/director.js'                                 // Lane D: idle NPC social vignettes
import { initUI, refreshHint } from './ui.js'
import { initVoice, updateVoice } from './net/voice.js'
import { initActivities, updateActivities } from './activities.js'
import { initGPUText, renderGPUText } from './gpu-ui.js'
import { initSettings } from './settings.js'
import { initHatShop, updateHatShop } from './hat-shop.js'

// ---------------------------------------------------------------------------
// Local player: a controlled critter (WASD writes critter.input, camera-relative;
// the critter integrates pos/vel/heading itself via seekTarget). Identity (seed +
// name) is persisted across reloads (Lane A) so a returning player keeps the same
// critter recipe/palette and display name instead of rerolling every visit.
// ---------------------------------------------------------------------------
const { seed, name, hat } = await getOrCreateIdentity()
state.mySeed = seed
state.myName = name
const me = state.me = critterMake(state.mySeed, (Math.random() - 0.5) * 8, 6 + Math.random() * 3, Math.PI)
setHat(me, hat)   // persisted hat back on (rides the move heartbeat to peers)
me.tag = makeTag(state.myName)
initProgress()
ownHat(hat)       // pre-shop hats are grandfathered into the owned list
me.tag.userData.draw(state.myName, myTitle())   // warmth title line under the name
me.tag.userData.own = true          // your own tag renders dimmed (you know who you are)
me.group.add(me.tag)
refreshHint()

// Rename affordance; persists the rename back to localStorage.
initIdentityUI(() => state.myName, newName => {
  window.campfire.setName(newName)
  saveIdentity(state.mySeed, newName, me.hatId ?? -1)
})

initAudio() // suspended AudioContext; self-unlocks on first pointerdown/keydown
document.body.dataset.touch = String(isTouchDevice)
initUI()
initVoice()
initActivities()
initSettings()
initHatShop()

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
connect({ onChat, onAct: onPeerAct })   // resilient: solo mode if the relays are unreachable
startNPCs()
initFishing({ say: doSay })   // injected to avoid an api.js <-> fishing.js cycle
try { await initGPUText() }
catch (error) {
  window.__gpuText={backend:'unavailable',mode:'native-accessibility-fallback',message:error.message}
  console.warn('Campfire WebGPU text unavailable:',error.message)
}

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
  updateCoop(dt)    // extra pads join/drive couch guests (before the store loop updates them)
  tickDirector(dt)  // idle NPC social vignettes (gaze/nap/tag) claim wanderEnabled critters
  me.update(dt)
  updateCamera(dt)
  placeSprites(me)
  placeGear(me, dt)

  // remote players walk to their broadcast targets with their own gait, settling
  // their heading toward the broadcast one when idle; NPCs wander via the OG AI
  // when owned (Critter.update) or walk to a broadcast target when remote --
  // one loop over the replication store drives every non-local critter exactly
  // once per frame (see src/net/replication.js)
  for (const rec of storeValues()) {
    const c = rec.critter
    if (c === me) continue
    if (rec.kind === 'player' && !c.target && c.speedN < 0.08 && (c.arch !== 'hopper' || c.hState === 'idle'))
      c.heading = angleLerp(c.heading, rec.heading, 1 - Math.pow(0.02, dt))
    c.update(dt)
    placeSprites(c)
    placeGear(c, dt)
  }

  updateFishing(dt)  // local cast machine + rod/bobber/held-fish for every fisher
  updateActivities()
  updateHatShop()

  // fire flicker + sparks + fireflies
  updateWorld(t, dt)
  updateShore(t)
  updateAudio(dt)   // dust pool: rise/fade/dispose (audio itself is event-driven, no per-frame work)
  updateVoice(dt)

  renderer.render(scene, camera)
  renderGPUText(dt)
  requestAnimationFrame(frame)
}
frame()

addEventListener('resize', resizeView)
