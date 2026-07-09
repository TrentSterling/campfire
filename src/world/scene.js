// src/world/scene.js : renderer, camera, sky, lights, island, water, firepit
// (flame/sparks/glow), fireflies, blob-shadow assets, world curvature (CURVE +
// curve()), island bounds (GY / MAX_R / FIRE_R / clampIsland) and updateWorld
// (per-frame fire flicker + sparks + firefly drift). Owns everything static.
import * as THREE from 'three'
import { sharedCritterUniforms } from '../engine/shaders.js'

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
// Ground reads dusky sage, fog is a soft mauve that meets the sunset band,
// firelight stays the warm hero.
// ---------------------------------------------------------------------------
const FOG_COLOR = 0x5a4671      // dusty mauve, harmonizes ground horizon with sky
const FOG_DENSITY = 0.010
const SKY_TOP = 0x3a3067        // deep dusk blue-violet
const SKY_MID = 0x6f4d7e        // plum
const SKY_BOT = 0xdd9c72        // soft peach sunset (was harsh orange)
const HEMI_SKY = 0xb2badc       // lifted lavender ambience (green parity so sage reads)
const HEMI_GROUND = 0x77694f    // warm earth bounce
const HEMI_INT = 1.05
const MOON_COLOR = 0xaabcff
const MOON_INT = 0.5
const WATER_COLOR = 0x4b6b9d    // dusky blue, catches the sky
const SAND_COLOR = 0xdfc094     // warm shore ring (lavender light grays it out otherwise)
const GRASS_BASE = '#a3bd76'    // dusky sage (texture base, lit by hemi+moon+fire)
const GRASS_BLOTCH = '186,208,144' // lighter meadow mottling (rgb triplet)
const GRASS_SPECK = '108,130,88'   // darker speckles

export const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY)

export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400)

// world-curvature (tiny-planet horizon, jennsfarm style): bend view-space y by distance
export const CURVE = 0.0013
export function curve(mat) {
  if (!mat || mat.userData.__curved) return
  mat.userData.__curved = true
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
       #ifdef USE_INSTANCING
         mvPosition = instanceMatrix * mvPosition;
       #endif
       mvPosition = modelViewMatrix * mvPosition;
       mvPosition.y -= ${CURVE.toFixed(5)} * dot( mvPosition.xz, mvPosition.xz );
       gl_Position = projectionMatrix * mvPosition;`
    )
  }
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
        bot: { value: new THREE.Color(SKY_BOT) }
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 top, mid, bot;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(mid, top, smoothstep(0.12, 0.8, h));
          // peach sunset band hugging the horizon, fading above AND below so the
          // sphere underside (visible at screen top when looking down) stays plum
          float band = exp(-abs(h + 0.02) * 5.5);
          c = mix(c, bot, band * 0.95);
          gl_FragColor = vec4(c, 1.0);
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
  moon.scale.set(14, 14, 1)
  moon.position.set(-55, 62, -95)
  scene.add(moon)

  // distant hills: big flattened silhouette domes, hazed by fog
  const hillMat = new THREE.MeshBasicMaterial({ color: 0x3a2d52 })
  const hillMat2 = new THREE.MeshBasicMaterial({ color: 0x473762 })
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.25
    const r = 105 + (i % 3) * 18
    const w = 34 + (i % 4) * 12, h = 12 + ((i * 7) % 11)
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), i % 2 ? hillMat : hillMat2)
    hill.scale.set(w, h, w * 0.7)
    hill.position.set(Math.cos(a) * r, -4, Math.sin(a) * r)
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
  const c = document.createElement('canvas'); c.width = c.height = 512
  const g = c.getContext('2d')
  g.fillStyle = GRASS_BASE; g.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 18 + Math.random() * 55
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, `rgba(${GRASS_BLOTCH},0.30)`)
    gr.addColorStop(1, `rgba(${GRASS_BLOTCH},0)`)
    g.fillStyle = gr
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2); g.fill()
  }
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(${GRASS_SPECK},${0.06 + Math.random() * 0.08})`
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 0.7 + Math.random() * 1.8, 0, Math.PI * 2); g.fill()
  }
  // warm ember tint pooling toward the fire (cylinder cap UV center = island center)
  const warm = g.createRadialGradient(256, 256, 0, 256, 256, 256)
  warm.addColorStop(0, 'rgba(232,164,96,0.30)')
  warm.addColorStop(0.35, 'rgba(220,150,90,0.12)')
  warm.addColorStop(1, 'rgba(220,150,90,0)')
  g.fillStyle = warm; g.fillRect(0, 0, 512, 512)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

{
  // water ring
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(120, 64),
    new THREE.MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.92 })
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = -1.2
  water.receiveShadow = true
  scene.add(water)

  // sandy shore
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R + 2.4, ISLAND_R + 3.6, 2.2, 48),
    new THREE.MeshStandardMaterial({ color: SAND_COLOR, roughness: 1 })
  )
  sand.position.y = -0.9
  sand.receiveShadow = true
  scene.add(sand)

  // grass top
  const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R, ISLAND_R + 1.2, 1.8, 48),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 })
  )
  grass.position.y = 0.1
  grass.receiveShadow = true
  scene.add(grass)

  // rocks + trees are SDF blend-shell props (src/world/props.js)
}

// ---------------------------------------------------------------------------
// Firepit at the center
// ---------------------------------------------------------------------------
// wide warm pool: quadratic (physical) falloff with enough candela that the glow
// grades across nearby creatures, rocks and grass instead of dying at the stones
export const fireLight = new THREE.PointLight(0xff8a3a, 26, 60, 2)
fireLight.position.set(0, 2.0, 0)
fireLight.castShadow = true
scene.add(fireLight)

let flame, sparks, glow
{
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4750, roughness: 1 })
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), stoneMat)
    s.position.set(Math.cos(a) * 1.35, 1.05, Math.sin(a) * 1.35)
    s.rotation.set(Math.random(), Math.random(), Math.random())
    s.castShadow = s.receiveShadow = true
    scene.add(s)
  }
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 })
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.0, 8), logMat)
    log.position.set(0, 1.15, 0)
    log.rotation.z = Math.PI / 2
    log.rotation.y = (i / 3) * Math.PI
    log.castShadow = true
    scene.add(log)
  }
  flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.5, 10),
    new THREE.MeshStandardMaterial({ color: 0xffa53a, emissive: 0xff6a1a, emissiveIntensity: 2.4, roughness: 1 })
  )
  flame.position.set(0, 1.9, 0)
  scene.add(flame)

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
  const N = 50
  const pos = new Float32Array(N * 3)
  const ph = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * ISLAND_R
    pos[i*3] = Math.cos(a) * r; pos[i*3+1] = 1.2 + Math.random() * 3.5; pos[i*3+2] = Math.sin(a) * r
    ph[i*2] = Math.random() * 10; ph[i*2+1] = 0.3 + Math.random() * 0.7
  }
  const fg = new THREE.BufferGeometry()
  fg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffe08a, size: 0.22, map: softCircleTexture(0), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
  fireflies.userData.base = pos.slice()
  fireflies.userData.ph = ph
  scene.add(fireflies)
}

// ---------------------------------------------------------------------------
// Island ground + bounds (world curvature is a view-space shader trick, not geometry)
// ---------------------------------------------------------------------------
export const GY = 1.0
export const groundY = () => GY
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
  const f = 0.75 + Math.sin(t * 17) * 0.12 + Math.sin(t * 6.3) * 0.1 + (Math.random() - 0.5) * 0.15
  if (starMat) starMat.opacity = 0.62 + Math.sin(t * 1.7) * 0.14   // slow communal twinkle
  fireLight.intensity = 26 * f
  sharedCritterUniforms.uFire.value = 2.1 * f  // critter/prop SDF shading flickers in step
  flame.scale.setScalar(0.9 + f * 0.25)
  flame.rotation.y = t * 1.5
  glow.scale.setScalar(6.0 + f * 1.4)
  glow.material.opacity = 0.42 + f * 0.28
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
  fireflies.material.opacity = 0.55 + Math.sin(t * 2.5) * 0.25
}

// apply world-curvature to all static meshes (skips the sky ShaderMaterial and
// sprites/points; critter/prop shaders carry uCurve themselves, eye + shadow
// materials curve at creation, so running this here covers everything static)
scene.traverse(o => { if (o.isMesh && o.material && o.material.type !== 'ShaderMaterial') curve(o.material) })
