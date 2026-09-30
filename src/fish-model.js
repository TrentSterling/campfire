import * as THREE from 'three'
import { curve } from './world/scene.js'

// Species alter the silhouette, fins and markings. The shared seed still owns
// the catch, colour, length and rarity; nothing additional crosses the wire.
const forms = {
  Chub:[1,.72,.64,.7], Minnow:[1.3,.40,.40,.65], Gulper:[.93,.92,.8,.55],
  Bloop:[.85,1,.9,.65], Snapper:[1.13,.72,.55,.75], Wisp:[1.55,.32,.32,1.15],
  Carp:[1.06,.9,.65,.75], Puffer:[.82,1.2,1.12,.48], Sardine:[1.35,.46,.4,.8],
  Koi:[1.25,.61,.57,.88], Dab:[1.1,.73,.22,.55], Guppy:[.86,.6,.48,1.5],
}
const mat = (color, extra={}) => {const m=new THREE.MeshStandardMaterial({color,roughness:.8,...extra});curve(m);return m}
const finShape = points => {
  const s=new THREE.Shape();s.moveTo(...points[0]);for(const p of points.slice(1))s.lineTo(...p);s.closePath()
  return new THREE.ExtrudeGeometry(s,{depth:.015,bevelEnabled:true,bevelThickness:.004,bevelSize:.008,bevelSegments:1})
}
export function makeFishMesh(f) {
  const g=new THREE.Group(),species=f.name.split(' ').pop()
  const [long,tall,baseWidth,fan]=forms[species] || forms.Chub
  const height=species==='Puffer'||species==='Bloop'?long*(.92+(f.fat-.7)*.18):tall*f.fat
  const wide=species==='Puffer'?height*.94:baseWidth
  const col=new THREE.Color().setHSL(f.golden?.12:f.hue,f.golden?.72:.37,f.golden?.58:.53)
  if(species==='Koi'&&!f.golden)col.set(0xf0dfbd)
  const bodyMat=mat(col,f.golden?{emissive:0x704518,emissiveIntensity:.4}:{}),finMat=mat(col.clone().multiplyScalar(.78),{side:THREE.DoubleSide})
  const body=new THREE.Mesh(new THREE.SphereGeometry(.5,32,20),bodyMat)
  body.scale.set(long,height,wide);g.add(body)
  const tailRoot=-.40*long,tailTip=tailRoot-.34*fan
  const tail=new THREE.Mesh(finShape([[tailRoot,0],[tailTip,.25*fan],[tailTip+.065*fan,0],[tailTip,-.25*fan]]),finMat)
  tail.position.z=-.0075;g.add(tail)
  const dorsalPoints=species==='Snapper' ? [[-.28*long,height*.29],[-.29*long,height*.57],[-.18*long,height*.42],[-.12*long,height*.66],[0,height*.48],[.1*long,height*.63],[.19*long,height*.38]] : [[-.27*long,height*.32],[-.17*long,height*.60],[.13*long,height*.43]]
  const dorsal=new THREE.Mesh(finShape(dorsalPoints),finMat);dorsal.position.z=-.0075;g.add(dorsal)
  for(const side of [-1,1]) {
    const pectoral=new THREE.Mesh(finShape([[.07,-height*.1],[-.07,-height*.33],[-.15,-height*.1]]),finMat)
    pectoral.position.set(0,0,side*wide*.43);pectoral.rotation.x=-side*.55;g.add(pectoral)
    const eyes=species==='Dab'&&side<0?[]:species==='Dab'?[.23,.35]:[.32]
    for(const ex of eyes) {
      const x=ex*long,y=species==='Dab'?(ex===.23?.12:.015)*height:.10*height
      const z=side*(wide*.5*Math.sqrt(Math.max(0,1-Math.pow(ex/.5,2)-Math.pow(y/(height*.5),2)))+.012)
      const eye=new THREE.Mesh(new THREE.SphereGeometry(.043,16,10),mat(0xf4ead6));eye.scale.z=.48;eye.position.set(x,y,z);g.add(eye)
      const pupil=new THREE.Mesh(new THREE.SphereGeometry(.025,12,8),mat(0x263530));pupil.scale.z=.42;pupil.position.set(x+.007,y, z+side*.018);g.add(pupil)
    }
    const points=[]
    for(let i=0;i<=10;i++){const a=-1.1+i*.22;points.push(new THREE.Vector3(.19*long+Math.cos(a)*.042,Math.sin(a)*height*.17,side*wide*.45))}
    const gill=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),12,.007,5,false),finMat);g.add(gill)
  }
  const mouthRadius=species==='Gulper'?.105:species==='Bloop'?.07:.035
  const mouth=new THREE.Mesh(new THREE.TorusGeometry(mouthRadius,.009,6,18),finMat)
  mouth.rotation.y=Math.PI/2;mouth.position.set(.495*long,-height*.05,0);g.add(mouth)
  if(species==='Sardine'||species==='Minnow'||species==='Wisp') {
    const stripeMat=mat(col.clone().lerp(new THREE.Color(0xf3e8d1),.6),{side:THREE.DoubleSide})
    for(const side of [-1,1]) {
      const positions=[],indices=[],steps=28
      for(let i=0;i<=steps;i++)for(const edge of [-1,1]) {
        const x=(-.39+.70*i/steps)*long,y=(.025+edge*.025)*height
        const z=side*(wide*.5*Math.sqrt(Math.max(0,1-Math.pow(x/(long*.5),2)-Math.pow(y/(height*.5),2)))+.0025)
        positions.push(x,y,z)
      }
      for(let i=0;i<steps;i++){const j=i*2;indices.push(j,j+2,j+1,j+1,j+2,j+3)}
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals()
      g.add(new THREE.Mesh(geometry,stripeMat))
    }
  }
  if(species==='Koi') for(const [x,y,z,r] of [[-.4,.5,.7,.13],[.35,.3,-.8,.11],[.05,1,0,.14]]) {
    const n=new THREE.Vector3(x,y,z).normalize(), normal=new THREE.Vector3(n.x/long,n.y/height,n.z/wide).normalize()
    const spot=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),mat(0xb7684d))
    spot.position.set(n.x*long*.5,n.y*height*.5,n.z*wide*.5);spot.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);spot.scale.set(r,.008,r*.8);g.add(spot)
  }
  if(species==='Puffer') for(let i=0;i<22;i++) {
    const y=1-2*(i+.5)/22,r=Math.sqrt(1-y*y),a=i*2.39996,n=new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r)
    if(n.x>.6)continue
    const spine=new THREE.Mesh(new THREE.ConeGeometry(.024,.09,7),finMat)
    spine.position.set(n.x*long*.50,n.y*height*.50,n.z*wide*.50);spine.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),n);g.add(spine)
  }
  if(species==='Carp')for(const side of [-1,1]) {
    const barb=new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(.47*long,-height*.06,side*.025),new THREE.Vector3(.51*long,-height*.14,side*.09),new THREE.Vector3(.43*long,-height*.2,side*.12)),8,.009,5,false),finMat);g.add(barb)
  }
  if(species==='Guppy') {
    for(const y of [-.20,-.08,.08,.20]) {const ray=new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(tailRoot,0,.012),new THREE.Vector3(tailTip+.03,y*fan,.012)),1,.006,5,false),mat(0xe6c89d));g.add(ray)}
  }
  g.scale.setScalar(.35+f.len/100*1.5)
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=false}})
  return g
}
