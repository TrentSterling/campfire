// src/fishing.js : the shoreline fishing loop (webfishing-style expression hook).
// Press F near the shore: rod out, bobber arcs to the water, wait for the dip,
// F again in the bite window to catch a seeded procedural fish, hold it up +
// auto chat-bubble brag. F mid-wait reels in early. Solo-safe, cozy by design.
//
// SYNC (additive move-payload fields, net.js spreads state.fishWire into
// myState): fs 1 waiting / 2 bite / 3 holding (absent = idle), bx/bz bobber,
// fseed held fish. Remote critters get the same rod/bobber/fish visuals via
// applyRemoteFishing (called by replication.onPlayerState); the brag rides the
// normal chat lane. `say` is injected by main.js (avoids an api.js cycle).
import * as THREE from 'three'
import { disposeObject } from './engine/dispose.js'
import { scene, curve, GY, ISLAND_R, terrainHeight } from './world/scene.js'
import { state, critters } from './state.js'
import { aboveHead, bubble } from './critter/tags.js'
import { playChirp, spawnDust } from './audio.js'
import { recordCatch } from './progress.js'
import { makeFishMesh } from './fish-model.js'
export { makeFishMesh }

const WATER_Y = -0.95            // bobber float height (water plane is -1.2)
const SHORE_MIN_R = 12           // must stand at least this far out to cast
const CAST_R = ISLAND_R + 4      // bobber lands out over the water ring

let sayFn = null
export function initFishing(opts) { sayFn = opts && opts.say }

const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }); curve(m); return m }

// ---------------------------------------------------------------------------
// seeded procedural fish (tiny LCG so the shared rng stream is untouched)
// ---------------------------------------------------------------------------
const FISH_ADJ = ['Dusky', 'Glimmer', 'Mossy', 'Pebble', 'Misty', 'Ember', 'Twilight', 'Sleepy', 'Bubbly', 'Speckled', 'Wobbly', 'Moonlit']
const FISH_NOUN = ['Chub', 'Minnow', 'Gulper', 'Bloop', 'Snapper', 'Wisp', 'Carp', 'Puffer', 'Sardine', 'Koi', 'Dab', 'Guppy']
export function fishFromSeed(seed) {
  let s = (seed >>> 0) || 1
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
  const adj = FISH_ADJ[(rng() * FISH_ADJ.length) | 0], noun = FISH_NOUN[(rng() * FISH_NOUN.length) | 0]
  const len = Math.round(8 + Math.pow(rng(), 2.2) * 72)   // most are small, whales are earned
  const golden = rng() < 0.05
  const hue = rng(), fat = 0.7 + rng() * 0.7
  return { name: adj + ' ' + noun, len, golden, hue, fat }
}
// ---------------------------------------------------------------------------
// per-critter tackle visuals (local player AND remote peers share this)
// ---------------------------------------------------------------------------
const tackle = new Map()   // critter -> { rod, tip, line, bobber, fish, bobT }
export function makeRod() {
  const rod=new THREE.Group()
  const stick=new THREE.Mesh(new THREE.CylinderGeometry(.012,.024,1.1,12),mat(0x987a55));stick.position.y=.55;rod.add(stick)
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.034,.039,.24,16),mat(0xbfa179));grip.position.y=.13;rod.add(grip)
  const reel=new THREE.Mesh(new THREE.CylinderGeometry(.043,.043,.036,16),mat(0x5b716a));reel.rotation.z=Math.PI/2;reel.position.set(-.045,.19,0);rod.add(reel)
  for(const y of [.42,.72,1.07]) {
    const eyelet=new THREE.Mesh(new THREE.TorusGeometry(.015,.003,5,12),mat(0xc2bda5));eyelet.position.set(0,y,.020);rod.add(eyelet)
  }
  rod.rotation.x=.7;return rod
}
export function makeBobber() {
  const bobber=new THREE.Group()
  const top=new THREE.Mesh(new THREE.SphereGeometry(.09,20,10,0,Math.PI*2,0,Math.PI/2),mat(0xb96250))
  const bottom=new THREE.Mesh(new THREE.SphereGeometry(.09,20,10,0,Math.PI*2,Math.PI/2,Math.PI/2),mat(0xe9dabb))
  top.scale.y=bottom.scale.y=1.1;bobber.add(top,bottom)
  const seam=new THREE.Mesh(new THREE.CylinderGeometry(.091,.091,.008,24),mat(0x554b3e));bobber.add(seam)
  const tip=new THREE.Mesh(new THREE.CylinderGeometry(.009,.012,.12,10),mat(0xb96250));tip.position.y=.15;bobber.add(tip)
  return bobber
}
function getTackle(c) {
  let t = tackle.get(c)
  if (t) return t
  const rod = makeRod()
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(33*3),3))
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf0e8d8, transparent: true, opacity: 0.55 }))
  curve(line.material)
  const bobber = makeBobber()
  t = { rod, line, bobber, tip:new THREE.Vector3(), fish: null, bobT: Math.random() * 10, castT: 1 }
  scene.add(rod, line, bobber)
  tackle.set(c, t)
  return t
}
function dropTackle(c) {
  const t = tackle.get(c); if (!t) return
  for(const o of [t.rod,t.line,t.bobber,t.fish])disposeObject(o)
  tackle.delete(c)
}

// remote hook: replication.onPlayerState hands the raw payload over; absent fs
// clears (old clients / idle peers cost nothing)
export function applyRemoteFishing(c, d) {
  if (!d || d.fs == null) { c.__fish = null; return }
  c.__fish = { st: +d.fs | 0, bx: d.bx != null ? +d.bx : 0, bz: d.bz != null ? +d.bz : 0, seed: d.fseed != null ? (+d.fseed >>> 0) : 0 }
}

// ---------------------------------------------------------------------------
// local state machine
// ---------------------------------------------------------------------------
const local = { st: 0, waitT: 0, biteT: 0, holdT: 0, bx: 0, bz: 0, seed: 0 }
function setWire() {
  if (local.st === 0) state.fishWire = {}
  else if (local.st === 3) state.fishWire = { fs: 3, fseed: local.seed }
  else state.fishWire = { fs: local.st, bx: +local.bx.toFixed(2), bz: +local.bz.toFixed(2) }
  const me = state.me
  me.__fish = local.st ? { st: local.st, bx: local.bx, bz: local.bz, seed: local.seed } : null
}

export function doFish() {
  const me = state.me; if (!me) return
  if (local.st === 0) {
    if (Math.hypot(me.pos.x, me.pos.z) < SHORE_MIN_R) {
      bubble(me, '(the water is too far from here)')   // local-only hint, no chat spam
      return
    }
    const d = Math.hypot(me.pos.x, me.pos.z) || 1
    local.bx = me.pos.x / d * CAST_R
    local.bz = me.pos.z / d * CAST_R
    local.st = 1
    local.waitT = 2.5 + Math.random() * 4.5
    const t = getTackle(me); t.castT = 0
    me.heading = Math.atan2(local.bx - me.pos.x, local.bz - me.pos.z) // face the cast
    playChirp('wave')
  } else if (local.st === 1) {      // reel in early
    local.st = 0
    dropTackle(state.me)
    playChirp('footstep')
  } else if (local.st === 2) {      // CATCH
    local.st = 3
    local.holdT = 2.5
    local.seed = (Math.random() * 1e9) | 0
    const f = fishFromSeed(local.seed)
    spawnDust(local.bx, WATER_Y + 0.2, local.bz, 10, 0.4, 0.09, 0.8)
    playChirp('pet'); playChirp('hop')
    const rec = recordCatch(f)   // v1.4 loop: shells + journal + warmth
    const article = /^[aeiou]/i.test(f.name) ? 'an' : 'a'
    if (sayFn) sayFn(`caught ${article} ${f.name}! ${f.len}cm${f.golden ? ' * GOLDEN *' : ''} (+${rec.shells} shells${rec.isNew ? ', NEW species!' : ''})`)
  }
  setWire()
}

// instrumentation (additive): verify harness reads the live cast state
export const getFishingState = () => ({ st: local.st, waitT: +local.waitT.toFixed(2), seed: local.seed })
window.__fishState = getFishingState

// per-frame: run the local machine + draw tackle for every fishing critter
export function updateFishing(dt) {
  const me = state.me
  if (local.st === 1) {
    local.waitT -= dt
    if (local.waitT <= 0) { local.st = 2; local.biteT = 1.8; playChirp('land'); setWire() }
  } else if (local.st === 2) {
    local.biteT -= dt
    if (local.biteT <= 0) {           // missed: bobber sinks, rod away
      local.st = 0
      dropTackle(me)
      if (Math.random() < 0.5) bubble(me, '(it got away...)')   // local-only sigh
      setWire()
    }
  } else if (local.st === 3) {
    local.holdT -= dt
    if (local.holdT <= 0) { local.st = 0; dropTackle(me); setWire() }
  }

  // draw pass: any critter (me or remote) with __fish gets tackle; sweep the rest
  for (const c of critters) {
    const f = c.__fish
    if (!f || !f.st) { if (tackle.has(c)) dropTackle(c); continue }
    const t = getTackle(c)
    t.bobT += dt
    t.rod.position.set(c.pos.x + Math.sin(c.heading) * 0.3, GY + 0.15 + c.airY, c.pos.z + Math.cos(c.heading) * 0.3)
    t.rod.rotation.y = c.heading
    if (f.st === 3) {                 // holding the catch overhead
      t.bobber.visible = false; t.line.visible = false
      if (!t.fish) { t.fish = makeFishMesh(fishFromSeed(f.seed)); scene.add(t.fish) }
      t.fish.position.set(c.pos.x, aboveHead(c) + 0.3 + Math.sin(t.bobT * 3) * 0.05, c.pos.z)
      t.fish.rotation.y = c.heading + Math.PI / 2 + Math.sin(t.bobT * 2) * 0.15
    } else {
      if (t.fish) { disposeObject(t.fish); t.fish = null }
      t.bobber.visible = true; t.line.visible = true
      // cast arc eases the bobber out, then it bobs; the bite dips it hard
      t.castT = Math.min(1, t.castT + dt * 2)
      const k = t.castT, arc = Math.sin(k * Math.PI) * 1.6
      const bx = c.pos.x + (f.bx - c.pos.x) * k, bz = c.pos.z + (f.bz - c.pos.z) * k
      const dip = f.st === 2 ? -0.22 : 0
      t.bobber.position.set(bx, (GY + 0.5) * (1 - k) + WATER_Y * k + arc + Math.sin(t.bobT * 2.2) * 0.05 + dip, bz)
      if(k<1)t.bobber.position.y=Math.max(t.bobber.position.y,terrainHeight(bx,bz)+.08)
      if (f.st === 2 && Math.random() < dt * 10) spawnDust(bx, WATER_Y + 0.15, bz, 2, 0.18, 0.05, 0.4)
      // Lift one smooth curve over the whole bank. Clamping individual rope
      // points to the terrain creates sharp corners at the grass ledge.
      t.rod.updateMatrixWorld(true);t.tip.set(0,1.1,.02).applyMatrix4(t.rod.matrixWorld)
      const points=t.line.geometry.attributes.position,end=t.bobber.position
      let lift=0
      for(let i=1;i<32;i++) {
        const u=i/32,x=t.tip.x+(end.x-t.tip.x)*u,z=t.tip.z+(end.z-t.tip.z)*u
        const y=t.tip.y+(end.y-t.tip.y)*u-Math.sin(u*Math.PI)*.12
        lift=Math.max(lift,(terrainHeight(x,z)+.12-y)/(4*u*(1-u)))
      }
      for(let i=0;i<=32;i++) {
        const u=i/32,x=t.tip.x+(end.x-t.tip.x)*u,z=t.tip.z+(end.z-t.tip.z)*u
        const y=t.tip.y+(end.y-t.tip.y)*u-Math.sin(u*Math.PI)*.12+lift*4*u*(1-u)
        points.setXYZ(i,x,y,z)
      }
      points.needsUpdate=true;t.line.geometry.computeBoundingSphere()
    }
  }
  // critters that despawned mid-cast (peer left while fishing)
  for (const c of tackle.keys()) if (!critters.includes(c)) dropTackle(c)
}
window.__tackleState=()=>[...tackle].filter(([,t])=>t.line.visible).map(([c,t])=>{
  const a=t.line.geometry.attributes.position,points=[]
  for(let i=0;i<a.count;i++)points.push({x:a.getX(i),y:a.getY(i),z:a.getZ(i),floor:terrainHeight(a.getX(i),a.getZ(i))})
  return {id:c.id,points,tipGap:Math.hypot(a.getX(0)-t.tip.x,a.getY(0)-t.tip.y,a.getZ(0)-t.tip.z)}
})
