import * as THREE from 'three'
import { fieldDistJS } from '../engine/sdf.js'

const up=new THREE.Vector3(), center=new THREE.Vector3(), probe=new THREE.Vector3()
// Use the same live primitive field as the skin, including squash, head turns,
// jumps and smooth unions. The socket sits on its surface, rather than a bodyY guess.
export function headSocket(c, out) {
  const i=c.hasHead?c.iHead:c.iBody
  if(i === undefined) { out.copy(c.headPos || c.pos);return .2 }
  const o=i*4, a=c.fA,b=c.fB
  const t=c.hasHead ? .42 : (c.recipe.body.upright ? 1 : .82)
  center.set(a[o]+(b[o]-a[o])*t,a[o+1]+(b[o+1]-a[o+1])*t,a[o+2]+(b[o+2]-a[o+2])*t)
  up.set(0,1,0).applyQuaternion(c.headQuat || c.quat)
  const r=a[o+3]+(b[o+3]-a[o+3])*t
  if(!c.hatSkinSkip)c.hatSkinSkip=new Set([
    ...c.decos.map(d=>d.i),...(c.prop?[c.prop.iMast,c.prop.iHub,...c.prop.blades]:[])
  ])
  let low=0, high=Math.max(.2,r*3)
  for(let n=0;n<12;n++) {
    const mid=(low+high)*.5;probe.copy(center).addScaledVector(up,mid)
    if(fieldDistJS(c,probe.x,probe.y,probe.z,c.hatSkinSkip)<0)low=mid;else high=mid
  }
  out.copy(center).addScaledVector(up,(low+high)*.5-.012)
  return r
}
