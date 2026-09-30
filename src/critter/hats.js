import * as THREE from 'three'
import { curve } from '../world/scene.js'

const up = new THREE.Vector3(0, 1, 0)
const material = (color, extra = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: .82, ...extra })
  curve(m); return m
}
function piece(g, geometry, color, x = 0, y = 0, z = 0, extra = {}) {
  const m = new THREE.Mesh(geometry, material(color, extra))
  m.position.set(x, y, z); m.castShadow = true; g.add(m); return m
}
function ring(g, radius, tube, color, y) {
  const m = piece(g, new THREE.TorusGeometry(radius, tube, 6, 32), color, 0, y)
  m.rotation.x = Math.PI / 2; return m
}
function lathe(g, points, color) {
  return piece(g, new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 32), color)
}
function starGeometry(radius) {
  const shape = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 + Math.PI / 2, r = i % 2 ? radius * .45 : radius
    const x = Math.cos(a) * r, y = Math.sin(a) * r
    i ? shape.lineTo(x, y) : shape.moveTo(x, y)
  }
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth: .004, bevelEnabled: false })
}

const builders = [
  function party() {
    const g = new THREE.Group(), height = .34
    for (let i = 0; i < 6; i++) {
      const low = i / 6, high = (i + 1) / 6
      piece(g, new THREE.CylinderGeometry(.16 * (1 - high), .16 * (1 - low), height / 6, 32), i % 2 ? 0xf1d59c : 0xc96380, 0, (low + high) * height / 2)
    }
    ring(g, .156, .009, 0xf1d59c, .012)
    piece(g, new THREE.SphereGeometry(.038, 12, 8), 0xf3dfb0, 0, .36)
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5
      piece(g, new THREE.SphereGeometry(.014, 8, 6), 0xf3dfb0, Math.cos(a) * .027, .362 + Math.sin(i) * .012, Math.sin(a) * .027)
    }
    return g
  },
  function topHat() {
    const g = new THREE.Group()
    lathe(g, [[0,.008],[.23,.008],[.24,.018],[.23,.03],[.159,.033],[.149,.08],[.143,.23],[.156,.32],[0,.32]], 0x34313f)
    ring(g, .231, .006, 0x59505d, .019)
    piece(g, new THREE.CylinderGeometry(.151,.158,.05,32), 0xa65e67, 0, .077)
    const buckle = piece(g, new THREE.TorusGeometry(.022,.005,5,4), 0xdab77b, 0,.077,.158)
    buckle.rotation.z = Math.PI / 4; buckle.scale.set(1.1,.8,1)
    return g
  },
  function wizard() {
    const g = new THREE.Group()
    lathe(g, [[0,.008],[.245,.008],[.253,.02],[.244,.035],[.152,.038],[.142,.1],[.12,.18],[.082,.28],[.037,.37],[.008,.45],[0,.46]], 0x54577f)
    const crown = g.children[0], p = crown.geometry.attributes.position
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i,p.getX(i)+Math.pow(Math.max(0,y-.16)/.3,2)*.13) }
    crown.geometry.computeVertexNormals()
    ring(g,.247,.006,0x9892b4,.022)
    piece(g,new THREE.CylinderGeometry(.142,.153,.033,32),0x82719b,0,.065)
    for (const [a,y,r] of [[0,.19,.027],[2,.26,.021],[4,.14,.021]]) {
      const x = Math.sin(a), z = Math.cos(a)
      const radius = y>.18 ? .12-(y-.18)*.38 : .142-(y-.1)*.275
      const bend=Math.pow(Math.max(0,y-.16)/.3,2)*.13
      const star = piece(g,starGeometry(r),0xe8c98a,x*(radius+.006)+bend,y,z*(radius+.006))
      star.rotation.set(-.25,a,0)
    }
    return g
  },
  function crown() {
    const g = new THREE.Group(), n = 80, vertices = [], indices = []
    // One continuous crown wall, with a rounded base and alternating points.
    for (let i = 0; i <= n; i++) {
      const a = i/n*Math.PI*2, h = .115 + .055 * Math.pow((Math.cos(a*5)+1)/2,3)
      for (const [r,y] of [[.15,.005],[.17,.05],[.173,h],[.16,h],[.157,.05],[.142,.005]]) vertices.push(Math.sin(a)*r,y,Math.cos(a)*r)
    }
    for(let i=0;i<n;i++) for(let j=0;j<5;j++) { const k=i*6+j;indices.push(k,k+6,k+1,k+1,k+6,k+7) }
    const geo = new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals()
    piece(g,geo,0xd9ad59,0,0,0,{side:THREE.DoubleSide})
    ring(g,.158,.009,0xf2ce83,.025)
    for (let i=0;i<5;i++) {
      const a=i*Math.PI*2/5
      piece(g,new THREE.SphereGeometry(.014,10,7),0xf2ce83,Math.sin(a)*.173,.177,Math.cos(a)*.173)
      const setting=piece(g,new THREE.SphereGeometry(.028,12,8),0xf2ce83,Math.sin(a)*.17,.087,Math.cos(a)*.17);setting.scale.set(1,1,.35);setting.rotation.y=a
      const gem=piece(g,new THREE.OctahedronGeometry(.020),i?0x649a94:0xb76578,Math.sin(a)*.179,.087,Math.cos(a)*.179);gem.scale.z=.4;gem.rotation.y=a
    }
    return g
  },
  function toadstool() {
    const g = new THREE.Group(), radius = .22, squash = .72
    const cap=piece(g,new THREE.SphereGeometry(radius,32,16,0,Math.PI*2,0,Math.PI/2),0xb86350);cap.scale.y=squash
    const underside=piece(g,new THREE.CircleGeometry(.217,32),0xe4d2ac,0,.002);underside.rotation.x=Math.PI/2
    ring(g,.212,.008,0xe4d2ac,.006)
    for (let i=0;i<7;i++) {
      const a=i*2.39996,r=i===0?.018:.085+(i%3)*.039
      const x=Math.cos(a)*r,z=Math.sin(a)*r,y=Math.sqrt(radius*radius-r*r)*squash
      const dot=piece(g,new THREE.SphereGeometry(1,16,10),0xf4e7cf,x,y-.001,z)
      dot.scale.set(.025+(i%2)*.006,.004,.022+(i%3)*.003)
      dot.quaternion.setFromUnitVectors(up,new THREE.Vector3(x,y/(squash*squash),z).normalize())
    }
    return g
  },
  function daisy() {
    const g = new THREE.Group()
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4, p=piece(g,new THREE.SphereGeometry(1,16,10),i%2?0xf2e4dd:0xffeee2,Math.cos(a)*.104,.027,Math.sin(a)*.104)
      p.scale.set(.089,.017,.04);p.rotation.y=-a;p.rotation.z=Math.sin(i)*.06
    }
    const center=piece(g,new THREE.SphereGeometry(.055,16,10),0xd6a957,0,.04);center.scale.y=.6
    for(let i=0;i<9;i++){const a=i*2.4,r=.013+Math.sqrt(i/9)*.027;piece(g,new THREE.SphereGeometry(.0045,6,4),0xf2d294,Math.cos(a)*r,.069-r*.2,Math.sin(a)*r)}
    return g
  },
  function halo() {
    const g = new THREE.Group()
    const h=ring(g,.16,.014,0xf1d69a,.16);h.material.emissive.set(0xab7335);h.material.emissiveIntensity=.45
    ring(g,.16,.004,0xffecd1,.173)
    g.userData.float=true;return g
  },
  function beanie() {
    const g = new THREE.Group(), colors=[0x659b99,0xcdad6e,0xba7470]
    for(let i=0;i<6;i++) {
      const panel=piece(g,new THREE.SphereGeometry(.19,8,12,i*Math.PI/3,Math.PI/3,0,Math.PI/2),colors[i%3]);panel.scale.y=.68
    }
    ring(g,.178,.022,0x4e8586,.019)
    piece(g,new THREE.CylinderGeometry(.009,.012,.061,10),0xcab78b,0,.15)
    piece(g,new THREE.SphereGeometry(.024,12,8),0xcab78b,0,.187)
    const prop=new THREE.Group()
    for(const [x,z] of [[-.092,0],[.092,0],[0,-.092],[0,.092]]) {
      const blade=piece(prop,new THREE.SphereGeometry(1,16,8),x?0xe2be79:0xc47768,x,0,z)
      blade.scale.set(x?.098:.029,.008,x?.029:.098)
    }
    prop.position.y=.19;g.add(prop);g.userData.prop=prop;return g
  },
]
export const makeHat = id => {
  if (!builders[id]) throw new Error('Unknown hat model: ' + id)
  return builders[id]()
}
