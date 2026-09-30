// Lightweight text anchors. The GPU glyph layer wraps speech in screen pixels.
import * as THREE from 'three'
import { GY } from '../world/scene.js'
const ADJ=['Cozy','Toasty','Fuzzy','Sleepy','Wobbly','Sunny','Mossy','Bramble','Ember','Clover','Pebble','Marsh','Dewy','Nimbus','Pip']
const NOUN=['Goober','Blob','Sprout','Newt','Tato','Mochi','Bean','Puff','Gill','Snib','Loaf','Fig','Yam','Moth','Pear']
export const randomName=()=>ADJ[Math.random()*ADJ.length|0]+' '+NOUN[Math.random()*NOUN.length|0]
export function makeTag(text) {
  const anchor=new THREE.Object3D()
  anchor.userData.draw=(name,title='')=>{anchor.userData.text=String(name);anchor.userData.title=String(title)}
  anchor.userData.draw(text);return anchor
}
export const aboveHead=c=>Math.max(GY+c.airY+c.bodyY+c.bodyR,(c.headPos?.y || 0)+(c.headR || c.bodyR))+.35*c.size
export function placeSprites(c) {
  if(c.tag)c.tag.position.set(c.headPos?.x ?? c.pos.x,aboveHead(c)+.45,c.headPos?.z ?? c.pos.z)
  if(c.bubble)c.bubble.position.set(c.headPos?.x ?? c.pos.x,aboveHead(c)+.95,c.headPos?.z ?? c.pos.z)
}
export function bubble(c,text) {
  if(c.bubbleTimer)clearTimeout(c.bubbleTimer)
  if(!c.bubble) {c.bubble=new THREE.Object3D();c.group.add(c.bubble)}
  c.bubble.userData.text=String(text).slice(0,120);c.bubble.visible=true
  placeSprites(c)
  c.bubbleTimer=setTimeout(()=>{c.bubble.visible=false},5500)
}
