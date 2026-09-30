// src/critter/gear.js : expression gear. Procedural hats + rideable skateboard
// plus the in-world hat rack landmark. Critter groups stay at identity (world
// space), so gear objects live directly in the scene and placeGear() anchors
// them to their critter every frame (same pattern as tags.js placeSprites).
// Critter fields used: hatId (int, -1 none), riding (bool), boardSpin (ollie
// timer), speedMul (movement hook in critter.js seekTarget). setHat/setRiding
// are idempotent and safe on any critter (local, remote, NPC).
import * as THREE from 'three'
import { scene, GY, curve } from '../world/scene.js'
import { aboveHead } from './tags.js'
import { headSocket } from './head.js'
import { makeHat } from './hats.js'
import { woodMaterial, branchGeometry } from '../world/materials.js'
import { addObstacle } from '../world/obstacles.js'
import { disposeObject } from '../engine/dispose.js'
import { spawnDust, playChirp } from '../audio.js'

const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }); curve(m); return m }

// ---------------------------------------------------------------------------
// hats: builders return a Group whose y=0 is the resting plane on the head
// ---------------------------------------------------------------------------
export const HAT_COUNT = 8
export const HAT_NAMES = ['party cone', 'top hat', 'wizard hat', 'crown', 'toadstool', 'daisy', 'halo', 'propeller beanie']
export { makeHat }

function validHat(id) {
  id = Number.isFinite(+id) ? Math.trunc(+id) : -1
  if (id < -1 || id >= HAT_COUNT) id = -1
  return id
}
function hatModel(c,id) {
  if(c.hatModelId===id)return
  if (c.hatObj) { disposeObject(c.hatObj); c.hatObj = null }
  c.hatModelId=id
  if (id >= 0) { c.hatObj = makeHat(id); scene.add(c.hatObj) }
}
export function setHat(c,id) {
  c.hatId=validHat(id);c.hatPreviewId=null;hatModel(c,c.hatId)
}
export function previewHat(c,id) {
  c.hatPreviewId=id==null?null:validHat(id)
  hatModel(c,c.hatPreviewId??c.hatId??-1)
}

// ---------------------------------------------------------------------------
// skateboard
// ---------------------------------------------------------------------------
export function makeBoard() {
  const g = new THREE.Group()
  const shape = new THREE.Shape()
  shape.moveTo(-.42,-.17);shape.lineTo(.42,-.17)
  shape.absarc(.42,0,.17,-Math.PI/2,Math.PI/2,false)
  shape.lineTo(-.42,.17);shape.absarc(-.42,0,.17,Math.PI/2,Math.PI*1.5,false)
  const bend = geometry => {
    geometry.rotateX(Math.PI/2)
    const p=geometry.attributes.position
    for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+.13+Math.pow(Math.max(0,Math.abs(p.getX(i))-.39),2)*1.7)
    geometry.computeVertexNormals();return geometry
  }
  const deck = new THREE.Mesh(bend(new THREE.ExtrudeGeometry(shape,{depth:.041,bevelEnabled:true,bevelSize:.007,bevelThickness:.007,bevelSegments:2,steps:1,curveSegments:10})),mat(0xb98e5f))
  g.add(deck)
  const grip = new THREE.Mesh(bend(new THREE.ShapeGeometry(shape,10)),mat(0x3b5951,{side:THREE.DoubleSide}))
  grip.position.y=.012;grip.scale.set(.93,1,.85);g.add(grip)
  const trucks=mat(0x8d9b96,{roughness:.55})
  for(const x of [-.32,.32]) {
    const axle=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.38,10),trucks)
    axle.rotation.x=Math.PI/2;axle.position.set(x,.062,0);g.add(axle)
    const hanger=new THREE.Mesh(new THREE.BoxGeometry(.09,.038,.16),trucks);hanger.position.set(x,.075,0);g.add(hanger)
    for(const z of [-.07,.07]) {
      const bolt=new THREE.Mesh(new THREE.SphereGeometry(.008,8,6),trucks);bolt.position.set(x,.138,z);g.add(bolt)
    }
  }
  const wheels = []
  for (const [wx, wz] of [[0.32, 0.175], [0.32, -0.175], [-0.32, 0.175], [-0.32, -0.175]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 20), mat(0xe1be83))
    w.rotation.x = Math.PI / 2
    w.position.set(wx, 0.06, wz)
    g.add(w); wheels.push(w)
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.064,12),trucks);hub.rotation.x=Math.PI/2;hub.position.copy(w.position);g.add(hub)
  }
  g.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true})
  g.userData.wheels = wheels
  return g
}

export function setRiding(c, on) {
  on = !!on
  if (!!c.riding === on) return
  c.riding = on
  c.speedMul = on ? 1.8 : 1
  if (on && !c.boardObj) { c.boardObj = makeBoard(); scene.add(c.boardObj) }
  if (c.boardObj) c.boardObj.visible = on
  c.boardSpin = 0
  if(c.arch==='hopper') {c.hState=c.airY>0&&!on?'air':'idle';c.hT=0;c.hVel.set(0,on?0:c.jumpVy||0,0);if(on){c.airY=0;c.jumpVy=0}}
  if(c.legs)for(const leg of c.legs){leg.initd=false;leg.wasAirborne=on;leg.swingT=-1}
}

export const boardScale = c => Math.min(2.4, Math.max(1.1, (c.bodyR || .4) * 2.6))
export const boardBank = c => Math.max(-.16,Math.min(.16,-(c.headingVel || 0)*.035))
export const boardClearance = c => .035+Math.abs(Math.sin(boardBank(c)))*.20*boardScale(c)

// ---------------------------------------------------------------------------
// per-frame anchor (call next to placeSprites for every critter)
// ---------------------------------------------------------------------------
export function placeGear(c, dt) {
  if (c.hatObj) {
    const h = c.hatObj
    const radius=headSocket(c,h.position)
    const k=Math.min(3.2,Math.max(.75,radius*4.6))
    h.quaternion.copy(c.headQuat || c.quat)
    if(h.userData.float) {
      h.position.y+=.14+Math.sin(c.time*2)*.03
      h.rotateY(c.time*.8)
    }
    h.scale.setScalar(k)
    if (h.userData.prop) h.userData.prop.rotation.y += dt * (3 + c.speedN * 25)
  }
  if (c.boardObj && c.riding) {
    const b = c.boardObj
    b.position.set(c.pos.x, GY + c.airY + boardClearance(c), c.pos.z)
    // board points along travel; carve lean from turn rate, ollie flip on hop
    b.rotation.set(boardBank(c), c.heading + Math.PI / 2, 0, 'YXZ')
    if (c.boardSpin > 0) { c.boardSpin -= dt; b.rotation.x += (1 - Math.max(0, c.boardSpin) / 0.55) * Math.PI * 2 }
    b.scale.setScalar(boardScale(c))
    for (const w of b.userData.wheels) w.rotation.y += c.speedN * dt * 18
    if (c.speedN > 0.5 && c.airY === 0 && Math.random() < dt * 6) spawnDust(c.pos.x, GY, c.pos.z, 2, 0.16, 0.05, 0.4)
  }
}

// remove gear from the scene (wired into Critter.dispose)
export function gearDispose(c) {
  if (c.hatObj) { disposeObject(c.hatObj); c.hatObj = null }
  if (c.boardObj) { disposeObject(c.boardObj); c.boardObj = null }
}

// ---------------------------------------------------------------------------
// hat rack landmark: two posts + crossbar + display hats on pegs. Walk within
// RACK_RADIUS and E opens the try-on shop (moves.js reroutes E from pet).
// ---------------------------------------------------------------------------
export const RACK_POS = { x: Math.cos(5.6) * 6.2, z: Math.sin(5.6) * 6.2 }
export const RACK_RADIUS = 2.4
export let rackModel
{
  const rack = new THREE.Group()
  const wood = woodMaterial(0xcfb696)
  for (const s of [-0.55, 0.55]) {
    const post = new THREE.Mesh(branchGeometry(.06,.075,1.5), wood)
    post.position.set(s, 0.75, 0)
    rack.add(post)
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.12,.15,.12,12),mat(0x48564a));foot.position.set(s,.06,0);rack.add(foot)
  }
  const bar = new THREE.Mesh(branchGeometry(.05,.05,1.5), wood)
  bar.rotation.z = Math.PI / 2
  bar.position.y = 1.42
  rack.add(bar)
  // three display hats sitting on the crossbar
  ;[0, 3, 6].forEach((hid, i) => {
    const h = makeHat(hid)
    h.position.set(-0.45 + i * 0.45, 1.47, 0)
    h.scale.setScalar(0.9)
    rack.add(h)
  })
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.04), mat(0xc8a060))
  sign.position.set(0, 1.05, 0.03)
  rack.add(sign)
  // A geometric hat pictogram stays readable without another texture font.
  const mark=new THREE.Mesh(new THREE.ConeGeometry(.055,.10,24),mat(0x694f40));mark.position.set(0,1.062,.056);rack.add(mark)
  const brim=new THREE.Mesh(new THREE.BoxGeometry(.16,.014,.008),mat(0x694f40));brim.position.set(0,1.012,.058);rack.add(brim)
  for(const x of [-.19,.19]) {const nail=new THREE.Mesh(new THREE.SphereGeometry(.012,8,6),mat(0x655443));nail.position.set(x,1.05,.054);rack.add(nail)}
  rack.position.set(RACK_POS.x, GY, RACK_POS.z)
  rack.rotation.y = Math.atan2(-RACK_POS.x, -RACK_POS.z) + Math.PI / 2 // face the fire
  rack.traverse(o => { if (o.isMesh) o.castShadow = true })
  scene.add(rack)
  rackModel = rack
  rack.updateMatrixWorld(true)
  for(const x of [-.55,.55]) {
    const p=new THREE.Vector3(x,0,0).applyMatrix4(rack.matrixWorld)
    addObstacle(p.x,p.z,p.x,p.z,.08,1.6)
  }
}

export const nearRack = c => (c.pos.x - RACK_POS.x) ** 2 + (c.pos.z - RACK_POS.z) ** 2 < RACK_RADIUS * RACK_RADIUS

// cycle the local player's hat at the rack: -1 -> 0 -> 1 ... -> HAT_COUNT-1 -> -1
export function cycleHat(c) {
  setHat(c, c.hatId >= HAT_COUNT - 1 ? -1 : (c.hatId ?? -1) + 1)
  playChirp('pet')
  spawnDust(c.pos.x, aboveHead(c), c.pos.z, 5, 0.2, 0.06, 0.5)
  return c.hatId
}
