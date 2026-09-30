// src/audio.js : Web Audio (Lane C). initAudio() builds a suspended AudioContext,
// self-unlocks on the first pointerdown/keydown (no dependency on main.js for the
// gesture), and starts a quiet looping fire-crackle + night-ambience bed synthesized
// from noise buffers (zero asset fetches). playChirp(kind) fires short synthesized
// blips/thumps for kind: 'hop' | 'land' | 'pet' | 'wave' | 'footstep'. spawnDust(x,
// y, z, count, spread, size, life) bursts soft-circle sprites (reusing the world's
// softCircleTexture) that rise and fade over `life` seconds then self-dispose via
// update(dt), which the frame loop should call every tick alongside initAudio() once
// at boot.
import * as THREE from 'three'
import { scene, softCircleTexture } from './world/scene.js'
import { getSettings } from './preferences.js'

let ctx = null
let master = null
let ambienceBus=null, effectsBus=null
let bedStarted = false
let ambienceMuted = false

export function setAmbienceMuted(muted) {
  ambienceMuted = !!muted
  applyAudioSettings()
}
export function applyAudioSettings() {
  if(!ctx)return
  const s=getSettings()
  ambienceBus?.gain.setTargetAtTime(ambienceMuted?0:s.ambience,ctx.currentTime,.03)
  effectsBus?.gain.setTargetAtTime(s.effects,ctx.currentTime,.03)
}
export const audioMixSnapshot=()=>({ambience:ambienceBus?.gain.value,effects:effectsBus?.gain.value,muted:ambienceMuted})

// ---------------------------------------------------------------------------
// context lifecycle
// ---------------------------------------------------------------------------
export function initAudio() {
  if (ctx) return ctx
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.6
    master.connect(ctx.destination)
    ambienceBus=ctx.createGain();effectsBus=ctx.createGain()
    ambienceBus.connect(master);effectsBus.connect(master);applyAudioSettings()
    const resume = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}) }
    addEventListener('pointerdown', resume, { passive: true, once: true })
    addEventListener('keydown', resume, { once: true })
    if (!bedStarted) { bedStarted = true; startAmbienceBed() }
  } catch (e) {
    console.warn('audio: initAudio failed', e)
    ctx = null
  }
  return ctx
}

function noiseBuffer(seconds) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  return buf
}

// subtle looping fire-crackle (bandpass noise, slow random gain flicker) plus a
// steady low night-ambience bed (lowpass noise), both very quiet
function startAmbienceBed() {
  try {
    const crackle = ctx.createBufferSource()
    crackle.buffer = noiseBuffer(3); crackle.loop = true
    const crackleFilt = ctx.createBiquadFilter()
    crackleFilt.type = 'bandpass'; crackleFilt.frequency.value = 1200; crackleFilt.Q.value = 0.6
    const crackleGain = ctx.createGain(); crackleGain.gain.value = 0.04
    crackle.connect(crackleFilt).connect(crackleGain).connect(ambienceBus)
    crackle.start()
    const flicker = () => {
      if (!ctx) return
      crackleGain.gain.linearRampToValueAtTime(0.02 + Math.random() * 0.045, ctx.currentTime + 0.15 + Math.random() * 0.25)
      setTimeout(flicker, 150 + Math.random() * 250)
    }
    flicker()

    const night = ctx.createBufferSource()
    night.buffer = noiseBuffer(4); night.loop = true
    const nightFilt = ctx.createBiquadFilter()
    nightFilt.type = 'lowpass'; nightFilt.frequency.value = 380
    const nightGain = ctx.createGain(); nightGain.gain.value = 0.03
    night.connect(nightFilt).connect(nightGain).connect(ambienceBus)
    night.start()
  } catch (e) { console.warn('audio: ambience bed failed', e) }
}

// ---------------------------------------------------------------------------
// chirps: cheap synthesized blips/thumps, no samples
// ---------------------------------------------------------------------------
function blip(f0, f1, dur, type, gainV) {
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator(); osc.type = type
  osc.frequency.setValueAtTime(f0, t0)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(gainV, t0)
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
  osc.connect(g).connect(effectsBus)
  osc.start(t0); osc.stop(t0 + dur + 0.02)
}

function thump(dur, gainV) {
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator(); osc.type = 'sine'
  osc.frequency.setValueAtTime(150, t0)
  osc.frequency.exponentialRampToValueAtTime(48, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(gainV, t0)
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
  osc.connect(g).connect(effectsBus)
  osc.start(t0); osc.stop(t0 + dur + 0.02)
}

export function playChirp(kind) {
  if (!ctx) return
  if (ctx.state !== 'running') ctx.resume().catch(() => {})
  switch (kind) {
    case 'hop': blip(520, 780, 0.14, 'sine', 0.16); break
    case 'land': thump(0.14, 0.22); break
    case 'pet': blip(700, 980, 0.12, 'triangle', 0.14); break
    case 'wave': blip(600, 1100, 0.18, 'sine', 0.11); break
    case 'footstep': thump(0.06, 0.06); break
    default: break
  }
}

// ---------------------------------------------------------------------------
// dust: soft-circle sprite bursts that rise and fade, then self-dispose
// ---------------------------------------------------------------------------
const dustTex = softCircleTexture(0.1)
const dustPool = []

export function spawnDust(x, y, z, count = 6, spread = 0.25, size = 0.08, life = 0.6) {
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: dustTex, color: 0xd9c9a4, transparent: true, opacity: 0.5, depthWrite: false,
    })
    const spr = new THREE.Sprite(mat)
    const a = Math.random() * Math.PI * 2, r = Math.random() * spread
    spr.position.set(x + Math.cos(a) * r, y + Math.random() * size, z + Math.sin(a) * r)
    const s = size * (0.6 + Math.random() * 0.8)
    spr.scale.set(s, s, 1)
    scene.add(spr)
    dustPool.push({
      spr, mat, t: 0, life: life * (0.8 + Math.random() * 0.4),
      vy: size * (0.7 + Math.random() * 0.8),
      vx: (Math.random() - 0.5) * size * 0.8,
      vz: (Math.random() - 0.5) * size * 0.8,
      s0: s,
    })
  }
}

// per-frame dust animation (rise, fade, grow slightly, dispose on expiry); the
// wiring pass should call this every frame alongside the rest of the tick
export function update(dt) {
  if (!dustPool.length) return
  for (let i = dustPool.length - 1; i >= 0; i--) {
    const d = dustPool[i]
    d.t += dt
    if (d.t >= d.life) {
      scene.remove(d.spr)
      d.mat.dispose()
      dustPool.splice(i, 1)
      continue
    }
    const k = d.t / d.life
    d.spr.position.x += d.vx * dt
    d.spr.position.y += d.vy * dt * (1 - k * 0.6)
    d.spr.position.z += d.vz * dt
    d.mat.opacity = 0.5 * (1 - k)
    const s = d.s0 * (1 + k * 0.7)
    d.spr.scale.set(s, s, 1)
  }
}
