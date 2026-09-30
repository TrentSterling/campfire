// src/critter/critter.js : the Critter class (full OG port: seekTarget / wander /
// IK gait / verlet ropes / hopper FSM / googly projected eyes) plus critterMake,
// the deterministic seed -> critter factory. The Critter OWNS locomotion and works
// in WORLD space like the OG: its Object3D stays at identity and world-space prim
// endpoints are written into the uniform arrays every frame. Campfire's world
// curvature is applied on the view-space position (uCurve).
// Modes: controlled (local WASD writes critter.input), target (network peers WALK
// to the broadcast {x,z} with full gait), wander (NPCs, OG wander AI).
import * as THREE from 'three'
import { TAU, clamp, lerp, rr, pick, withSeededRng, V, Q1, Q2, E1, angleLerp, angleDiff } from '../engine/rng.js'
import { makeRope, updateRope } from '../engine/rope.js'
import { solveIK } from '../engine/ik.js'
import { projectEyeOntoSurface } from '../engine/sdf.js'
import { CRIT_MAXP, CRIT_VSH_WORLD, CRIT_FSH_BODY, CRIT_FSH_OUTLINE, sharedCritterUniforms } from '../engine/shaders.js'
import { scene, camera, CURVE, curve, GY, MAX_R, FIRE_R, clampIsland, makeShadow } from '../world/scene.js'
import { critters } from '../state.js'
import { genRecipe, CRITTER_ARCHES } from './recipes.js'
import { playChirp, spawnDust } from '../audio.js'
import { gearDispose, boardScale, boardBank, boardClearance } from './gear.js'
import { resolveObstacles, walkPath, nearestWalkable } from '../world/obstacles.js'

// ---------- eye assets (OG: separate googly meshes projected onto the live SDF) ----------
const eyeGeo = new THREE.SphereGeometry(1, 14, 11)
const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: '#ffffff' })
const eyePupilMat = new THREE.MeshBasicMaterial({ color: '#221c22' })
curve(eyeWhiteMat); curve(eyePupilMat)

let critterSerial = 0

export class Critter {
  constructor(recipe, x, z, heading) {
    this.id = critterSerial++
    this.recipe = recipe
    this.arch = recipe.archetype
    this.size = recipe.size
    this.pos = new THREE.Vector3(x, 0, z)
    this.vel = new THREE.Vector3()
    this.heading = heading
    this.headingVel = 0
    this.quat = new THREE.Quaternion()
    this.yawQuat = new THREE.Quaternion()
    this.target = null
    this.vignette = null
    this.seatPose = false             // remote NPC seating, separate from director ownership
    this.napping = false
    this.wanderEnabled = false        // campfire: NPCs only; players/peers steer via input/target
    this.lookDir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
    this.lookTimer = rr(1, 4)
    this.gazeAt = null; this.gazeT = 0
    this.wanderTimer = rr(1, 2.5)      // fast first move so a fresh spawn doesn't sit idle
    this.time = Math.random() * 100
    this.gaitPhase = Math.random()
    this.squash = 1; this.squashVel = 0
    this.dip = 0; this.dipVel = 0
    this.idleBumpTimer = rr(2.5, 5)   // rare idle settle/bounce blip
    this.airY = 0
    this.speedN = 0
    this.pitch = 0; this.roll = 0
    this.headYaw = 0; this.headPitch = 0
    this.blinkTimer = rr(1.5, 4)
    this.blinkT = -1
    this.blinkQueued = false
    this.saccadeTimer = rr(0.7, 2.5)
    this.saccadeX = 0; this.saccadeY = 0
    this.spawnT = 0                   // spawn pop
    this.puffK = 1                    // whole-body inflate (springs back to 1)
    this.quirkTimer = rr(2.5, 5)      // idle fidget
    // hopper state
    this.hState = 'idle'; this.hT = rr(0, 1); this.hVel = new THREE.Vector3()
    this.dashAir = false
    // flyer state
    this.propAngle = Math.random() * TAU
    this.kickY = 0
    // wave emote (X/square or Q): -1 = idle, else 0..1 progress
    this.waveT = -1
    // control
    this.controlled = false
    this.input = new THREE.Vector3()
    this.wantJump = false
    this.bigHop = false
    this.jumpVy = 0
    this.build()
  }

  build() {
    const R = this.recipe, S = this.size
    const P = R.palette
    this.prims = []                   // static meta {color,k,gloss,noOutline,colorOnly}
    const addPrim = (color, k, gloss, noOutline = 0, colorOnly = 0) => {
      this.prims.push({ color, k, gloss, noOutline, colorOnly })
      return this.prims.length - 1
    }

    // --- serpent: chain of segments trailing the head's path (no single body prim) ---
    this.chain = null
    if (R.archetype === 'serpent') {
      const nSeg = R.body.segs
      this.segLen = (R.body.len * S) / nSeg
      this.chain = []
      const dirX = Math.sin(this.heading), dirZ = Math.cos(this.heading)
      for (let i = 0; i <= nSeg; i++) {
        const r = lerp(R.body.r0, R.body.r1, i / nSeg) * S
        this.chain.push({
          i: i < nSeg ? addPrim(P.base, 0.15 * S, 0.14) : -1,
          r, wx: 0, wy: 0, wz: 0,
          pos: new THREE.Vector3(this.pos.x - dirX * this.segLen * i, 0, this.pos.z - dirZ * this.segLen * i),
        })
      }
      this.pathHist = []
      for (let i = 0; i < 45; i++) this.pathHist.push(new THREE.Vector3(this.pos.x - dirX * 0.1 * i, 0, this.pos.z - dirZ * 0.1 * i))
      this.slitherT = Math.random() * TAU
      this.bodyR = R.body.r0 * S
      // OG-style raised head: the lead segments arc up cobra-style so the googly
      // eyes face outward instead of the serpent lying flat like a prop
      this.headLift = 0.72 * S
      this.bodyY = R.body.r0 * S + this.headLift   // tags/gazes track the raised head
    }

    if (!this.chain) {
      const bodyR1 = R.body.r1 * S, bodyR2 = R.body.r2 * S
      const bodyLen = R.body.len * S
      const bodyY = R.body.y * S
      this.bodyY = bodyY
      this.bodyR = Math.max(bodyR1, bodyR2)
      const kBody = 0.24 * S

      // --- body (1 round cone along +Z or +Y) ---
      this.iBody = addPrim(P.base, kBody, 0.14)
      this.bodyA = new THREE.Vector3()
      this.bodyB = new THREE.Vector3()
      if (R.body.upright) {
        this.bodyA.set(0, bodyY, 0)
        this.bodyB.set(0, bodyY + bodyLen, R.body.topZ * S || 0)
      } else {
        this.bodyA.set(0, bodyY + (R.body.rearLift || 0) * S, -bodyLen / 2)
        this.bodyB.set(0, bodyY, bodyLen / 2)
      }
      this.bodyRA = bodyR1; this.bodyRB = bodyR2
    }

    // --- belly patch ---
    this.iBelly = -1
    if (R.belly && !this.chain) {
      this.iBelly = addPrim(P.belly, 0.16 * S, 0.1, 1, 1)
      this.bellyLocal = new THREE.Vector3(R.belly[0] * S, R.belly[1] * S, R.belly[2] * S)
      this.bellyR = R.belly[3] * S
    }

    // --- head ---
    this.hasHead = !!R.head
    if (this.hasHead) {
      this.iHead = addPrim(P.base, (R.head.k || 0.20) * S, 0.14)
      this.headR = R.head.r * S
      this.headLen = R.head.len * S
      this.neckLocal = new THREE.Vector3(0, (R.head.neckY) * S, (R.head.neckZ) * S)
      this.neckLen = R.head.neckLen * S
      this.headPitch0 = R.head.pitch || 0
      if (this.chain) this.neckLocal.y += this.headLift  // serpent: neck rides the raised lead segment
    }

    // --- legs (2-bone IK, per-leg phase tables) ---
    this.legs = []
    if (R.legs && R.legs.count > 0) {
      const L = R.legs
      const n = L.count
      const rows = n / 2
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1
        const row = (i / 2) | 0
        const rowT = rows > 1 ? row / (rows - 1) : 0.5
        const hipZ = lerp(L.hipZ1, L.hipZ0, rowT) * S
        const iThigh = addPrim(P.limb, L.k * S, 0.16)
        const iShin = addPrim(P.limb, L.k * 0.8 * S, 0.16)
        const iFoot = L.footR > 0.001 ? addPrim(P.dark, 0.06 * S, 0.75) : -1
        // gait phase
        let phase
        if (n === 2) phase = side < 0 ? 0 : 0.5
        else if (n === 4) phase = (side < 0 ? (row === 0 ? 0 : 0.57) : (row === 0 ? 0.5 : 0.07))
        else if (n === 6) phase = ((row % 2 === 0) === (side < 0)) ? 0.06 * row : 0.5 + 0.06 * row
        else phase = ((row * 0.25) + (side < 0 ? 0 : 0.5)) % 1
        this.legs.push({
          side, row,
          hipLocal: new THREE.Vector3(side * L.hipX * S, L.hipY * S, hipZ),
          restLocal: new THREE.Vector3(side * L.stanceX * S, 0, hipZ * L.stanceZ),
          l1: L.l1 * S, l2: L.l2 * S,
          rT1: L.thick * 0.55 * S, rT2: L.thick * 0.42 * S,
          rS1: L.thick * 0.34 * S, rS2: L.thick * (L.taper ? 0.16 : 0.30) * S,
          footR: L.footR * S,
          iThigh, iShin, iFoot,
          phase,
          planted: new THREE.Vector3(), pos: new THREE.Vector3(),
          swingFrom: new THREE.Vector3(), swingT: -1, swingDur: 0.2,
          knee: new THREE.Vector3(), cooldown: 0, initd: false, wasAirborne: false,
          poleUp: L.poleUp || 0,
        })
      }
      this.legMaxReach = (R.legs.l1 + R.legs.l2) * S
    }

    // --- arms (procedural swing nubs) ---
    this.arms = []
    if (R.arms) {
      const A = R.arms
      for (const side of [-1, 1]) {
        const iArm = addPrim(P.limb, 0.09 * S, 0.16)
        const iHand = addPrim(P.dark, 0.09 * S, 0.6)
        this.arms.push({
          side,
          shoulder: new THREE.Vector3(side * A.x * S, A.y * S, A.z * S),
          len: A.len * S, r1: A.thick * S, r2: A.thick * 0.7 * S, handR: A.handR * S,
          iArm, iHand,
        })
      }
    }

    // --- ropes: tail / ears / antennae ---
    this.ropes = []
    const addRope = (cfg, attachLocal, dirs, radii, colors, ks, glosses, tipBall) => {
      const rope = makeRope(dirs.length, cfg.segLen * S, cfg.stiff, cfg.grav, dirs)
      const idx = []
      for (let i = 0; i < dirs.length; i++) idx.push(addPrim(colors[i], ks[i] * S, glosses[i] || 0.15))
      let iTip = -1, tipR = 0
      if (tipBall) { iTip = addPrim(tipBall.color, tipBall.k * S, 0.3); tipR = tipBall.r * S }
      const idleMid = Math.max(1, (dirs.length / 2) | 0)
      this.ropes.push({ rope, attachLocal, idx, radii: radii.map(r => r * S), iTip, tipR, idleTimer: rr(1.5, 4), idleMid })
    }

    if (R.tail) {
      const T = R.tail
      const dirs = []
      for (let i = 0; i < T.segs; i++) dirs.push(new THREE.Vector3(0, lerp(0.55, -0.1, i / T.segs), -1).normalize())
      const radii = [], cols = [], ks = [], gl = []
      for (let i = 0; i <= T.segs; i++) radii.push(lerp(T.r0, T.r1, i / T.segs))
      for (let i = 0; i < T.segs; i++) { cols.push(P.base); ks.push(0.13); gl.push(0.15) }
      addRope({ segLen: T.len / T.segs, stiff: 5, grav: 5 }, new THREE.Vector3(T.x * S, T.y * S, T.z * S), dirs, radii, cols, ks, gl, null)
    }
    if (R.ears) {
      const E2 = R.ears
      for (const side of [-1, 1]) {
        const dirs = []
        for (let i = 0; i < E2.segs; i++) {
          dirs.push(new THREE.Vector3(side * lerp(E2.out, E2.out * 1.6, i / E2.segs), lerp(1, 0.15, i / E2.segs), E2.back).normalize())
        }
        const radii = [], cols = [], ks = [], gl = []
        for (let i = 0; i <= E2.segs; i++) radii.push(lerp(E2.r0, E2.r1, i / E2.segs))
        for (let i = 0; i < E2.segs; i++) { cols.push(E2.accent && i === E2.segs - 1 ? P.accent : P.base); ks.push(i === 0 ? 0.10 : 0.06); gl.push(0.15) }
        addRope({ segLen: E2.len / E2.segs, stiff: E2.stiff, grav: E2.grav },
          new THREE.Vector3(side * E2.x * S, E2.y * S, E2.z * S), dirs, radii, cols, ks, gl,
          E2.tipBall ? { color: P.accent, k: 0.05, r: E2.tipBall } : null)
      }
    }

    // --- static decorations (frame-relative) ---
    this.decos = []
    if (R.decos) {
      for (const D of R.decos) {
        const col = Array.isArray(D.color) ? D.color : (P[D.color] || P.accent)
        const i = addPrim(col, (D.k || 0.08) * S, D.gloss || 0.2, D.noOutline || 0, D.colorOnly || 0)
        this.decos.push({
          i, frame: D.frame || 'body',
          a: new THREE.Vector3(D.a[0] * S, D.a[1] * S, D.a[2] * S),
          b: new THREE.Vector3(D.b[0] * S, D.b[1] * S, D.b[2] * S),
          r1: D.r1 * S, r2: D.r2 * S,
        })
      }
    }

    // --- propeller (flyers) ---
    this.prop = null
    if (R.propeller) {
      const PR = R.propeller
      const iMast = addPrim(P.base, 0.09 * S, 0.15)
      const iHub = addPrim(P.accent, 0.05 * S, 0.4)
      const blades = []
      for (let i = 0; i < 3; i++) blades.push(addPrim(P.accent, 0.035 * S, 0.3))
      this.prop = {
        iMast, iHub, blades,
        base: new THREE.Vector3(PR.x * S, PR.y * S, PR.z * S),
        mastLen: PR.mastLen * S, bladeLen: PR.bladeLen * S,
        hubR: PR.hubR * S, bladeR1: 0.034 * S, bladeR2: 0.062 * S, mastR: 0.045 * S,
      }
    }

    // --- spots ---
    this.spots = []
    if (R.spots) {
      for (const sp of R.spots) {
        const i = addPrim(P.spot, 0.08 * S, 0.12, 1, 1)
        this.spots.push({ i, local: new THREE.Vector3(sp[0] * S, sp[1] * S, sp[2] * S), r: sp[3] * S })
      }
    }

    // ---------- geometry ----------
    const n = this.prims.length
    if (n > CRIT_MAXP) console.warn('critter exceeds CRIT_MAXP prims:', n)
    this.fA = new Float32Array(CRIT_MAXP * 4)
    this.fB = new Float32Array(CRIT_MAXP * 4)
    this.fC = new Float32Array(CRIT_MAXP * 4)
    this.fD = new Float32Array(CRIT_MAXP * 4)
    for (let i = 0; i < n; i++) {
      const pr = this.prims[i]
      this.fC[i * 4] = pr.color[0]; this.fC[i * 4 + 1] = pr.color[1]; this.fC[i * 4 + 2] = pr.color[2]
      this.fC[i * 4 + 3] = pr.k
      this.fD[i * 4] = pr.gloss
      this.fD[i * 4 + 1] = pr.noOutline
      this.fD[i * 4 + 2] = pr.colorOnly
    }
    // write bind pose once so per-prim mesh sizes are known
    this.updateFrame(0.0001, true)

    // per-prim spheres sized by bind radii, manually merged INDEXED (no addons dep)
    const geos = []
    for (let i = 0; i < n; i++) {
      if (this.prims[i].colorOnly) continue
      const r = Math.max(this.fA[i * 4 + 3], this.fB[i * 4 + 3])
      const dx = this.fB[i * 4] - this.fA[i * 4], dy = this.fB[i * 4 + 1] - this.fA[i * 4 + 1], dz = this.fB[i * 4 + 2] - this.fA[i * 4 + 2]
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
      let w, h
      if (r >= 0.26 * S) { w = 36; h = 28 }
      else if (r >= 0.13 * S) { w = 22; h = 17 }
      else if (r >= 0.055 * S) { w = 14; h = 11 }
      else { w = 10; h = 9 }
      if (len > r * 2.5) h += 8
      const g = new THREE.SphereGeometry(1, w, h)
      g.deleteAttribute('normal'); g.deleteAttribute('uv')
      const cnt = g.attributes.position.count
      g.setAttribute('aPrim', new THREE.BufferAttribute(new Float32Array(cnt).fill(i), 1))
      geos.push(g)
    }
    let vTot = 0, iTot = 0
    for (const g of geos) { vTot += g.attributes.position.count; iTot += g.index.count }
    const mPos = new Float32Array(vTot * 3), mPrim = new Float32Array(vTot)
    const mIdx = vTot > 65535 ? new Uint32Array(iTot) : new Uint16Array(iTot)
    let vo = 0, io = 0
    for (const g of geos) {
      mPos.set(g.attributes.position.array, vo * 3)
      mPrim.set(g.attributes.aPrim.array, vo)
      const idx = g.index.array
      for (let k = 0; k < idx.length; k++) mIdx[io + k] = idx[k] + vo
      vo += g.attributes.position.count; io += idx.length
      g.dispose()
    }
    const merged = new THREE.BufferGeometry()
    merged.setAttribute('position', new THREE.BufferAttribute(mPos, 3))
    merged.setAttribute('aPrim', new THREE.BufferAttribute(mPrim, 1))
    merged.setIndex(new THREE.BufferAttribute(mIdx, 1))
    // serpent chains trail well behind the root; keep frustum culling honest
    merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, GY, 0), this.chain ? Math.max(4 * S, R.body.len * S + 2) : 4 * S)
    this.geo = merged

    const uniforms = {
      uPrimA: { value: this.fA }, uPrimB: { value: this.fB },
      uPrimC: { value: this.fC }, uPrimD: { value: this.fD },
      uCount: { value: n },
      uCurve: { value: CURVE },
      uRim: { value: 1 },   // warm campfire rim/fill: critters only (props pass 0)
      ...sharedCritterUniforms,
    }
    // PRIM_COUNT is the shared CRIT_MAXP for every critter: all bodies (and all
    // outlines) hit the same cached WebGL program
    this.matBody = new THREE.ShaderMaterial({
      defines: { PRIM_COUNT: CRIT_MAXP },
      vertexShader: CRIT_VSH_WORLD, fragmentShader: CRIT_FSH_BODY,
      uniforms: { ...uniforms, uIso: { value: 0 } },
    })
    this.matOutline = new THREE.ShaderMaterial({
      defines: { PRIM_COUNT: CRIT_MAXP },
      vertexShader: CRIT_VSH_WORLD, fragmentShader: CRIT_FSH_OUTLINE,
      uniforms: { ...uniforms, uIso: { value: 0.021 * S }, uOutlineTint: { value: new THREE.Color(P.outline) } },
      side: THREE.BackSide,
    })

    this.group = new THREE.Group()   // stays at identity: everything is world space
    this.meshBody = new THREE.Mesh(this.geo, this.matBody)
    this.meshOutline = new THREE.Mesh(this.geo, this.matOutline)
    this.group.add(this.meshBody, this.meshOutline)

    // eyes: separate googly meshes glued to the live SDF surface
    this.eyes = []
    const E = R.eyes
    if (E) {
      const list = E.count === 1 ? [0] : [-1, 1]
      for (const s of list) {
        const root = new THREE.Group()
        const white = new THREE.Mesh(eyeGeo, eyeWhiteMat)
        white.scale.set(E.r * S * 0.95, E.r * S, E.r * S * 0.55) // flat googly sticker
        const pupil = new THREE.Mesh(eyeGeo, eyePupilMat)
        pupil.scale.set(E.r * S * 0.5, E.r * S * 0.5, E.r * S * 0.24)
        pupil.position.set(0, 0, E.r * S * 0.48)
        root.add(white, pupil)
        this.eyes.push({
          root, pupil, side: s,
          local: new THREE.Vector3(s * E.spread * S, E.y * S, E.z * S),
          r: E.r * S,
        })
        this.group.add(root)
      }
    }

    this.shadow = makeShadow()
    this.shadow.scale.setScalar(this.bodyR * 3.0)
    this.group.add(this.shadow)
    scene.add(this.group)
  }

  // local (frame at ground under root, yaw+pitch+roll, squash about ground) -> world
  toWorld(out, local, lift = 0) {
    const sy = this.squash, sxz = 1 + (1 - this.squash) * 0.55
    out.set(local.x * sxz, (local.y + lift) * sy, local.z * sxz)
    out.applyQuaternion(this.quat)
    out.x += this.pos.x; out.z += this.pos.z
    out.y += GY + this.airY + (this.poseLift || 0)
    return out
  }

  setPrim(i, a, b, r1, r2) {
    const o = i * 4
    this.fA[o] = a.x; this.fA[o + 1] = a.y; this.fA[o + 2] = a.z; this.fA[o + 3] = r1
    this.fB[o] = b.x; this.fB[o + 1] = b.y; this.fB[o + 2] = b.z; this.fB[o + 3] = r2
  }

  nearestBuddy(maxD) {
    let best = null, bd = maxD * maxD
    for (const c of critters) {
      if (c === this) continue
      const d = (c.pos.x - this.pos.x) ** 2 + (c.pos.z - this.pos.z) ** 2
      if (d < bd) { bd = d; best = c }
    }
    return best
  }

  quirk() {
    // small idle fidget: leg critters shuffle a foot, roped ones flick tails/ears,
    // serpents shiver
    this.squashVel -= 0.22
    if (this.legs && this.legs.length && this.airY === 0) {
      const leg = this.legs[(Math.random() * this.legs.length) | 0]
      if (leg.swingT < 0) { leg.swingT = 0; leg.swingDur = rr(0.28, 0.42); leg.swingFrom.copy(leg.planted); leg.cooldown = 0.5 }
    }
    for (const rp of this.ropes) rp.idleTimer = 0
    if (this.arch === 'serpent') this.slitherT += rr(0.6, 1.2)
  }

  // X/square or Q (or a remote 'wave' act): quick shimmy (heading wiggle + squash blip)
  wave() {
    if (this.waveT >= 0) return
    this.waveT = 0
    this.squashVel -= 1.6
    this.puffK = 1.15
    playChirp('wave')
    spawnDust(this.pos.x, GY + this.bodyY * 0.7, this.pos.z, 4, 0.15, 0.05, 0.4)
  }

  // petted (E / pad B, or a remote 'pet' act): happy bounce + puff, gaze at the petter
  petBy(petter) {
    this.squashVel -= 2.2 // happy bounce
    this.puffK = 1.28     // happy puff
    playChirp('pet')
    spawnDust(this.pos.x, GY + this.bodyY * 0.6, this.pos.z, 6, 0.2, 0.06, 0.5)
    // a little wave of joy: nearby critters bounce and look over
    for (const o of critters) {
      if (o === this || o.controlled || o.napping) continue
      const dd = (o.pos.x - this.pos.x) ** 2 + (o.pos.z - this.pos.z) ** 2
      if (dd < 9) { o.squashVel -= 0.6; o.gazeAt = this; o.gazeT = rr(1, 2) }
    }
    if (petter && petter !== this) { this.gazeAt = petter; this.gazeT = rr(1.5, 3) }
    else { this.gazeAt = null; this.lookDir.subVectors(camera.position, this.pos).normalize() } // glance up at you
  }

  // ============ per-frame ============
  update(dt) {
    this.time += dt
    if (this.spawnT < 1) this.spawnT = Math.min(1, this.spawnT + dt * 2.2)
    // rare idle settle/bounce blip so idle critters visibly breathe + bounce
    this.idleBumpTimer -= dt
    if (this.idleBumpTimer <= 0) {
      this.idleBumpTimer = rr(2.5, 5)
      if (this.speedN < 0.15) this.squashVel -= 0.4
    }
    this.puffK += (1 - this.puffK) * Math.min(1, 8 * dt)
    this.quirkTimer -= dt
    if (this.quirkTimer <= 0) {
      this.quirkTimer = rr(2.5, 5)
      // napping should read fully asleep, but a gaze/tag hold shouldn't freeze
      // the critter solid -- let idle fidgets (foot shuffle/tail flick/shiver)
      // keep playing through those so paired critters don't look like statues
      if (!this.napping && !this.controlled && this.vignette !== 'nap' && this.speedN < 0.12) this.quirk()
    }
    // NPCs follow furniture-safe waypoints, including after a seated vignette.
    // A seated pose alone grants collision permission, never the approach walk.
    if(this.wanderEnabled && this.target && !this.seated) {
      if(this.__routePoint!==this.target) {
        const r=Math.min(.36,Math.max(.18,this.bodyR*.55))
        const path=walkPath(this.pos,this.target,r)
        this.__route=path || [];this.target=this.__route.shift() || null;this.__routePoint=this.target
      }
    } else if(!this.target && this.__route?.length && this.wanderEnabled) {
      this.target=this.__route.shift();this.__routePoint=this.target
    }
    if(!this.wanderEnabled || this.controlled || this.seated){this.__route=null;this.__routePoint=null}
    if(this.seated) {
      this.vel.set(0,0,0);this.airY=0;this.speedN=0;this.target=null;this.wantJump=false;this.lift=0;this.pitch=0;this.roll=0
      E1.set(0,this.heading,0,'YXZ');this.quat.setFromEuler(E1);this.yawQuat.copy(this.quat)
    }
    else if (this.riding && this.arch === 'hopper') this.updateWalker(dt)
    else if (this.arch === 'hopper') this.updateHopper(dt)
    else if (this.arch === 'flyer') this.updateFlyer(dt)
    else if (this.arch === 'serpent') this.updateSerpent(dt)
    else this.updateWalker(dt)
    if(!this.seated)resolveObstacles(this.pos,Math.min(.36,Math.max(.18,this.bodyR*.55)),this.airY)
    // wave emote: quick heading wiggle layered onto the pose
    if (this.waveT >= 0) {
      this.waveT += dt / 0.8
      if (this.waveT >= 1) this.waveT = -1
      else {
        const w = Math.sin(this.waveT * Math.PI)
        E1.set(0, Math.sin(this.waveT * TAU * 2.2) * 0.5 * w, 0, 'YXZ')
        Q1.setFromEuler(E1)
        this.quat.multiply(Q1)
        this.yawQuat.multiply(Q1)
      }
    }
    this.poseLift = this.riding ? .17 * boardScale(this) + boardClearance(this) : this.seated ? .58 : 0
    if(this.riding) {
      this.lift = -.035*this.size;this.pitch=-.05;this.roll=-boardBank(this)
      E1.set(this.pitch,this.heading,this.roll,'YXZ');this.quat.setFromEuler(E1)
      E1.set(0,this.heading,0,'YXZ');this.yawQuat.setFromEuler(E1)
      const scale=boardScale(this)
      E1.set(boardBank(this),this.heading+Math.PI/2,0,'YXZ')
      for(const leg of this.legs || []) {
        V[2].set(-clamp(leg.restLocal.z,-.35*scale,.35*scale),.155*scale,leg.side*.11*scale).applyEuler(E1)
        leg.pos.set(this.pos.x+V[2].x,GY+this.airY+boardClearance(this)+V[2].y,this.pos.z+V[2].z)
        leg.planted.copy(leg.pos);leg.swingT=-1;leg.wasAirborne=true
      }
    }
    this.updateFrame(dt, false)
    this.updateEyes(dt)
    // blob shadow
    this.shadow.position.set(this.pos.x, GY + 0.02, this.pos.z)
    const shrink = 1 / (1 + this.airY * 0.8)
    this.shadow.scale.setScalar(this.bodyR * 3.0 * shrink * (0.9 + 0.1 * this.squash))
    this.shadow.material.opacity = 0.3 * shrink
    this.geo.boundingSphere.center.set(this.pos.x, GY + this.airY + this.bodyY + (this.poseLift || 0), this.pos.z)
  }

  // OG seekTarget: controlled -> input drives desired velocity; target -> walk to it.
  // maxR leash = island edge; the firepit repels via clampIsland.
  seekTarget(dt, maxSpeed, accel, maxR = MAX_R) {
    maxSpeed *= this.speedMul || 1   // gear hook: skateboard boost (src/critter/gear.js)
    let desiredX = 0, desiredZ = 0
    if (this.controlled) {
      desiredX = this.input.x * maxSpeed
      desiredZ = this.input.z * maxSpeed
    } else if (this.target) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < 0.3) { this.target = null }
      else {
        const sp = maxSpeed * clamp(d / 1.4, 0.25, 1)
        desiredX = dx / d * sp; desiredZ = dz / d * sp
      }
    }
    const k = Math.min(1, accel * dt)
    this.vel.x += (desiredX - this.vel.x) * k
    this.vel.z += (desiredZ - this.vel.z) * k
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    const dd = Math.sqrt(this.pos.x * this.pos.x + this.pos.z * this.pos.z)
    if (dd > maxR) { this.pos.x *= maxR / dd; this.pos.z *= maxR / dd }
    else if (dd < FIRE_R && dd > 1e-4) { this.pos.x *= FIRE_R / dd; this.pos.z *= FIRE_R / dd }
    const speed = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
    this.speedN = clamp(speed / maxSpeed, 0, 1)
    if (speed > 0.12) {
      const want = Math.atan2(this.vel.x, this.vel.z)
      const prev = this.heading
      this.heading = angleLerp(this.heading, want, Math.min(1, 7 * dt))
      this.headingVel = angleDiff(this.heading,prev) / Math.max(dt, 1e-4)
    } else this.headingVel *= 1 - 6 * dt
    return speed
  }

  // OG wander AI (NPCs): amble to nearby points, glance at buddies, sidle over.
  // Campfire twist: idle NPCs gather around the firepit and settle facing the
  // flames, which naturally turns their googly eyes toward the camera across
  // the fire (the default shot looks over the player AT the fire).
  wander(dt) {
    if (this.vignette) return
    if (!this.target && !this.gazeAt && this.speedN < 0.1) {
      const fa = Math.atan2(-this.pos.x, -this.pos.z) // face the firepit (origin)
      this.heading = angleLerp(this.heading, fa, Math.min(1, 0.7 * dt))
      V[0].set(-this.pos.x, 0.15, -this.pos.z).normalize()
      this.lookDir.lerp(V[0], Math.min(1, 0.4 * dt)).normalize()
    }
    this.wanderTimer -= dt
    if (this.wanderTimer <= 0 && !this.target) {
      this.wanderTimer = rr(2, 4.5)
      if (Math.random() < 0.72) {
        const a = Math.random() * TAU, r = rr(1.5, 4)
        let tx = this.pos.x + Math.sin(a) * r, tz = this.pos.z + Math.cos(a) * r
        if (Math.random() < 0.45) { // gather: drift toward a seat ringing the firepit
          const ang = Math.atan2(this.pos.x, this.pos.z) + rr(-0.8, 0.8)
          const rad = rr(FIRE_R + 1.3, FIRE_R + 3.4)
          tx = Math.sin(ang) * rad; tz = Math.cos(ang) * rad
        }
        const dd = Math.sqrt(tx * tx + tz * tz)
        if (dd > 10) { tx *= 10 / dd; tz *= 10 / dd }
        const df = Math.hypot(tx, tz)
        if (df < FIRE_R + 0.4) { const s = (FIRE_R + 0.4) / (df || 1); tx *= s; tz *= s }
        this.target = { x: tx, z: tz }
      } else {
        const buddy = Math.random() < 0.45 ? this.nearestBuddy(4) : null
        if (buddy) {
          this.gazeAt = buddy; this.gazeT = rr(1.5, 3)
          if (Math.random() < 0.3) { // curious: amble over and hang out a body-length away
            const dx = this.pos.x - buddy.pos.x, dz = this.pos.z - buddy.pos.z, dl = Math.hypot(dx, dz) || 1
            this.target = { x: buddy.pos.x + dx / dl * (0.9 + this.bodyR), z: buddy.pos.z + dz / dl * (0.9 + this.bodyR) }
          }
        } else {
          // glance mostly toward the flames so idle faces read across the fire
          const a = Math.atan2(-this.pos.x, -this.pos.z) + rr(-0.7, 0.7)
          this.lookDir.set(Math.sin(a), rr(-0.1, 0.25), Math.cos(a)).normalize()
          this.lookTimer = rr(1.5, 3.5)
        }
      }
    }
  }

  updateWalker(dt) {
    if (!this.controlled && this.wanderEnabled) this.wander(dt)
    const R = this.recipe
    const maxSpeed = (R.motion.speed || R.motion.hopLen*1.8 || 1.5) * this.size
    this.seekTarget(dt, maxSpeed, 5)

    // jump: a little ballistic bunny-hop with squash kicks (Space / pad A / remote 'hop' act)
    if (this.wantJump && this.airY === 0) {
      this.jumpVy = 3.4 * Math.sqrt(this.size)
      this.airY = 0.001
      this.squashVel -= 3.5
    }
    this.wantJump = false
    if (this.airY > 0) {
      this.jumpVy -= 13 * dt
      this.airY += this.jumpVy * dt
      if (this.airY <= 0) {
        this.airY = 0; this.jumpVy = 0
        this.squashVel -= 4; this.dipVel -= 0.4
        playChirp('land')
        spawnDust(this.pos.x, GY, this.pos.z, 8, 0.3, 0.09, 0.6)
      }
    }

    // gait phase
    const tempo = R.motion.tempo
    const rate = tempo * (0.4 + this.speedN * 1.5)
    if (this.speedN > 0.04) this.gaitPhase = (this.gaitPhase + dt * rate) % 1

    // body pose
    const bob = Math.sin(this.gaitPhase * TAU * 2) * R.motion.bob * this.size * this.speedN
    this.lift = bob + this.dip
    this.pitch = clamp(-this.speedN * 0.06 + (R.body.tilt || 0), -0.5, 0.5)
    this.roll = clamp(-this.headingVel * 0.045, -0.3, 0.3) + Math.sin(this.gaitPhase * TAU) * 0.03 * this.speedN
    E1.set(this.pitch, this.heading, this.roll, 'YXZ')
    this.quat.setFromEuler(E1)
    E1.set(0, this.heading, 0, 'YXZ')
    this.yawQuat.setFromEuler(E1)

    // squash spring (small blips only)
    this.squashVel += (1 - this.squash) * 90 * dt
    this.squashVel *= Math.max(0, 1 - 12 * dt)
    this.squash = clamp(this.squash + this.squashVel * dt, 0.55, 1.45)
    // dip spring
    this.dipVel += (0 - this.dip) * 160 * dt
    this.dipVel *= Math.max(0, 1 - 14 * dt)
    this.dip += this.dipVel * dt

    // feet: plant-and-step state machine with predictive landing
    const swingFrac = 0.38
    for (const leg of this.legs) {
      if(this.seated) {
        V[2].set(leg.side*.18*this.size,-.15,Math.max(.22,Math.abs(leg.restLocal.z))*.65)
        V[2].applyQuaternion(this.yawQuat)
        leg.pos.set(this.pos.x+V[2].x,GY+.48+V[2].y,this.pos.z+V[2].z)
        leg.planted.copy(leg.pos);leg.swingT=-1;leg.wasAirborne=true;continue
      }
      if(this.riding) {
        continue
      }
      // rest position (world, ground)
      V[2].copy(leg.restLocal).applyQuaternion(this.yawQuat)
      const rx = this.pos.x + V[2].x + this.vel.x * 0.13
      const rz = this.pos.z + V[2].z + this.vel.z * 0.13
      const ry = GY
      if (!leg.initd) {
        leg.initd = true
        leg.planted.set(rx, ry, rz)
        leg.pos.copy(leg.planted)
      }
      leg.cooldown -= dt

      if (this.airY > 0) {
        // airborne: tuck the foot toward the hip
        leg.wasAirborne = true
        const reach = leg.l1 + leg.l2
        this.toWorld(V[3], leg.hipLocal, this.lift)
        const dangle = Math.sin(this.time * 7 + leg.phase * TAU) * reach * 0.08
        V[2].set(dangle, -reach * 0.55, -reach * 0.22).applyQuaternion(this.quat)
        const tk = Math.min(1, 14 * dt)
        leg.pos.x = lerp(leg.pos.x, V[3].x + V[2].x, tk)
        leg.pos.y = lerp(leg.pos.y, V[3].y + V[2].y, tk)
        leg.pos.z = lerp(leg.pos.z, V[3].z + V[2].z, tk)
        continue
      }
      if (leg.wasAirborne) {
        // landing: re-plant with a quick staggered restep pop
        leg.wasAirborne = false
        leg.planted.set(rx, ry, rz)
        leg.pos.copy(leg.planted)
        leg.swingFrom.copy(leg.planted)
        leg.swingDur = 0.12 + leg.phase * 0.06
        leg.swingT = 0
        leg.cooldown = 0
      }

      const dxp = rx - leg.planted.x, dzp = rz - leg.planted.z
      const drift = Math.sqrt(dxp * dxp + dzp * dzp)
      const localPhase = (this.gaitPhase + leg.phase) % 1

      if (leg.swingT < 0 && this.airY === 0) {
        let go = false, dur = 0.22
        if (this.speedN > 0.04) {
          if (localPhase < swingFrac && drift > 0.02) {
            go = true
            const rate2 = this.recipe.motion.tempo * (0.4 + this.speedN * 1.5)
            dur = clamp(swingFrac / Math.max(rate2, 0.1), 0.12, 0.34)
          }
        } else if (drift > 0.13 * this.size && leg.cooldown <= 0) {
          // reactive idle shuffle, only if the parity group is grounded
          let busy = false
          const myPar = leg.phase < 0.5 ? 0 : 1
          for (const o of this.legs) {
            if (o !== leg && o.swingT >= 0 && (o.phase < 0.5 ? 0 : 1) === myPar) { busy = true; break }
          }
          if (!busy) { go = true; dur = 0.2 }
        }
        if (go) {
          leg.swingT = 0
          leg.swingDur = dur
          leg.swingFrom.copy(leg.planted)
          leg.cooldown = dur + 0.1
        }
      }
      if (leg.swingT >= 0) {
        leg.swingT += dt / leg.swingDur
        const t = Math.min(leg.swingT, 1)
        const e = t * t * (3 - 2 * t)
        // predictive dest
        const px2 = rx + this.vel.x * leg.swingDur * (1 - t) * 0.4
        const pz2 = rz + this.vel.z * leg.swingDur * (1 - t) * 0.4
        leg.pos.x = lerp(leg.swingFrom.x, px2, e)
        leg.pos.z = lerp(leg.swingFrom.z, pz2, e)
        const stepH = this.size * (0.07 + this.speedN * 0.08)
        leg.pos.y = lerp(leg.swingFrom.y, GY, e) + Math.sin(Math.PI * t) * stepH
        if (leg.swingT >= 1) {
          leg.swingT = -1
          leg.planted.set(leg.pos.x, GY, leg.pos.z)
          leg.pos.copy(leg.planted)
          this.dipVel -= 0.28 * this.speedN
          if (this.speedN > 0.1) {
            playChirp('footstep')
            spawnDust(leg.planted.x, GY, leg.planted.z, 3, 0.12, 0.045, 0.35)
          }
        }
      } else {
        leg.pos.copy(leg.planted)
      }
    }
  }

  // OG hopper FSM: idle -> crouch (squash down) -> air (ballistic, stretch) -> land (squash)
  updateHopper(dt) {
    if (this.controlled) {
      // steer hops with the input vector
      if (this.hState === 'idle') {
        const m = Math.hypot(this.input.x, this.input.z)
        if (m > 0.25 || this.wantJump) {
          let dx = this.input.x, dz = this.input.z
          if (m < 0.25) { dx = Math.sin(this.heading); dz = Math.cos(this.heading) }
          const im = 1 / (Math.hypot(dx, dz) || 1)
          this.bigHop = this.wantJump
          const L = this.recipe.motion.hopLen * this.size * (this.bigHop ? 1.6 : 1)
          this.target = { x: this.pos.x + dx * im * L, z: this.pos.z + dz * im * L }
        }
      }
      this.wantJump = false
    } else {
      // uncontrolled hoppers (idle keyboard seat, remote 'hop' act): dash along heading
      if (this.wantJump && this.hState === 'idle') {
        this.bigHop = true
        const L = this.recipe.motion.hopLen * this.size * 1.6
        this.target = { x: this.pos.x + Math.sin(this.heading) * L, z: this.pos.z + Math.cos(this.heading) * L }
      }
      this.wantJump = false
      if (this.wanderEnabled) this.wander(dt)
    }
    const R = this.recipe
    this.hT += dt
    const g = 14
    let squashTarget = 1

    if (this.hState === 'idle') {
      squashTarget = 1 + Math.sin(this.time * 2.6) * 0.025
      this.speedN *= 1 - 4 * dt
      if (this.target && this.hT > 0.15) {
        const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z
        if (Math.sqrt(dx * dx + dz * dz) < 0.35) this.target = null
        else { this.hState = 'crouch'; this.hT = 0 }
      }
    } else if (this.hState === 'crouch') {
      squashTarget = this.bigHop ? 0.62 : 0.72
      if (this.target) {
        const want = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z)
        this.heading = angleLerp(this.heading, want, Math.min(1, 10 * dt))
      }
      if (this.hT > (this.bigHop ? 0.07 : 0.16)) {
        this.hState = 'air'; this.hT = 0
        const dx = (this.target ? this.target.x : this.pos.x) - this.pos.x
        const dz = (this.target ? this.target.z : this.pos.z) - this.pos.z
        const d = Math.sqrt(dx * dx + dz * dz) || 1
        const L = this.bigHop ? R.motion.hopLen * this.size * 2.6 : Math.min(R.motion.hopLen * this.size, d)
        const T = 0.52 * (this.bigHop ? 0.72 : 1)
        this.dashAir = this.bigHop
        this.bigHop = false
        this.hVel.set(dx / d * L / T, g * T * 0.5, dz / d * L / T)
      }
    } else if (this.hState === 'air') {
      squashTarget = this.dashAir ? 1.38 : 1.24
      this.hVel.y -= g * dt
      this.pos.x += this.hVel.x * dt
      this.pos.z += this.hVel.z * dt
      clampIsland(this.pos)
      this.airY += this.hVel.y * dt
      this.speedN = 1
      if (this.airY <= 0 && this.hVel.y < 0) {
        this.airY = 0
        this.hState = 'land'; this.hT = 0
        this.dashAir = false
        this.squashVel -= 5.5
        playChirp('land')
        spawnDust(this.pos.x, GY, this.pos.z, 6, 0.28, 0.08, 0.55)
      }
    } else if (this.hState === 'land') {
      squashTarget = 1
      if (this.hT > rr(0.14, 0.3)) { this.hState = 'idle'; this.hT = Math.random() * 0.1 }
    }

    // squash spring toward target
    this.squashVel += (squashTarget - this.squash) * 110 * dt
    this.squashVel *= Math.max(0, 1 - 10 * dt)
    this.squash = clamp(this.squash + this.squashVel * dt, 0.5, 1.5)

    this.lift = 0
    this.pitch = clamp(-this.hVel.y * 0.035 * (this.hState === 'air' ? 1 : 0), -0.35, 0.35)
    this.roll *= 1 - 6 * dt
    E1.set(this.pitch, this.heading, this.roll, 'YXZ')
    this.quat.setFromEuler(E1)
    this.yawQuat.copy(this.quat)
    this.vel.set(this.hState === 'air' ? this.hVel.x : 0, 0, this.hState === 'air' ? this.hVel.z : 0)
  }

  // OG serpent: head steers like a walker; the chain trails the head's recorded
  // ground path (resampled segLen apart) with a slither sine sway in updateFrame
  updateSerpent(dt) {
    if (!this.controlled && this.wanderEnabled) this.wander(dt)
    const R = this.recipe
    const maxSpeed = R.motion.speed * this.size
    this.seekTarget(dt, maxSpeed, 4)

    // dash: coil-spring lunge along the heading (soft burst, decays via seekTarget)
    if (this.wantJump && this.airY === 0) {
      const sx = Math.sin(this.heading), sz = Math.cos(this.heading)
      this.vel.x += sx * 7.0 * this.size
      this.vel.z += sz * 7.0 * this.size
      this.jumpVy = 1.6 * Math.sqrt(this.size)
      this.airY = 0.001
      this.squashVel -= 3.5
      this.slitherT += 2.5
    }
    this.wantJump = false
    if (this.airY > 0) {
      this.jumpVy -= 13 * dt
      this.airY += this.jumpVy * dt
      if (this.airY <= 0) { this.airY = 0; this.jumpVy = 0; this.squashVel -= 3 }
    }

    this.slitherT += dt * R.motion.tempo * (2.2 + this.speedN * 7)

    // record the head's ground path (newest first, spaced ~4cm)
    const hp = this.pathHist
    if ((hp[0].x - this.pos.x) ** 2 + (hp[0].z - this.pos.z) ** 2 > 0.0016) {
      const v = hp.length > 110 ? hp.pop() : new THREE.Vector3()
      v.set(this.pos.x, 0, this.pos.z)
      hp.unshift(v)
    }

    // resample the chain along the recorded path, segLen apart
    const n = this.chain.length - 1
    this.chain[0].pos.set(this.pos.x, 0, this.pos.z)
    let hi = 0, acc = 0
    for (let s = 1; s <= n; s++) {
      const want = s * this.segLen
      while (hi < hp.length - 1) {
        const d = hp[hi].distanceTo(hp[hi + 1])
        if (acc + d >= want) break
        acc += d; hi++
      }
      const c = this.chain[s]
      if (hi < hp.length - 1) {
        const d = hp[hi].distanceTo(hp[hi + 1]) || 1
        V[2].lerpVectors(hp[hi], hp[hi + 1], clamp((want - acc) / d, 0, 1))
        c.pos.lerp(V[2], Math.min(1, 14 * dt))
      } else {
        c.pos.lerp(hp[hp.length - 1], Math.min(1, 14 * dt)) // path ran out: bunch up at the tail end
      }
    }

    // body pose: yaw only, a touch of roll into turns
    this.lift = this.dip
    this.pitch = 0
    this.roll = clamp(-this.headingVel * 0.03, -0.25, 0.25)
    E1.set(this.pitch, this.heading, this.roll, 'YXZ')
    this.quat.setFromEuler(E1)
    E1.set(0, this.heading, 0, 'YXZ')
    this.yawQuat.setFromEuler(E1)

    // squash + dip springs (petting, landings)
    this.squashVel += (1 - this.squash) * 90 * dt
    this.squashVel *= Math.max(0, 1 - 12 * dt)
    this.squash = clamp(this.squash + this.squashVel * dt, 0.55, 1.45)
    this.dipVel += (0 - this.dip) * 160 * dt
    this.dipVel *= Math.max(0, 1 - 14 * dt)
    this.dip += this.dipVel * dt
  }

  // OG flyer: hover-bob with a spinning propeller; boost pops up + surges forward
  updateFlyer(dt) {
    if (!this.controlled && this.wanderEnabled) this.wander(dt)
    const R = this.recipe
    const speed = this.seekTarget(dt, R.motion.speed * this.size, 3.5)
    this.propAngle += dt * (11 + this.speedN * 9)
    if (this.wantJump) {
      // boost: pop up AND surge forward
      this.kickY += 0.55; this.squashVel -= 2
      this.vel.x += Math.sin(this.heading) * 2.4 * this.size
      this.vel.z += Math.cos(this.heading) * 2.4 * this.size
    }
    this.wantJump = false
    this.kickY *= Math.max(0, 1 - 2.5 * dt)
    const hover = 0.8 * this.size + this.kickY + Math.sin(this.time * 1.7) * 0.07 + Math.sin(this.time * 0.61) * 0.04
    this.airY += (hover - this.airY) * Math.min(1, 3 * dt)
    this.lift = 0
    this.pitch = clamp(this.speedN * 0.22, -0.4, 0.4)
    this.roll = clamp(-this.headingVel * 0.07, -0.4, 0.4)
    E1.set(this.pitch, this.heading, this.roll, 'YXZ')
    this.quat.setFromEuler(E1)
    this.yawQuat.copy(this.quat)
    // gentle breathing squash
    this.squashVel += (1 + Math.sin(this.time * 2.2) * 0.02 - this.squash) * 60 * dt
    this.squashVel *= Math.max(0, 1 - 10 * dt)
    this.squash += this.squashVel * dt
    this.speedN = clamp(speed / (R.motion.speed * this.size), 0, 1)
  }

  // write all prims for the current pose (world space; group stays at identity)
  updateFrame(dt, bind) {
    const S = this.size
    if (bind) {
      this.lift = 0
      E1.set(0, this.heading, 0, 'YXZ')
      this.quat.setFromEuler(E1)
      this.yawQuat.copy(this.quat)
    }
    const breath = 1 + Math.sin(this.time * 2.4) * 0.035
    const pop = 0.6 + 0.4 * (1 - Math.pow(1 - this.spawnT, 3)) // spawn scale-in
    const rB = breath * pop * (this.puffK || 1)

    // body
    if (this.chain) {
      // serpent: sway each resampled chain point sideways with the slither phase
      const n = this.chain.length - 1
      // idle floor raised (0.25 -> 0.5) so a stationary serpent still visibly
      // coils/wags instead of reading as a static rope; top speed unaffected
      const amp = 0.13 * S * Math.max(0.5, 0.25 + this.speedN * 0.75)
      for (let s = 0; s <= n; s++) {
        const c = this.chain[s]
        const q = this.chain[Math.min(s + 1, n)], p = this.chain[Math.max(s - 1, 0)]
        let px = q.pos.z - p.pos.z, pz = -(q.pos.x - p.pos.x) // xz perpendicular to local direction
        const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl
        const sway = Math.sin(this.slitherT - s * 1.1) * amp * Math.min(1, s / 1.5)
        const lift = this.airY * Math.max(0, 1 - s / (n * 0.7))
        // cobra head-raise: lead segments arc up toward the lifted head
        const raise = this.headLift * Math.pow(Math.max(0, 1 - s / 2.6), 1.5)
        c.wx = c.pos.x + px * sway * Math.min(1, 0.25 + s / 2.6) // sway eases in past the raised neck
        c.wz = c.pos.z + pz * sway * Math.min(1, 0.25 + s / 2.6)
        c.wy = GY + (this.poseLift || 0) + c.r * 0.92 * rB * this.squash + lift + this.lift * 0.4 + raise
        if(this.riding || this.seated) {
          const scale=this.riding?boardScale(this):1.5,t=s/n
          const localX=Math.sin(t*Math.PI*2)*.09*scale,localZ=(.32-t*.70)*scale
          c.wx=this.pos.x+Math.cos(this.heading)*localX+Math.sin(this.heading)*localZ
          c.wz=this.pos.z-Math.sin(this.heading)*localX+Math.cos(this.heading)*localZ
        }
      }
      for (let s = 0; s < n; s++) {
        const a = this.chain[s], b = this.chain[s + 1]
        V[4].set(a.wx, a.wy, a.wz); V[5].set(b.wx, b.wy, b.wz)
        this.setPrim(a.i, V[4], V[5], a.r * rB, b.r * rB)
      }
    } else {
      this.toWorld(V[4], this.bodyA, this.lift)
      this.toWorld(V[5], this.bodyB, this.lift)
      this.setPrim(this.iBody, V[4], V[5], this.bodyRA * rB, this.bodyRB * rB)
    }
    if (this.iBelly >= 0) {
      this.toWorld(V[4], this.bellyLocal, this.lift)
      V[5].copy(V[4]); V[5].y += 0.01
      this.setPrim(this.iBelly, V[4], V[5], this.bellyR * rB, this.bellyR * rB * 0.98)
    }

    // head frame
    if (this.hasHead) {
      this.toWorld(V[6], this.neckLocal, this.lift) // neck base world
      E1.set(this.headPitch + this.headPitch0, this.heading + this.headYaw, 0, 'YXZ')
      Q1.setFromEuler(E1)
      V[7].set(0, Math.sin(this.headPitch0 + 0.3), Math.cos(this.headPitch0 + 0.3)).normalize()
      V[7].applyQuaternion(this.yawQuat)
      this.headPos = this.headPos || new THREE.Vector3()
      this.headPos.copy(V[6]).addScaledVector(V[7], this.neckLen)
      this.headQuat = this.headQuat || new THREE.Quaternion()
      this.headQuat.copy(Q1)
      V[8].set(0, 0, 1).applyQuaternion(Q1)
      V[4].copy(this.headPos).addScaledVector(V[8], -this.headLen * 0.5)
      V[5].copy(this.headPos).addScaledVector(V[8], this.headLen * 0.5)
      this.setPrim(this.iHead, V[4], V[5], this.headR * rB, this.headR * 0.74 * rB)
    } else {
      // headless: head frame = body top front
      this.headPos = this.headPos || new THREE.Vector3()
      this.headQuat = this.headQuat || new THREE.Quaternion()
      this.toWorld(this.headPos, this.bodyB, this.lift)
      E1.set(this.headPitch * 0.5, this.heading + this.headYaw * 0.5, this.roll, 'YXZ')
      this.headQuat.setFromEuler(E1)
    }

    // legs (world-space 2-bone IK)
    if (this.legs) for (const leg of this.legs) {
      this.toWorld(V[4], leg.hipLocal, this.lift) // hip world
      if (bind) {
        V[2].copy(leg.restLocal).applyQuaternion(this.yawQuat)
        leg.pos.set(this.pos.x + V[2].x, GY, this.pos.z + V[2].z)
      }
      // IK target slightly above ground by foot radius
      V[5].copy(leg.pos); V[5].y += Math.max(leg.footR * 0.7, leg.rS2)
      // pole
      if (leg.poleUp > 0) {
        V[6].set(leg.side * 0.9, leg.poleUp, 0.15).applyQuaternion(this.yawQuat)
      } else {
        V[6].set(leg.side * 0.22, 0.5, 1).applyQuaternion(this.yawQuat) // knees fold forward-up
      }
      solveIK(V[4], V[5], leg.l1, leg.l2, V[6], leg.knee)
      this.setPrim(leg.iThigh, V[4], leg.knee, leg.rT1, leg.rT2)
      this.setPrim(leg.iShin, leg.knee, V[5], leg.rS1, leg.rS2)
      if (leg.iFoot >= 0) {
        V[7].copy(leg.pos); V[7].y += leg.footR * 0.66
        V[8].copy(V[7]); V[8].y += 0.012
        this.setPrim(leg.iFoot, V[7], V[8], leg.footR, leg.footR * 0.95)
      }
    }

    // arms (swing with the gait)
    if (this.arms) for (const arm of this.arms) {
      this.toWorld(V[4], arm.shoulder, this.lift)
      const swing = Math.sin(this.gaitPhase * TAU + (arm.side < 0 ? Math.PI : 0)) * 0.6 * this.speedN
        + Math.sin(this.time * 1.3 + arm.side) * 0.06
      V[6].set(arm.side * 0.35, -0.88 + (this.airY > 0 ? 0.2 : 0), swing).normalize().applyQuaternion(this.yawQuat)
      V[5].copy(V[4]).addScaledVector(V[6], arm.len)
      this.setPrim(arm.iArm, V[4], V[5], arm.r1, arm.r2)
      V[7].copy(V[5]); V[7].y -= 0.005
      this.setPrim(arm.iHand, V[5], V[7], arm.handR, arm.handR * 0.95)
    }

    // ropes
    for (const rp of this.ropes) {
      this.toWorld(V[4], rp.attachLocal, this.lift)
      if (bind) {
        rp.rope.init = false
        updateRope(rp.rope, 0.016, V[4].x, V[4].y, V[4].z, this.quat)
      } else {
        updateRope(rp.rope, Math.min(dt, 0.033), V[4].x, V[4].y, V[4].z, this.quat)
        // idle excitation: nudge a mid-segment point so tails flop and antennae
        // boing at rest; verlet damping + shape memory settle it back
        rp.idleTimer -= dt
        if (rp.idleTimer <= 0) {
          rp.idleTimer = rr(1.5, 4)
          const kick = rp.rope.segLen * rr(0.4, 0.8) * clamp(1.4 - this.speedN, 0.6, 1.4)
          const ang = Math.random() * TAU
          const pt = rp.rope.pts[rp.idleMid]
          pt.x += Math.sin(ang) * kick
          pt.z += Math.cos(ang) * kick
          pt.y += rr(-0.3, 0.6) * kick
        }
      }
      const pts = rp.rope.pts
      for (let i = 0; i < rp.idx.length; i++) {
        this.setPrim(rp.idx[i], pts[i], pts[i + 1], rp.radii[i], rp.radii[i + 1])
      }
      if (rp.iTip >= 0) {
        V[5].copy(pts[pts.length - 1]); V[6].copy(V[5]); V[6].y += 0.008
        this.setPrim(rp.iTip, V[5], V[6], rp.tipR, rp.tipR * 0.96)
      }
    }

    // decos
    for (const d of this.decos) {
      if (d.frame === 'head' && this.hasHead) {
        V[4].copy(d.a).applyQuaternion(this.headQuat).add(this.headPos)
        V[5].copy(d.b).applyQuaternion(this.headQuat).add(this.headPos)
      } else {
        this.toWorld(V[4], d.a, this.lift)
        this.toWorld(V[5], d.b, this.lift)
      }
      if((this.hatPreviewId??this.hatId)>=0 && (d.frame==='head' || d.a.y>this.bodyY+this.bodyR*.65))
        this.setPrim(d.i,this.headPos,this.headPos,.00001,.00001)
      else this.setPrim(d.i, V[4], V[5], d.r1 * rB, d.r2 * rB)
    }

    // propeller (flyers): mast up from the crown, hub, 3 spinning blades
    if (this.prop) {
      const p = this.prop
      this.toWorld(V[4], p.base, this.lift)
      V[6].set(0, 1, 0).applyQuaternion(this.quat)
      V[5].copy(V[4]).addScaledVector(V[6], p.mastLen)
      this.setPrim(p.iMast, V[4], V[5], p.mastR, p.mastR * 0.7)
      V[7].copy(V[5]).addScaledVector(V[6], p.hubR * 0.6)
      V[8].copy(V[7]); V[8].y += 0.01
      this.setPrim(p.iHub, V[7], V[8], p.hubR, p.hubR * 0.95)
      for (let i = 0; i < 3; i++) {
        const a = this.propAngle + i * TAU / 3
        V[9].set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(this.quat)
        V[10].copy(V[7]).addScaledVector(V[9], p.hubR * 0.7)
        V[11].copy(V[7]).addScaledVector(V[9], p.bladeLen)
        this.setPrim(p.blades[i], V[10], V[11], p.bladeR1, p.bladeR2)
      }
      // A worn hat takes the flyer's crown socket. Its propeller returns when
      // the hat is removed, rather than passing through the brim.
      if((this.hatPreviewId??this.hatId)>=0)for(const i of [p.iMast,p.iHub,...p.blades])this.setPrim(i,this.headPos,this.headPos,.00001,.00001)
    }

    // spots (embedded surface dots)
    for (const sp of this.spots) {
      this.toWorld(V[4], sp.local, this.lift)
      V[5].copy(V[4]); V[5].y += 0.008
      this.setPrim(sp.i, V[4], V[5], sp.r * rB, sp.r * 0.97 * rB)
    }
  }

  updateEyes(dt) {
    if (!this.eyes.length) return
    // look dir: target > gaze
    if (this.target) {
      V[0].set(this.target.x - this.pos.x, 0, this.target.z - this.pos.z).normalize()
      this.lookDir.lerp(V[0], Math.min(1, 5 * dt)).normalize()
    } else if (this.gazeAt) {
      this.gazeT -= dt
      if (this.gazeT <= 0 || !critters.includes(this.gazeAt)) this.gazeAt = null
      else {
        V[0].set(this.gazeAt.pos.x - this.pos.x, (this.gazeAt.bodyY - this.bodyY) * 0.4, this.gazeAt.pos.z - this.pos.z).normalize()
        this.lookDir.lerp(V[0], Math.min(1, 4 * dt)).normalize()
      }
    }
    // head look springs
    const yawMax = 0.55
    let wantYawRaw = angleDiff(Math.atan2(this.lookDir.x, this.lookDir.z), this.heading)
    // gentle idle head sway so heads never look locked
    if (!this.target && !this.gazeAt && !this.controlled) wantYawRaw += Math.sin(this.time * 0.65 + this.id) * 0.12
    const wantYaw = clamp(wantYawRaw, -yawMax, yawMax)
    this.headYaw = lerp(this.headYaw, wantYaw, Math.min(1, 6 * dt))
    this.headPitch = lerp(this.headPitch, clamp(-this.lookDir.y * 0.8, -0.3, 0.25), Math.min(1, 5 * dt))

    // darting saccades: pupils snap to a new micro fixation and hold
    this.saccadeTimer -= dt
    if (this.saccadeTimer <= 0) {
      this.saccadeTimer = rr(0.7, 2.5)
      if (this.controlled && (this.input.x || this.input.z)) {
        const inputYaw = clamp(angleDiff(Math.atan2(this.input.x, this.input.z), this.heading), -yawMax, yawMax)
        this.saccadeX = clamp(inputYaw / yawMax, -1, 1) * 0.2
        this.saccadeY = rr(-0.05, 0.08)
      } else if (!this.target && !this.gazeAt && Math.random() < 0.3) {
        this.saccadeX = rr(-0.08, 0.08); this.saccadeY = rr(-0.2, -0.12) // glance at the ground
      } else {
        this.saccadeX = rr(-0.2, 0.2); this.saccadeY = rr(-0.14, 0.14)
      }
    }
    // tiny idle drift so a held fixation never looks frozen
    const driftX = Math.sin(this.time * 2.3 + this.id * 1.7) * 0.012
    const driftY = Math.sin(this.time * 1.7 + this.id * 2.3 + 1.3) * 0.008

    // blink (+ occasional quick double-blink)
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0 && this.blinkT < 0) {
      this.blinkT = 0
      this.blinkTimer = rr(1.8, 5)
      this.blinkQueued = Math.random() < 0.15
    }
    let blinkS = 1
    if (this.blinkT >= 0) {
      this.blinkT += dt / 0.22
      if (this.blinkT >= 1) {
        this.blinkT = -1
        if (this.blinkQueued) { this.blinkQueued = false; this.blinkT = 0; this.blinkTimer = rr(1.8, 5) }
      }
      else blinkS = 1 - Math.sin(Math.PI * this.blinkT) * 0.93
    }

    for (const e of this.eyes) {
      if (this.hasHead) V[0].copy(e.local).applyQuaternion(this.headQuat).add(this.headPos)
      else this.toWorld(V[0], e.local, this.lift) // headless: eye coords are ground-frame
      projectEyeOntoSurface(this, V[0], e.r)      // glue the eye to the LIVE union surface
      e.root.position.copy(V[0])
      e.root.quaternion.copy(this.headQuat)
      e.root.scale.set(1, blinkS, 1)
      // pupil tracks look dir in eye space, plus saccade micro-offset + idle drift
      Q2.copy(this.headQuat).invert()
      V[1].copy(this.lookDir).applyQuaternion(Q2)
      e.pupil.position.set(
        clamp(V[1].x * 0.35 + this.saccadeX + driftX, -0.3, 0.3) * e.r,
        clamp(V[1].y * 0.3 + this.saccadeY + driftY, -0.22, 0.22) * e.r,
        e.r * 0.48)
    }
  }

  dispose() {
    gearDispose(this)   // hats/boards live in the scene, not this.group
    scene.remove(this.group)
    this.geo.dispose()
    this.matBody.dispose()
    this.matOutline.dispose()
    this.shadow.material.dispose()
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer)
    const i = critters.indexOf(this)
    if (i >= 0) critters.splice(i, 1)
  }
}

// deterministic factory: same seed -> same archetype + recipe + palette on every client
export function critterMake(seed, x, z, heading = Math.random() * TAU) {
  const recipe = withSeededRng(seed, () => {
    const arch = pick(CRITTER_ARCHES)
    return genRecipe(arch)
  })
  const c = new Critter(recipe, x, z, heading)
  c.squash = 0.55; c.squashVel = 3.5 // pop in
  critters.push(c)
  return c
}

// debug/test helper: force an archetype (random seed, local only, NOT broadcast)
export function critterMakeArch(arch, x, z, heading = Math.random() * TAU) {
  // fail fast on a bad name: an unknown arch builds a limbless recipe whose
  // garbage prims poison the shared SDF uniforms and kill the render loop
  if (!CRITTER_ARCHES.includes(arch)) throw new Error('critterMakeArch: unknown archetype "' + arch + '" (valid: ' + CRITTER_ARCHES.join(', ') + ')')
  const recipe = withSeededRng((Math.random() * 1e9) | 0, () => genRecipe(arch))
  const c = new Critter(recipe, x, z, heading)
  c.squash = 0.55; c.squashVel = 3.5 // pop in
  critters.push(c)
  return c
}
