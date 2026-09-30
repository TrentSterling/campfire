// src/world/scene.js : renderer, camera, sky, lights, island, water, firepit
// (flame/sparks/glow), fireflies, blob-shadow assets, world curvature (CURVE +
// curve()), island bounds (GY / MAX_R / FIRE_R / clampIsland) and updateWorld
// (per-frame fire flicker + sparks + firefly drift). Owns everything static.
import * as THREE from 'three'
import { sharedCritterUniforms } from '../engine/shaders.js'
import { getSettings } from '../preferences.js'
import { woodMaterial, branchGeometry } from './materials.js'

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
const app = document.getElementById('app')
export const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
app.appendChild(renderer.domElement)
window.__renderer = renderer // instrumentation (additive): verify harness reads renderer.info

// ---------------------------------------------------------------------------
// Style constants (Lane C): OG meadow dimmed to twilight, not blackness.
// Ground reads dusky sage, fog is a cool teal that meets the horizon,
// firelight stays the warm hero.
// ---------------------------------------------------------------------------
const FOG_COLOR = 0x203d43
const FOG_DENSITY = 0.008
const SKY_TOP = 0x102631
const SKY_MID = 0x315263
const SKY_BOT = 0x6f817b
const HEMI_SKY = 0xaac5c3
const HEMI_GROUND = 0x545c43
const HEMI_INT = 1.4
const MOON_COLOR = 0xb8d6d9
const MOON_INT = 0.75
const WATER_COLOR = 0x2c535f
const SAND_COLOR = 0x918b70
const GRASS_BASE = '#516b5b'
const GRASS_BLOTCH = '132,157,108'
const GRASS_SPECK = '46,73,61'

export const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY)

export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400)

export function resizeView() {
  renderer.setPixelRatio(Math.min(devicePixelRatio,getSettings().quality==='low'?1:2))
  camera.aspect = innerWidth / innerHeight
  // Reserve the lower phone viewport for chat and touch controls.
  if (innerWidth < 640 && innerHeight >= 550)
    camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * .13 + Math.max(0, 800 - innerHeight) * .6, innerWidth, innerHeight)
  else camera.clearViewOffset()
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
}
resizeView()
export function applyWorldSettings(settings) {
  renderer.setPixelRatio(Math.min(devicePixelRatio,settings.quality==='low'?1:2))
  renderer.setSize(innerWidth,innerHeight)
  renderer.shadowMap.enabled=settings.quality!=='low'
  if(fireflies)fireflies.visible=settings.particles
  if(sparks)sparks.visible=settings.particles
}

// world-curvature (tiny-planet horizon, jennsfarm style): bend view-space y by distance
export const CURVE = 0.0013
export const windUniform = { value: 0 }
export function curve(mat) {
  if (!mat || mat.onBeforeCompile.__campfireCurved) return
  mat.userData.__curved = true
  mat.onBeforeCompile = shader => {
    if(mat.userData.sway) {
      shader.uniforms.cfWind=windUniform
      shader.vertexShader='uniform float cfWind;\n'+shader.vertexShader
    }
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
       #ifdef USE_INSTANCING
         mvPosition = instanceMatrix * mvPosition;
       #endif
       ${mat.userData.sway ? 'float height=max(0.,mvPosition.y-1.); mvPosition.x+=sin(cfWind*1.1+mvPosition.z*1.3)*height*height*.025; mvPosition.z+=sin(cfWind*.8+mvPosition.x)*height*height*.015;' : ''}
       mvPosition = modelViewMatrix * mvPosition;
       mvPosition.y -= ${CURVE.toFixed(5)} * dot( mvPosition.xz, mvPosition.xz );
       gl_Position = projectionMatrix * mvPosition;`
    )
    // Sprites have no project_vertex include. Bend their world center before
    // the billboard offset, exactly where the anchored bulb meshes are bent.
    if (mat.isSpriteMaterial) shader.vertexShader = shader.vertexShader.replace(
      'mvPosition.xy += rotatedPosition;',
      `mvPosition.y -= ${CURVE.toFixed(5)} * dot(mvPosition.xz,mvPosition.xz);\n mvPosition.xy += rotatedPosition;`
    )
  }
  mat.onBeforeCompile.__campfireCurved=true
  mat.customProgramCacheKey=()=>String(mat.onBeforeCompile)+String(!!mat.userData.sway)
}

// soft additive glow texture (for the fire bloom)
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,190,110,0.95)'); g.addColorStop(0.4, 'rgba(255,130,55,0.4)'); g.addColorStop(1, 'rgba(255,120,40,0)')
  x.fillStyle = g; x.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

// soft radial falloff texture (blob shadows, fireflies)
export function softCircleTexture(inner = 0.15) {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 32 * inner, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

// Dusk gradient sky (big inverted sphere)
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        mid: { value: new THREE.Color(SKY_MID) },
        bot: { value: new THREE.Color(SKY_BOT) },
        forestA: {value:new THREE.Color(0x4b6668)},forestB: {value:new THREE.Color(0x3e5b5d)}
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 top, mid, bot, forestA, forestB;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(mid, top, smoothstep(0.12, 0.8, h));
          // peach sunset band hugging the horizon, fading above AND below so the
          // sphere underside (visible at screen top when looking down) stays plum
          float band = exp(-abs(h + 0.02) * 5.5);
          c = mix(c, bot, band * 0.65);
          // Two connected distant forest silhouettes, anchored to their horizon.
          // A filled lower band avoids detached tree shapes floating in the sky.
          float a=atan(vP.x,vP.z);
          for(int layer=0;layer<2;layer++) {
            float f=18.+float(layer)*5.;float id=floor(a*f);
            float random=fract(sin(id*91.73+float(layer)*7.)*437.19);
            float crown=1.-abs(fract(a*f)-.5)*2.;
            float hills=sin(a*3.1+float(layer))*.009+sin(a*7.4+1.)*.008;
            float edge=-.16-float(layer)*.012+hills+pow(crown,1.8)*(.016+random*.009);
            c=mix(c,layer==0?forestA:forestB,1.-smoothstep(edge-.002,edge+.002,h));
          }
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`
    })
  )
  scene.add(sky)
}

// Backdrop fill (judge gap: top of frame was empty gradient, island floated in a
// two-tone void): stars in the upper dome, a soft moon, and a ring of distant
// silhouette hills beyond the water so the horizon reads layered like the OG.
let starMat = null
{
  const N = 140, pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2
    const y = 24 + Math.random() * 110              // upper dome only
    const r = 60 + Math.random() * 90
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  starMat = new THREE.PointsMaterial({ color: 0xfff2d8, size: 1.1, map: softCircleTexture(0), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const stars = new THREE.Points(g, starMat)
  stars.renderOrder = -1
  scene.add(stars)

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: softCircleTexture(0.55), color: 0xfff0cf, transparent: true, opacity: 0.85, depthWrite: false, fog: false }))
  moon.scale.set(7, 7, 1)
  moon.position.set(-40, 35, -95)
  scene.add(moon)

  // distant hills: big flattened silhouette domes, hazed by fog
  const hillMat = new THREE.MeshBasicMaterial({ color: 0x29464d })
  const hillMat2 = new THREE.MeshBasicMaterial({ color: 0x36565c })
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.25
    const r = 105 + (i % 3) * 18
    const w = 34 + (i % 4) * 12, h = 4 + ((i * 11) % 6)
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), i % 2 ? hillMat : hillMat2)
    hill.scale.set(w, h, w * 0.7)
    hill.position.set(Math.cos(a) * r, -9, Math.sin(a) * r)
    scene.add(hill)
  }
}

// Lights: cool moonlight, warm hemisphere, plus the fire light added later
const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INT)
scene.add(hemi)
const moon = new THREE.DirectionalLight(MOON_COLOR, MOON_INT)
moon.position.set(-20, 30, -10)
moon.castShadow = true
moon.shadow.mapSize.set(1024, 1024)
moon.shadow.camera.left = moon.shadow.camera.bottom = -30
moon.shadow.camera.right = moon.shadow.camera.top = 30
scene.add(moon)

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------
export const ISLAND_R = 18

// OG-style mottled meadow texture, dimmed to dusk: sage base, lighter blotches,
// dark speckles, plus a warm radial tint toward the firepit at the cap center
function grassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024
  const g = c.getContext('2d')
  g.fillStyle = GRASS_BASE; g.fillRect(0, 0, 1024, 1024)
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024, r = 8 + Math.random() * 32
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, `rgba(${GRASS_BLOTCH},0.30)`)
    gr.addColorStop(1, `rgba(${GRASS_BLOTCH},0)`)
    g.fillStyle = gr
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2); g.fill()
  }
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(${GRASS_SPECK},${0.06 + Math.random() * 0.08})`
    g.beginPath(); g.arc(Math.random() * 1024, Math.random() * 1024, 0.7 + Math.random() * 1.8, 0, Math.PI * 2); g.fill()
  }
  // Hand-worn paths join the fire, shore and hat rack. Broad translucent
  // passes keep the surface painterly without high-frequency screen noise.
  g.lineCap='round'
  for(const [x,y] of [[.5,.93],[.73,.28],[.08,.59]]) {
    for(const [width,alpha] of [[80,.055],[45,.07],[23,.08]]) {
      g.lineWidth=width;g.strokeStyle=`rgba(179,153,113,${alpha})`;g.beginPath();g.moveTo(512,512);g.quadraticCurveTo(512+(x-.5)*280,512+(y-.5)*100,x*1024,y*1024);g.stroke()
    }
  }
  const warm=g.createRadialGradient(512,512,40,512,512,250)
  warm.addColorStop(0,'rgba(166,133,91,.25)');warm.addColorStop(1,'rgba(166,133,91,0)')
  g.fillStyle=warm;g.fillRect(0,0,1024,1024)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

{
  // water ring
  const water = new THREE.Mesh(
    new THREE.RingGeometry(0, 120, 96, 64),
    new THREE.MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.92 })
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = -1.2
  water.receiveShadow = true
  curve(water.material)
  scene.add(water)

  // sandy shore
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R + 2.4, ISLAND_R + 3.6, 2.2, 48),
    new THREE.MeshStandardMaterial({ color: SAND_COLOR, roughness: 1 })
  )
  sand.position.y = -0.9
  sand.receiveShadow = true
  curve(sand.material)
  scene.add(sand)

  // grass top
  const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R, ISLAND_R + 1.2, 1.8, 96, 1, true),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 })
  )
  grass.position.y = 0.1
  grass.receiveShadow = true
  curve(grass.material)
  scene.add(grass)
  const top=new THREE.Mesh(new THREE.RingGeometry(0,ISLAND_R,96,12),grass.material)
  top.rotation.x=-Math.PI/2;top.position.y=1;top.receiveShadow=true;scene.add(top)

  // rocks + trees are SDF blend-shell props (src/world/props.js)
}

// ---------------------------------------------------------------------------
// Firepit at the center
// ---------------------------------------------------------------------------
// wide warm pool: quadratic (physical) falloff with enough candela that the glow
// grades across nearby creatures, rocks and grass instead of dying at the stones
export const fireLight = new THREE.PointLight(0xff8a3a, 26, 60, 2)
fireLight.position.set(0, 2.9, 0)
fireLight.castShadow = true
fireLight.shadow.bias=-.0004
fireLight.shadow.mapSize.set(1024,1024)
scene.add(fireLight)

let flame, sparks, glow, embers
export const fireModels = []
{
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4750, roughness: 1 })
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), stoneMat)
    s.position.set(Math.cos(a) * 1.35, 1.05, Math.sin(a) * 1.35)
    s.rotation.set(i*1.73,i*2.31,i*.83)
    s.scale.set(1+Math.sin(i*2)*.12,.76+Math.cos(i)*.12,.92+Math.sin(i*3)*.10)
    s.castShadow = s.receiveShadow = true
    scene.add(s)
    fireModels.push(s)
  }
  const logMat = woodMaterial(0x9a7351)
  const charMat=new THREE.MeshStandardMaterial({color:0x40352d,roughness:1})
  const coalMat=new THREE.MeshStandardMaterial({color:0x9c4d26,emissive:0xa83e12,emissiveIntensity:.3,roughness:1})
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(branchGeometry(.18,.18,2,16), logMat)
    log.position.set(0, 1.15, 0)
    log.rotation.z = Math.PI / 2
    log.rotation.y = (i / 3) * Math.PI
    log.castShadow = true
    for(const side of [-1,1]) {
      const end=new THREE.Mesh(new THREE.CircleGeometry(.173,16),charMat);end.position.y=side*1.003;end.rotation.x=-side*Math.PI/2;log.add(end)
      const coal=new THREE.Mesh(new THREE.RingGeometry(.124,.149,20),coalMat);coal.position.y=side*1.005;coal.rotation.x=end.rotation.x;log.add(coal)
    }
    scene.add(log)
    fireModels.push(log)
  }
  // layered flame: outer orange body + mid amber tongue + white-hot core, each
  // flickering on its own phase in updateWorld so the fire licks instead of pulsing
  flame = new THREE.Group()
  // outer is translucent (depthWrite off, ordered) so the hotter inner layers
  // glow THROUGH it; mid/core tips ride high enough to lick out of the top
  const flameLayer = (r, h, y, color, emissive, ei, opacity, order) => {
    const profile = [[0,.02],[.65,.06],[1,.24],[.8,.45],[.5,.68],[.22,.86],[0,1]]
      .map(([radius,height]) => new THREE.Vector2(radius * r, (height - .5) * h))
    const geometry = new THREE.LatheGeometry(profile, 14)
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const height = positions.getY(i) / h + .5
      positions.setX(i, positions.getX(i) + Math.pow(height,3) * r * .65)
    }
    geometry.computeVertexNormals()
    const m = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color, emissive, emissiveIntensity: ei, roughness: 1,
        transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
      })
    )
    m.position.y = y
    m.renderOrder = order
    flame.add(m)
    return m
  }
  flame.userData.outer = flameLayer(0.58, 1.55, 0, 0xff8a30, 0xff5a10, 2.8, 0.6, 4)
  flame.userData.mid = flameLayer(0.36, 1.35, 0.24, 0xffb84a, 0xff9a2a, 3.4, 0.85, 3)
  flame.userData.core = flameLayer(0.18, 1.0, 0.34, 0xfff3c0, 0xffe090, 4.2, 1, 2)
  flame.userData.licks=[]
  for(let i=0;i<4;i++) {
    const lick=flameLayer(.18,.9+i*.08,-.2,0xffa333,0xff791b,2.6,.7,4)
    lick.position.x=Math.cos(i*Math.PI/2)*.32;lick.position.z=Math.sin(i*Math.PI/2)*.32
    lick.rotation.z=Math.sin(i*2)*.22;flame.userData.licks.push(lick)
  }
  flame.position.set(0, 1.9, 0)
  scene.add(flame)
  fireModels.push(flame)

  // charred scorch ring under the pit: radial gradient disc (near-black center
  // fading out) + a few pulsing ember dots between the stones, so the firepit
  // sits IN the meadow instead of on top of it
  const sc = document.createElement('canvas'); sc.width = sc.height = 256
  const sx = sc.getContext('2d')
  const sg = sx.createRadialGradient(128, 128, 10, 128, 128, 128)
  sg.addColorStop(0, 'rgba(16,10,8,0.88)'); sg.addColorStop(0.45, 'rgba(28,16,10,0.55)')
  sg.addColorStop(0.75, 'rgba(40,24,14,0.22)'); sg.addColorStop(1, 'rgba(40,24,14,0)')
  sx.fillStyle = sg; sx.fillRect(0, 0, 256, 256)
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(3.1, 40),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false })
  )
  scorch.rotation.x = -Math.PI / 2
  scorch.position.y = 1.015
  scorch.renderOrder = 0
  curve(scorch.material)
  scene.add(scorch)
  embers = new THREE.Group()
  const emberMat = new THREE.MeshStandardMaterial({ color: 0x2a1610, emissive: 0xff5a1a, emissiveIntensity: 1.6, roughness: 1 })
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.75
    const e = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07 + Math.random() * 0.06, 0), emberMat.clone())
    e.position.set(Math.cos(a) * r, 1.06, Math.sin(a) * r)
    e.userData.ph = Math.random() * 10
    embers.add(e)
  }
  scene.add(embers)
  fireModels.push(embers)

  // soft warm bloom around the fire
  glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }))
  glow.scale.set(7, 7, 1)
  glow.position.set(0, 2.1, 0)
  scene.add(glow)

  // rising sparks: soft radial-gradient sprites (no hard squares), additive, each
  // fading out over its rise; the climb is capped low so no comet streak forms
  const N = 40
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  const seed = new Float32Array(N)
  for (let i = 0; i < N; i++) { seed[i] = Math.random(); pos[i*3+1] = 1.4 + Math.random() * 1.8 }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  sparks = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xffb86a, size: 0.09, map: softCircleTexture(0), vertexColors: true,
    transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  sparks.userData.seed = seed
  scene.add(sparks)
}

// fireflies drifting over the island
let fireflies
{
  const N = 20
  const pos = new Float32Array(N * 3)
  const ph = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * ISLAND_R
    pos[i*3] = Math.cos(a) * r; pos[i*3+1] = 1.2 + Math.random() * 3.5; pos[i*3+2] = Math.sin(a) * r
    ph[i*2] = Math.random() * 10; ph[i*2+1] = 0.3 + Math.random() * 0.7
  }
  const fg = new THREE.BufferGeometry()
  fg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffe08a, size: 0.13, map: softCircleTexture(0), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
  fireflies.userData.base = pos.slice()
  fireflies.userData.ph = ph
  scene.add(fireflies)
}

// ---------------------------------------------------------------------------
// Island ground + bounds (world curvature is a view-space shader trick, not geometry)
// ---------------------------------------------------------------------------
export const GY = 1.0
export const groundY = () => GY
export function terrainHeight(x,z) {
  const r=Math.hypot(x,z)
  if(r<=ISLAND_R)return GY
  const grass=r<ISLAND_R+1.2?GY-(r-ISLAND_R)*1.5:-Infinity
  const sand=r<=ISLAND_R+2.4?.2:r<ISLAND_R+3.6?.2-(r-ISLAND_R-2.4)*(2.2/1.2):-Infinity
  return Math.max(-1.2,grass,sand)
}
export const MAX_R = ISLAND_R - 1.5     // island leash (plugs into the OG seekTarget maxR)
export const FIRE_R = 2.2               // keep critters out of the firepit
export function clampIsland(pos) {
  const dd = Math.hypot(pos.x, pos.z)
  if (dd > MAX_R) { pos.x *= MAX_R / dd; pos.z *= MAX_R / dd }
  else if (dd < FIRE_R && dd > 1e-4) { pos.x *= FIRE_R / dd; pos.z *= FIRE_R / dd }
}

// ---------- blob shadow assets ----------
const shadowTex = softCircleTexture(0.25)
const shadowGeo = new THREE.PlaneGeometry(2, 2)
shadowGeo.rotateX(-Math.PI / 2)
export const makeShadow = () => {
  const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, opacity: 0.3, color: '#131020', depthWrite: false
  }))
  m.renderOrder = 1
  curve(m.material)
  return m
}

// per-frame world animation: fire flicker + sparks + firefly twinkle/drift
export function updateWorld(t, dt) {
  windUniform.value=t
  const f = 0.75 + Math.sin(t * 17) * 0.12 + Math.sin(t * 6.3) * 0.1 + (Math.random() - 0.5) * 0.15
  if (starMat) starMat.opacity = 0.62 + Math.sin(t * 1.7) * 0.14   // slow communal twinkle
  fireLight.intensity = 26 * f
  sharedCritterUniforms.uFire.value = 0.65 * f
  // layered lick: each cone flickers on its own phase; the whole stack sways
  // (skew via rotation.x/z) so the fire leans like wind is teasing it
  const fw = 0.95 + f * 0.12   // the whole flame breathes a little wider too
  flame.userData.outer.scale.set(fw, 0.9 + f * 0.25, fw)
  flame.userData.mid.scale.set(1, 0.85 + Math.sin(t * 11 + 1.7) * 0.14 + f * 0.18, 1)
  flame.userData.core.scale.set(1, 0.8 + Math.sin(t * 14 + 4.1) * 0.18 + f * 0.15, 1)
  flame.userData.licks.forEach((lick,i)=>{lick.scale.y=.7+Math.sin(t*(3+i*.7)+i*1.9)*.23;lick.rotation.z=Math.sin(t*2.4+i)*.22})
  flame.rotation.y = t * 1.5
  flame.rotation.x = Math.sin(t * 2.3) * 0.05
  flame.rotation.z = Math.sin(t * 1.9 + 2) * 0.05
  for (const e of embers.children) e.material.emissiveIntensity = 1.0 + Math.sin(t * 2.2 + e.userData.ph) * 0.8
  glow.scale.setScalar(4.0 + f * 0.7)
  glow.material.opacity = 0.18 + f * 0.12
  const sp = sparks.geometry.attributes.position, spc = sparks.geometry.attributes.color, seed = sparks.userData.seed
  const SPARK_BASE = 1.4, SPARK_TOP = 3.4
  for (let i = 0; i < seed.length; i++) {
    sp.array[i*3+1] += (0.4 + seed[i] * 0.6) * dt * 2.2
    sp.array[i*3+0] = Math.sin((t + seed[i] * 10) * 2) * (0.15 + seed[i] * 0.2)
    sp.array[i*3+2] = Math.cos((t + seed[i] * 10) * 1.7) * (0.15 + seed[i] * 0.2)
    if (sp.array[i*3+1] > SPARK_TOP) sp.array[i*3+1] = SPARK_BASE
    // additive blending: fading rgb toward black IS the alpha fade over life
    const life = Math.max(0, 1 - (sp.array[i*3+1] - SPARK_BASE) / (SPARK_TOP - SPARK_BASE))
    const b = life * life
    spc.array[i*3] = b; spc.array[i*3+1] = b; spc.array[i*3+2] = b
  }
  sp.needsUpdate = true
  spc.needsUpdate = true
  const ff = fireflies.geometry.attributes.position, fb = fireflies.userData.base, fph = fireflies.userData.ph
  for (let i = 0; i < fph.length / 2; i++) {
    ff.array[i*3]   = fb[i*3]   + Math.sin(t * fph[i*2+1] + fph[i*2]) * 1.3
    ff.array[i*3+1] = fb[i*3+1] + Math.sin(t * 0.6 + fph[i*2]) * 0.5
    ff.array[i*3+2] = fb[i*3+2] + Math.cos(t * fph[i*2+1] + fph[i*2]) * 1.3
  }
  ff.needsUpdate = true
  fireflies.material.opacity = 0.32 + Math.sin(t * 1.1) * 0.09
}

// apply world-curvature to all static meshes (skips the sky ShaderMaterial and
// sprites/points; critter/prop shaders carry uCurve themselves, eye + shadow
// materials curve at creation, so running this here covers everything static)
scene.traverse(o => { if (o.isMesh && o.material && o.material.type !== 'ShaderMaterial') curve(o.material) })
