// Deterministic island planting, shared production factories and ambient life.
import * as THREE from 'three'
import { makePlant, batchPlants } from './plants.js'
import { scene, softCircleTexture, GY, ISLAND_R } from './scene.js'
import { withSeededRng, rand, rr, pick, TAU } from '../engine/rng.js'
import { getSettings } from '../preferences.js'
import { addObstacle } from './obstacles.js'
const SCATTER_SEED=20260709, S=1.35
const mrr=(a,b)=>a+(b-a)*Math.random()
const flowerSpots=[]
export const SEATS=[],rockModels=[]
export const plantSamples=[]
export const makeFloraSample=(kind,seed=1337)=>{const g=makePlant(kind,seed);g.position.set(0,GY,4);return g}
let plantStreams=[]
withSeededRng(SCATTER_SEED,()=>{
  const anchors=[]
  for(let i=0;i<7;i++) {
    const a=rand()*TAU,r=ISLAND_R*(.5+rand()*.36),seed=rand()*1e9|0
    const rock=makePlant('boulder',seed);rock.position.set(Math.cos(a)*r,GY,Math.sin(a)*r);scene.add(rock);rockModels.push(rock)
    rock.updateMatrixWorld(true)
    for(const m of rock.children) {
      const bounds=new THREE.Box3().setFromObject(m),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3())
      addObstacle(center.x,center.z,center.x,center.z,Math.max(size.x,size.z)*.44,size.y)
    }
    anchors.push({x:rock.position.x,z:rock.position.z,pad:1.1})
  }
  const plant=(kind,x,z)=>{
    const seed=rand()*1e9|0;plantSamples.push({kind,x,z,y:GY,seed})
    if(kind==='flower'||kind==='mushroom')flowerSpots.push({x,z})
    if(kind==='stump')addObstacle(x,z,x,z,.28,.4)
  }
  for(const [kind,count,min,max] of [['grass',48,4.2,16.4],['flower',18,5,15.5],['pebble',10,5,16],['stump',3,9,15],['bush',5,12.5,16.8]])for(let i=0;i<count;i++) {
    const a=rand()*TAU,r=rr(min,max);plant(kind,Math.sin(a)*r,Math.cos(a)*r)
  }
  for(let i=0;i<9;i++) {
    const an=pick(anchors),a=rand()*TAU,d=an.pad+rr(.3,1.2)
    let x=an.x+Math.sin(a)*d,z=an.z+Math.cos(a)*d,r=Math.hypot(x,z)
    if(r>17.2){x*=17.2/r;z*=17.2/r}plant('mushroom',x,z)
  }
  for(const a of [.9,2.9,4.9])for(const t of [-.55,.55])SEATS.push({x:Math.cos(a)*4.1-Math.sin(a)*t,z:Math.sin(a)*4.1+Math.cos(a)*t})
  const x=Math.cos(6.05)*3.4,z=Math.sin(6.05)*3.4;plant('stump',x,z);SEATS.push({x,z})
  plantStreams=batchPlants(plantSamples,scene)
})
console.log('[scatter]',plantSamples.length,'plants in',plantStreams.length,'instance streams; 7 boulders')

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
  if(!getSettings().particles)return
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
    if(!getSettings().particles){s.visible=false;continue}
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

let pollenT=0
function updatePlantLife(dt) {
  pollenT-=dt
  if(pollenT>0||!flowerSpots.length)return
  pollenT=mrr(2.5,4.5)
  const p=flowerSpots[Math.floor(Math.random()*flowerSpots.length)]
  spawnMote(p.x,GY+.4,p.z,'#e6d6a6',.045,3.5,.12,.12)
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
  shells: () => 0,
  drawCalls: () => plantStreams.length + rockModels.reduce((n,g)=>n+g.children.length,0),
  flutters: () => butterflies.filter(b => b.spr.visible).length,
  motes: () => motePool.filter(s => s.visible).length,
}

const clock = new THREE.Clock()
function tick() {
  requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)
  updatePlantLife(dt)
  updateMotes(dt)
  updateButterflies(dt)
}
requestAnimationFrame(tick)
