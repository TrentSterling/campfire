// src/critter/tags.js : overhead canvas sprites. Floating nametags (makeTag),
// speech bubbles (makeBubble + bubble), the per-frame placeSprites anchor, and
// the friendly random critter name generator.
import * as THREE from 'three'
import { GY, camera } from '../world/scene.js'

// friendly random critter names
const ADJ = ['Cozy','Toasty','Fuzzy','Sleepy','Wobbly','Sunny','Mossy','Bramble','Ember','Clover','Pebble','Marsh','Dewy','Nimbus','Pip']
const NOUN = ['Goober','Blob','Sprout','Newt','Tato','Mochi','Bean','Puff','Gill','Snib','Loaf','Fig','Yam','Moth','Pear']
export const randomName = () => ADJ[(Math.random() * ADJ.length) | 0] + ' ' + NOUN[(Math.random() * NOUN.length) | 0]

function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath() }

// floating nametag sprite (relabelable)
export function makeTag(text) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 64
  const x = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  s.scale.set(3.0, 0.6, 1); s.position.y = 2.15
  s.userData.draw = txt => {
    x.clearRect(0, 0, 320, 64)
    x.font = 'bold 32px "Segoe UI", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
    const w = Math.min(300, x.measureText(txt).width + 40)
    x.fillStyle = 'rgba(10,10,20,0.55)'; roundRect(x, (320 - w) / 2, 12, w, 40, 12); x.fill()
    x.fillStyle = '#ffe9c7'; x.fillText(txt, 160, 33); tex.needsUpdate = true
  }
  s.userData.draw(text)
  return s
}

function makeBubble() {
  const c = document.createElement('canvas'); c.width = 320; c.height = 84
  const x = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  s.scale.set(3.4, 0.9, 1); s.position.y = 2.95
  s.userData.draw = txt => {
    x.clearRect(0, 0, 320, 84)
    x.font = 'bold 26px "Segoe UI", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
    const w = Math.min(308, x.measureText(txt).width + 34)
    x.fillStyle = 'rgba(255,246,230,0.95)'; roundRect(x, (320 - w) / 2, 16, w, 52, 16); x.fill()
    x.fillStyle = '#2a2030'; x.fillText(txt, 160, 43); tex.needsUpdate = true
  }
  return s
}

// overhead sprite anchors (world-space labels that follow the critter every frame)
export const aboveHead = c => GY + c.airY + c.bodyY + c.bodyR + 0.35 * c.size
const TAG_REF_DIST = 8   // beyond this, tags render at full world scale
const TAG_FADE_NEAR = 2, TAG_FADE_FAR = 3.5 // fade out when the camera is on top of them
export function placeSprites(c) {
  if (c.tag) {
    c.tag.position.set(c.pos.x, aboveHead(c) + 0.7, c.pos.z)
    // clamp screen-space size: sprites are fixed WORLD size, so a near tag would
    // fill the screen; shrink world scale linearly inside TAG_REF_DIST to cap it
    const d = camera.position.distanceTo(c.tag.position)
    const k = Math.min(1, d / TAG_REF_DIST)
    c.tag.scale.set(3.0 * k, 0.6 * k, 1)
    // fade to nothing when nearly at the camera; dim your OWN tag (you know who
    // you are) so it never occludes the fire the camera is always looking past
    let op = Math.max(0, Math.min(1, (d - TAG_FADE_NEAR) / (TAG_FADE_FAR - TAG_FADE_NEAR)))
    if (c.tag.userData.own) op *= 0.28
    c.tag.material.opacity = op
    c.tag.visible = op > 0.02
  }
  if (c.bubble && c.bubble.visible) c.bubble.position.set(c.pos.x, aboveHead(c) + 1.45, c.pos.z)
}

// pop a speech bubble above a critter for ~5.5s
export function bubble(c, text) {
  if (c.bubbleTimer) clearTimeout(c.bubbleTimer)
  if (!c.bubble) { c.bubble = makeBubble(); c.group.add(c.bubble) }
  c.bubble.userData.draw(text.length > 42 ? text.slice(0, 42) + '...' : text)
  c.bubble.visible = true
  placeSprites(c)
  c.bubbleTimer = setTimeout(() => { c.bubble.visible = false }, 5500)
}
