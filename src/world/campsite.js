// Fixed set dressing shared by all peers: pine grove, lanterns and a worn clearing.
import * as THREE from 'three'
import { scene, curve, GY, softCircleTexture } from './scene.js'
import { woodMaterial, branchGeometry } from './materials.js'
import { addObstacle } from './obstacles.js'
export const campsiteModels = { benches: [], broadleaf: [], lanterns: [], festoon: [], glows: [] }

const bark = woodMaterial(0xa09884)
function mesh(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material)
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true
  curve(material); scene.add(m); return m
}
// Uneven fir groves, with rounded, drooping boughs and open gaps.
// Each crown is a layered sculpture rather than a repeated perfect cone.
const treeSpecs=[[-15,-6,5.2],[-12.8,-11.5,7.3],[-9,-14.8,5.3],[-5.1,-16.1,7.5],[-.9,-16.8,5.7],[3,-16.4,8.1],[7.1,-15,5.7],[11.5,-12,7.1],[15,-7.7,5.6],[-16.3,1.4,6.5],[16.5,1.8,6.1],[-13.3,8.2,4.8],[14.4,8.6,5]]
const profile=[[0,0],[.55,.02],[.87,.07],[1,.15],[.85,.28],[.75,.43],[.73,.55],[.58,.75],[.5,.84],[.32,1.06],[.20,1.26],[0,1.64]].map(([r,y])=>new THREE.Vector2(r,y))
const crownGeo=new THREE.LatheGeometry(profile,20)
const verts=crownGeo.attributes.position
for(let i=0;i<verts.count;i++) {
  const x=verts.getX(i),y=verts.getY(i),z=verts.getZ(i),a=Math.atan2(z,x)
  const lobes=1+Math.sin(a*5+y*1.4+.6)*.13+Math.sin(a*3+1.2)*.10
  verts.setXYZ(i,x*lobes+Math.pow(y/1.64,2)*.20,y+Math.cos(a*5)*.08*Math.max(0,1-y),z*lobes)
}
verts.needsUpdate=true;crownGeo.computeVertexNormals()
const foliage=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1})
curve(foliage)
const crowns=new THREE.InstancedMesh(crownGeo,foliage,treeSpecs.length*4)
const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.065,.12,1,7),bark,treeSpecs.length)
curve(bark);crowns.castShadow=crowns.receiveShadow=trunks.castShadow=true
const transform=new THREE.Object3D(),tint=new THREE.Color()
treeSpecs.forEach(([x,z,h],i)=>{
  h*=.79
  addObstacle(x,z,x,z,h*.078,4)
  transform.position.set(x,GY+h*.34,z);transform.rotation.set(0,i*1.73,.025*Math.sin(i));transform.scale.set(h*.65,h*.68,h*.65);transform.updateMatrix();trunks.setMatrixAt(i,transform.matrix)
  for(let tier=0;tier<4;tier++) {
    const width=h*(.265-tier*.048)*(1+.055*Math.sin(i*2.8+tier))
    transform.position.set(x+Math.sin(i*3.1+tier)*.15,GY+h*(.25+tier*.17),z+Math.cos(i+tier)*.12)
    transform.rotation.set(.025*Math.sin(i),i*1.73+tier*.8,.055*Math.cos(i*2+tier));transform.scale.set(width,h*(.27-tier*.014),width*(.85+.08*Math.sin(i)))
    transform.updateMatrix();crowns.setMatrixAt(i*4+tier,transform.matrix)
    tint.setHSL(.39+(i%3)*.015,.24,.19+tier*.025+(i%2)*.018);crowns.setColorAt(i*4+tier,tint)
  }
})
scene.add(crowns,trunks)
campsiteModels.fir = { crowns, trunks }
// Lower broadleaf clumps soften the fir silhouettes at the sides.
const leafMats=[0x3b604b,0x4a6b51,0x527357].map(color=>new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true}))
for(const [i,[x,z,h]] of [[-16.4,-3,3.4],[16.1,-2,3.8],[-13.3,8.5,3.1],[13.2,10.4,3.3]].entries()) {
  addObstacle(x,z,x,z,.19,3)
  const parts = [mesh(branchGeometry(.10,.22,h*.64),bark,x,GY+h*.32,z)]
  for(let j=0;j<3;j++) {
    const a=j*2.4+i, start=new THREE.Vector3(x,GY+h*.40,z),end=new THREE.Vector3(x+Math.cos(a)*.6,GY+h*.64,z+Math.sin(a)*.6)
    const fork=mesh(new THREE.TubeGeometry(new THREE.LineCurve3(start,end),4,.065,8,false),bark,0,0,0);parts.push(fork)
  }
  for(let j=0;j<5;j++) {
    const a=j*2.4+i
    const crown=mesh(new THREE.DodecahedronGeometry(1,1),leafMats[(i+j)%3],x+Math.cos(a)*.55,GY+h*.65+(j%3)*.35,z+Math.sin(a)*.48)
    crown.scale.set(.95+(j%2)*.25,.8,1.1);crown.rotation.set(j*.3,a,.1*Math.sin(j))
    parts.push(crown)
  }
  campsiteModels.broadleaf.push(parts)
}
// Bark, cut ends, and short legs make the seats read as real timber.
const benchBark=woodMaterial()
const cutWood=woodMaterial(0xf2dab0,false)
const rings=new THREE.MeshStandardMaterial({color:0x88714d,roughness:1})
for(const a of [.9,2.9,4.9]) {
  const x=Math.cos(a)*4.1,z=Math.sin(a)*4.1
  addObstacle(x+Math.sin(a)*1.55,z-Math.cos(a)*1.55,x-Math.sin(a)*1.55,z+Math.cos(a)*1.55,.26,.58)
  const bench=new THREE.Group();bench.position.set(Math.cos(a)*4.1,GY,Math.sin(a)*4.1);bench.rotation.y=-a
  const log=new THREE.Mesh(branchGeometry(.25,.26,3.1,20),benchBark);log.rotation.x=Math.PI/2;log.position.y=.32;bench.add(log)
  for(const side of [-1,1]) {
    const end=new THREE.Mesh(new THREE.CircleGeometry(.225,12),cutWood);end.position.set(0,.32,side*1.56);end.rotation.y=side<0?Math.PI:0;bench.add(end)
    for(const radius of [.08,.15,.20]) {
      const growth=new THREE.Mesh(new THREE.RingGeometry(radius-.007,radius+.007,24),rings);growth.position.set(.025,.31,side*1.563);growth.rotation.y=end.rotation.y;bench.add(growth)
    }
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.12,.15,.32,7),benchBark);foot.position.set(0,.15,side*.9);bench.add(foot)
  }
  bench.traverse(o=>{if(o.isMesh){curve(o.material);o.castShadow=o.receiveShadow=true}});scene.add(bench)
  campsiteModels.benches.push(bench)
}
// A quieter layer of leaf litter, clustered beyond the worn fire circle.
const leafGeo=new THREE.CircleGeometry(.055,5),leafMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,side:THREE.DoubleSide})
curve(leafMat)
const leaves=new THREE.InstancedMesh(leafGeo,leafMat,180)
for(let i=0;i<180;i++) {
  const a=i*2.399963,r=5.2+(Math.sin(i*13.1)*.5+.5)*11
  transform.position.set(Math.cos(a)*r,GY+.012,Math.sin(a)*r);transform.rotation.set(-Math.PI/2,0,i*1.67);transform.scale.set(1.8,.7,1);transform.updateMatrix();leaves.setMatrixAt(i,transform.matrix)
  tint.setHSL(.10+(i%5)*.015,.23,.26+(i%4)*.026);leaves.setColorAt(i,tint)
}
scene.add(leaves)
const clearing = document.createElement('canvas'); clearing.width = clearing.height = 256
const g = clearing.getContext('2d')
const dirt = g.createRadialGradient(128, 128, 40, 128, 128, 125)
dirt.addColorStop(0, 'rgba(155,132,91,.72)'); dirt.addColorStop(.65, 'rgba(139,123,89,.48)'); dirt.addColorStop(1, 'rgba(139,123,89,0)')
g.fillStyle = dirt; g.fillRect(0, 0, 256, 256)
const patch = mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(clearing), transparent: true, depthWrite: false, roughness: 1 }), 0, GY + .006, 0)
patch.rotation.x = -Math.PI / 2; patch.renderOrder = -1
const metal = new THREE.MeshStandardMaterial({ color: 0x293b35, roughness: .85 })
const lamp = new THREE.MeshBasicMaterial({ color: 0xffd09a })
const halo = softCircleTexture(.05)
for (const [x,z] of [[-5.8,-2.7],[5.9,-2.8],[-6.8,5.6],[6.8,5.6]]) {
  addObstacle(x,z,x,z,.09,2)
  const parts = [mesh(branchGeometry(.07,.09,1.19), bark, x, GY + .595, z),
    mesh(new THREE.CylinderGeometry(.07,.235,.17,4), metal, x, GY + 1.66, z),
    mesh(new THREE.BoxGeometry(.23,.33,.23), lamp, x, GY + 1.44, z),
    mesh(new THREE.BoxGeometry(.30,.08,.30), metal, x, GY + 1.23, z)]
  parts[1].rotation.y=Math.PI/4
  for(const dx of [-.13,.13])for(const dz of [-.13,.13])parts.push(mesh(new THREE.CylinderGeometry(.013,.013,.39,8),metal,x+dx,GY+1.44,z+dz))
  const handle=mesh(new THREE.TorusGeometry(.081,.009,6,20,Math.PI),metal,x,GY+1.755,z);parts.push(handle)
  parts.push(mesh(new THREE.CylinderGeometry(.09,.09,.065,12),metal,x,GY+1.17,z))
  campsiteModels.lanterns.push(parts)
  const light = new THREE.PointLight(0xffc58a, 3.4, 9, 2); light.position.set(x,GY + 1.44,z); scene.add(light)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: 0xffbf72, transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending }))
  curve(glow.material);campsiteModels.glows.push(glow)
  glow.scale.set(1.5,1.5,1); glow.position.copy(light.position); scene.add(glow)
}

// A low festoon of lights frames the gathering without blocking the shore.
const cable = new THREE.MeshStandardMaterial({ color: 0x293d38, roughness: 1 })
for (const x of [-7,7]) {
  addObstacle(x,-6,x,-6,.10,3.3)
  campsiteModels.festoon.push(mesh(new THREE.CylinderGeometry(.06,.10,3.3,8),bark,x,GY+1.65,-6))
}
const points = []
for (let i=0;i<=32;i++) {
  const u=i/32
  points.push(new THREE.Vector3(-7+14*u,GY+3.3-Math.sin(u*Math.PI)*.7,-6))
}
const curvePath=new THREE.CatmullRomCurve3(points)
campsiteModels.festoon.push(mesh(new THREE.TubeGeometry(curvePath,40,.02,5,false),cable,0,0,0))
const bulbGeometry=new THREE.SphereGeometry(.085,8,6)
for(let i=1;i<14;i++) {
  const p=curvePath.getPointAt(i/14)
  campsiteModels.festoon.push(mesh(new THREE.CylinderGeometry(.041,.038,.075,10),metal,p.x,p.y-.06,p.z))
  campsiteModels.festoon.push(mesh(bulbGeometry,lamp,p.x,p.y-.13,p.z))
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:halo,color:0xffce8a,transparent:true,opacity:.24,depthWrite:false,blending:THREE.AdditiveBlending}))
  curve(glow.material);campsiteModels.glows.push(glow)
  glow.position.set(p.x,p.y-.13,p.z);glow.scale.set(.6,.6,1);scene.add(glow)
}
