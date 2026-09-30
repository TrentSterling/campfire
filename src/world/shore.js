import * as THREE from 'three'
import { scene,curve,GY } from './scene.js'
import { woodMaterial, branchGeometry } from './materials.js'

// Quiet water movement and a small fishing landing give the shore a destination.
const mat=(color)=>{const m=new THREE.MeshStandardMaterial({color,roughness:.95});curve(m);return m}
const wood=woodMaterial(0xe0c9a5,false),endGrain=woodMaterial(0xa3937c),rope=mat(0xa19571),iron=mat(0x5c6256)
const dock=new THREE.Group(),a=1.98,x=Math.cos(a)*17.7,z=Math.sin(a)*17.7
for(let i=0;i<8;i++) {
  const plank=new THREE.Mesh(new THREE.BoxGeometry(1.7,.10,.30),i%3?wood:endGrain)
  plank.position.set(Math.sin(i*19)*.018,.06+Math.sin(i*12)*.005,-.9+i*.33);plank.rotation.y=Math.sin(i*17)*.012;plank.castShadow=plank.receiveShadow=true;dock.add(plank)
  for(const px of [-.68,.68]) {
    const nail=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,.009,8),iron);nail.position.set(px,.117,-.9+i*.33);dock.add(nail)
  }
}
for(const [px,pz] of [[-.78,-.95],[.78,-.95],[-.78,1.45],[.78,1.45]]) {
  const post=new THREE.Mesh(branchGeometry(.10,.14,3.1),endGrain)
  post.position.set(px,-.95,pz);post.castShadow=true;dock.add(post)
  const band=new THREE.Mesh(new THREE.TorusGeometry(.11,.025,5,10),rope)
  band.rotation.x=Math.PI/2;band.position.set(px,.36,pz);dock.add(band)
  const band2=band.clone();band2.position.y=.31;dock.add(band2)
}
for(const px of [-.60,.60]) {
  const beam=new THREE.Mesh(new THREE.BoxGeometry(.09,.14,2.75),endGrain);beam.position.set(px,-.07,.25);dock.add(beam)
}
dock.position.set(x,GY+.03,z);dock.rotation.y=-a+Math.PI/2;scene.add(dock)

const reedsMat=mat(0x617e59);reedsMat.side=THREE.DoubleSide
const positions=[],indices=[]
for(let blade=0;blade<3;blade++)for(let j=0;j<=7;j++) {
  const t=j/7,h=.7+blade*.14,a=blade*2.4,w=.041*Math.sin(Math.PI*t)*(.7+blade*.1)
  const x=Math.cos(a)*t*t*.24,z=Math.sin(a)*t*t*.24
  for(const side of [-1,1])positions.push(x+Math.cos(a+.8)*w*side,t*h,z+Math.sin(a+.8)*w*side)
  if(j<7){const k=blade*16+j*2;indices.push(k,k+2,k+1,k+1,k+2,k+3)}
}
const reedsGeo=new THREE.BufferGeometry();reedsGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));reedsGeo.setIndex(indices);reedsGeo.computeVertexNormals()
const reeds=new THREE.InstancedMesh(reedsGeo,reedsMat,90),o=new THREE.Object3D()
for(let i=0;i<90;i++) {
  const angle=i*.381+Math.sin(i*7)*.06,r=17.2+Math.sin(i*11)*.3
  o.position.set(Math.cos(angle)*r,GY-.24,Math.sin(angle)*r)
  o.rotation.set(.07*Math.sin(i),i*2.4,.07*Math.cos(i));o.scale.set(1,.6+(i%7)*.1,1);o.updateMatrix();reeds.setMatrixAt(i,o.matrix)
}
scene.add(reeds)
export const shoreModels = { dock, reeds }
const rippleMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
  uniforms:{time:{value:0}},vertexShader:`varying vec3 vP;void main(){vP=position;vec4 p=modelViewMatrix*vec4(position,1.);p.y-=.0013*dot(p.xz,p.xz);gl_Position=projectionMatrix*p;}`,
  fragmentShader:`varying vec3 vP;uniform float time;
    void main(){float r=length(vP.xy);float wave=sin(r*5.5-time*.65+sin(atan(vP.y,vP.x)*7.+time*.13)*.16);
    float foam=smoothstep(.92,1.,wave)*(.05+.1*(1.-smoothstep(18.,22.,r)));
    gl_FragColor=vec4(.43,.65,.65,foam);}`})
const ring=new THREE.Mesh(new THREE.RingGeometry(19.1,38,128,5),rippleMaterial)
ring.rotation.x=-Math.PI/2;ring.position.y=-1.18;scene.add(ring)
export function updateShore(t){rippleMaterial.uniforms.time.value=t}
