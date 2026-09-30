import * as THREE from 'three'
import { curve } from './scene.js'
import { mulberry32 } from '../engine/rng.js'
import { woodMaterial, branchGeometry } from './materials.js'

const sphere=new THREE.SphereGeometry(1,16,10), stem=new THREE.CylinderGeometry(1,1,1,8)
const cap=new THREE.SphereGeometry(1,24,12,0,Math.PI*2,0,Math.PI/2)
const circle=new THREE.CircleGeometry(1,24), pebble=new THREE.DodecahedronGeometry(1,0), rock=new THREE.DodecahedronGeometry(1,1)
const stump=branchGeometry(.8,1,1,16), growth=new THREE.RingGeometry(.92,1,32)
const blade=new THREE.BufferGeometry()
const vertices=[],indices=[]
for(let i=0;i<=6;i++) {
  const t=i/6,w=.05*Math.sin(t*Math.PI),x=.20*t*t
  vertices.push(x-w,t,0,x+w,t,0)
  if(i<6){const j=i*2;indices.push(j,j+2,j+1,j+1,j+2,j+3)}
}
blade.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));blade.setIndex(indices);blade.computeVertexNormals()
const mats=new Map()
function mat(color, side=THREE.FrontSide) {
  const key=color+':'+side
  if(!mats.has(key)) {const m=new THREE.MeshStandardMaterial({color,roughness:1,side});curve(m);mats.set(key,m)}
  return mats.get(key)
}
const bark=woodMaterial(),cut=woodMaterial(0xe0c79c,false)
const up=new THREE.Vector3(0,1,0)
function mesh(g,geo,color,pos,scale,side) {
  const m=new THREE.Mesh(geo,typeof color==='object'?color:mat(color,side))
  m.position.set(...pos);m.scale.set(...scale);m.castShadow=m.receiveShadow=true;g.add(m);return m
}
function twig(g,a,b,r,color=0x58724c) {
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),d=end.clone().sub(start)
  const m=mesh(g,stem,color,start.clone().add(end).multiplyScalar(.5).toArray(),[r,d.length(),r]);m.quaternion.setFromUnitVectors(up,d.normalize());return m
}
export function makePlant(kind,seed=1337) {
  const g=new THREE.Group(),rnd=mulberry32(seed),rr=(a,b)=>a+(b-a)*rnd()
  if(kind==='grass')for(let i=0;i<6;i++) {
    const m=mesh(g,blade,[0x66805b,0x7e936b,0x576f52][i%3],[rr(-.06,.06),0,rr(-.06,.06)],[rr(.7,1.1),rr(.22,.48),1],THREE.DoubleSide);m.rotation.y=i*2.4
  }
  if(kind==='flower')for(let j=0;j<2;j++) {
    const x=rr(-.07,.07),z=rr(-.07,.07),h=rr(.27,.46),lean=rr(-.05,.06)
    twig(g,[x,0,z],[x+lean,h,z],.009)
    const color=[0xd5a4b0,0xdbcfac,0xa9bbd0,0xd9bb79][Math.floor(rnd()*4)]
    for(let i=0;i<6;i++) {
      const a=i*Math.PI/3,p=mesh(g,sphere,color,[x+lean+Math.cos(a)*.064,h, z+Math.sin(a)*.064],[.056,.014,.028]);p.rotation.y=-a
    }
    mesh(g,sphere,0xc9a663,[x+lean,h+.013,z],[.027,.020,.027])
    for(const side of [-1,1]) {
      const leaf=mesh(g,sphere,0x6e875b,[x+side*.038,h*.48,z],[.055,.01,.023]);leaf.rotation.z=side*.45
    }
  }
  if(kind==='mushroom') {
    const h=rr(.20,.34),r=rr(.18,.26),squat=.6
    twig(g,[0,0,0],[.015,h+.04,0],.045,0xe3d5b9)
    mesh(g,cap,[0xaf6754,0xc08c68,0x9b725b][Math.floor(rnd()*3)],[0,h,0],[r,r*squat,r])
    const under=mesh(g,circle,0xd9c8a5,[0,h+.001,0],[r*.98,r*.98,1]);under.rotation.x=Math.PI/2
    for(let i=0;i<6;i++) {
      const a=i*2.4,rad=r*(.18+(i%3)*.23),x=Math.cos(a)*rad,z=Math.sin(a)*rad,y=Math.sqrt(r*r-rad*rad)*squat
      const spot=mesh(g,sphere,0xeee3cc,[x,h+y-.002,z],[.025,.004,.020]);spot.quaternion.setFromUnitVectors(up,new THREE.Vector3(x,y/(squat*squat),z).normalize())
    }
  }
  if(kind==='pebble'||kind==='boulder')for(let i=0;i<(kind==='boulder'?3:2);i++) {
    const r=kind==='boulder'?rr(.40,.67):rr(.09,.17),x=i?rr(-r*.8,r*.8):0,z=i?rr(-r*.5,r*.5):0
    const m=mesh(g,kind==='boulder'?rock:pebble,[0x6b7770,0x758179,0x596b63][i%3],[x,r*.27,z],[r*rr(.9,1.3),r*.62,r*rr(.7,1.1)]);m.rotation.set(rr(-.16,.16),rr(0,6),rr(-.10,.10))
  }
  if(kind==='stump') {
    const h=rr(.27,.39),r=rr(.24,.32)
    mesh(g,stump,bark,[0,h*.5,0],[r,h,r])
    const top=mesh(g,circle,cut,[0,h+.002,0],[r*.79,r*.79,1]);top.rotation.x=-Math.PI/2
    for(const rad of [.28,.52,.72]) {const ring=mesh(g,growth,0x8c7554,[r*.05,h+.003,0],[r*rad,r*rad,1]);ring.rotation.x=-Math.PI/2}
    for(let i=0;i<4;i++){const a=i*Math.PI/2;twig(g,[0,.08,0],[Math.cos(a)*r*1.2,.02,Math.sin(a)*r*1.2],r*.18,bark)}
  }
  if(kind==='bush')for(let i=0;i<5;i++) {
    const a=i*2.4,r=rr(.23,.38),x=Math.cos(a)*.24,z=Math.sin(a)*.22
    const m=mesh(g,rock,[0x47664b,0x557650,0x638059][i%3],[x,r*.6+(i%2)*.08,z],[r,r*.78,r*.9]);m.rotation.y=a
    if(i<3)mesh(g,sphere,0xb38480,[x+r*.5,r*1.25,z+r*.45],[.025,.025,.025])
  }
  if(!g.children.length)throw new Error('Unknown plant model: '+kind)
  if(['grass','flower','mushroom','bush'].includes(kind))g.traverse(m=>{if(m.isMesh)m.receiveShadow=false})
  return g
}
// Bake the same production factories into a few instance streams.
export function batchPlants(samples,scene) {
  const groups=new Map()
  for(const {kind,seed,x,z,y} of samples) {
    const plant=makePlant(kind,seed);plant.position.set(x,y,z);plant.updateMatrixWorld(true)
    plant.traverse(m=>{
      if(!m.isMesh)return
      const key=m.geometry.uuid+':'+(m.material.map?.uuid||'')+':'+m.material.side+':'+m.receiveShadow
      if(!groups.has(key))groups.set(key,{geo:m.geometry,material:m.material,receiveShadow:m.receiveShadow,items:[]})
      groups.get(key).items.push({matrix:m.matrixWorld.clone(),color:m.material.color.clone()})
    })
  }
  const meshes=[]
  for(const {geo,material,receiveShadow,items} of groups.values()) {
    const m=material.clone();m.color.set(0xffffff)
    m.userData.sway=!m.map&&![rock,pebble,growth,circle].includes(geo);curve(m)
    const stream=new THREE.InstancedMesh(geo,m,items.length)
    items.forEach((o,i)=>{stream.setMatrixAt(i,o.matrix);stream.setColorAt(i,o.color)})
    stream.castShadow=true;stream.receiveShadow=receiveShadow;scene.add(stream);meshes.push(stream)
  }
  return meshes
}
