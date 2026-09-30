// Voice uses the SAME Trystero room/RTCPeerConnections as movement and chat.
// The browser transports microphone audio as WebRTC media, never chat packets.
import * as THREE from 'three'
import { state, peers } from '../state.js'
import { camera } from '../world/scene.js'
import { initAudio } from '../audio.js'
import { getSettings } from '../preferences.js'

let room = null, sendState = null, ctx = null, mic = null, localSource = null, localMeter = null
let joined = false, pending = false, muted = false, deafened = false, mode = 'open', held = false
let generation = 0, uiClock = 0, localLevel = 0
const remotes = new Map(), remoteStates = new Map()
const forward = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
const el = id => document.getElementById(id)
const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')

function status(text, error = false) {
  el('voice-status').textContent = text
  el('voice-status').classList.toggle('error', error)
}
async function broadcast() {
  if (sendState) {
    try { await sendState({ joined, muted: !transmitting() }) } catch {}
  }
}
function transmitting() { return joined && !muted && !deafened && (mode !== 'ptt' || held) }
function applyMic() {
  for (const track of mic?.getAudioTracks() || []) track.enabled = transmitting()
  broadcast()
  draw()
}
function draw() {
  el('voice-label').textContent = pending ? 'Cancel' : !joined ? 'Join voice' : mode === 'ptt' ? (held ? 'Talking…' : 'Hold to talk') : muted ? 'Unmute mic' : 'Mute mic'
  el('voice-join').setAttribute('aria-pressed', String(joined && !muted))
  el('voice-leave').hidden = !joined && !pending
  el('voice-deafen').setAttribute('aria-pressed', String(deafened))
  el('voice-deafen').setAttribute('aria-label', deafened ? 'Undeafen voice' : 'Deafen voice')
  el('voice-deafen').title = deafened ? 'Undeafen voice' : 'Deafen voice'
  el('voice-people').textContent = String(remotes.size + (joined ? 1 : 0))
  if (joined) status(deafened ? 'Deafened. Your microphone is quiet too.' : muted ? 'Microphone muted. You can still listen.' : mode === 'ptt' ? 'Hold the mic button or V to talk. Release to listen.' : 'Mic on · spatial voice around the fire')
}
function detachAudio(r) {
  r.source?.disconnect(); r.analyser?.disconnect(); r.panner?.disconnect(); r.gain?.disconnect()
  r.source = r.analyser = r.panner = r.gain = null
  r.level = r.gainValue = 0
}
function disconnectRemote(peerId) {
  const r = remotes.get(peerId)
  if (!r) return
  detachAudio(r)
  r.sink.pause(); r.sink.srcObject = null; r.sink.remove()
  r.track?.removeEventListener('ended', r.onEnd)
  const c = peers.get(peerId)?.critter
  if (c) c.voiceSpeaking = false
  remotes.delete(peerId)
  draw(); renderRoster()
}
function attachAudio(r) {
  if (r.source || !ctx) return
  r.source = ctx.createMediaStreamSource(r.stream)
  r.analyser = ctx.createAnalyser(); r.analyser.fftSize = 256
  r.samples = new Float32Array(r.analyser.fftSize)
  r.panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.5, maxDistance: 32, rolloffFactor: 1.4 })
  r.gain = ctx.createGain(); r.gain.gain.value = 0
  r.source.connect(r.analyser).connect(r.panner).connect(r.gain).connect(ctx.destination)
}
function receiveStream(stream, peerId) {
  if (!stream.getAudioTracks().length || remoteStates.get(peerId)?.joined === false) return
  const old = remotes.get(peerId)
  if (old?.stream.id === stream.id) return
  const peerMuted = old?.muted || false
  disconnectRemote(peerId)
  // Chromium needs a live muted media element to feed remote WebRTC into Web Audio.
  const sink = document.createElement('audio')
  sink.muted = true; sink.autoplay = joined; sink.setAttribute('playsinline', '')
  sink.hidden = true; sink.srcObject = stream; document.body.appendChild(sink)
  if (joined) sink.play().catch(() => {})
  const r = { stream, sink, muted: peerMuted, level: 0, gainValue: 0, track: stream.getAudioTracks()[0] }
  r.onEnd = () => { if (remotes.get(peerId) === r) disconnectRemote(peerId) }
  r.track.addEventListener('ended', r.onEnd)
  remotes.set(peerId, r)
  if (joined) attachAudio(r)
  draw(); renderRoster()
}
export function bindVoiceRoom(handle, send) {
  room = handle; sendState = send
  room.onPeerStream = receiveStream
}
export function onVoiceState(data, peerId) {
  if (!data || typeof data.joined !== 'boolean') return
  remoteStates.set(peerId, { joined: data.joined, muted: !!data.muted })
  if (!data.joined) disconnectRemote(peerId)
}
export function voicePeerJoined(peerId) {
  broadcast()
  if (mic && joined) Promise.resolve(room.addStream(mic, { target: peerId, metadata: { campfireVoice: 1 } })).catch(() => status('Voice connection failed. Leave voice and try again.', true))
}
export function voicePeerLeft(peerId) { disconnectRemote(peerId); remoteStates.delete(peerId) }

export async function joinVoice() {
  if (pending || joined) return
  if (!room) { status('The room is still connecting. Try again shortly.', true); return }
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) { status('Voice needs HTTPS or localhost and microphone support.', true); return }
  const request = ++generation
  pending = true; draw(); status('Allow your microphone to join voice.')
  let stream = null
  try {
    ctx = initAudio()
    if (!ctx) throw new Error('Audio is unavailable in this browser.')
    await ctx.resume()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
    if (request !== generation) { stream.getTracks().forEach(t => t.stop()); return }
    mic = stream; joined = true; muted = false; held = false
    for (const track of mic.getAudioTracks()) {
      track.enabled = transmitting()
      track.addEventListener('ended', () => { if (mic === stream) { leaveVoice(); status('Microphone disconnected. Reconnect it and join voice.', true) } }, { once: true })
    }
    localSource = ctx.createMediaStreamSource(mic)
    localMeter = ctx.createAnalyser(); localMeter.fftSize = 256
    localSource.connect(localMeter) // never connected to output: no self-echo
    // Send the new state before negotiating media, so a rejoin stream cannot
    // be discarded against the receiver's previous "voice left" state.
    await broadcast()
    if (request !== generation) return
    await room.addStream(mic, { metadata: { campfireVoice: 1 } })
    if (request !== generation) return
    for (const r of remotes.values()) { attachAudio(r); r.sink.play().catch(() => {}) }
    pending = false; applyMic(); renderRoster()
  } catch (err) {
    stream?.getTracks().forEach(t => t.stop())
    if (request !== generation) return
    leaveVoice()
    const messages = { NotAllowedError: 'Microphone permission denied. Allow it in browser settings, then try again.', NotFoundError: 'No microphone found. Connect one, then try again.', NotReadableError: 'Microphone is busy. Check your device and try again.' }
    status(messages[err.name] || 'Could not start voice. Check your microphone and try again.', true)
  }
}
export function leaveVoice() {
  ++generation; pending = false; joined = false; held = false; muted = false
  const stream = mic; mic = null
  stream?.getTracks().forEach(t => t.stop())
  if (stream && room) { try { room.removeStream(stream) } catch {} }
  localSource?.disconnect(); localMeter?.disconnect(); localSource = localMeter = null; localLevel = 0
  for (const [id, r] of remotes) {
    detachAudio(r); r.sink.pause()
    const c = peers.get(id)?.critter
    if (c) c.voiceSpeaking = false
  }
  broadcast(); draw(); renderRoster(); status('Voice off. Your microphone is released.')
}
function setHeld(value) { if (held === value) return; held = value; if (joined && mode === 'ptt') applyMic() }
function renderRoster() {
  const roster = el('voice-roster')
  roster.replaceChildren()
  if (!remotes.size && !joined) { roster.textContent = 'No voices yet. Invite someone to join you.'; return }
  if (joined) {
    const own = document.createElement('div'); own.className = 'voice-person'
    own.textContent = state.myName + ' (you)'; roster.appendChild(own)
  }
  for (const [id, r] of remotes) {
    const row = document.createElement('div'); row.className = 'voice-person'; row.dataset.peer = id
    const name = document.createElement('span'); name.textContent = peers.get(id)?.name || 'A friend'
    const button = document.createElement('button'); button.textContent = r.muted ? 'Unmute' : 'Mute'
    button.setAttribute('aria-label', (r.muted ? 'Unmute ' : 'Mute ') + name.textContent)
    button.addEventListener('click', () => { r.muted = !r.muted; renderRoster() })
    row.append(name, button); roster.appendChild(row)
  }
}
export function initVoice() {
  el('voice-join').addEventListener('click', () => {
    if (pending) leaveVoice()
    else if (!joined) joinVoice()
    else if (mode !== 'ptt') { muted = !muted; applyMic() }
  })
  el('voice-join').addEventListener('pointerdown', e => {
    if (!joined || mode !== 'ptt') return
    e.preventDefault()
    el('voice-join').setPointerCapture(e.pointerId)
    setHeld(true)
  })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    el('voice-join').addEventListener(event, () => setHeld(false))
  el('voice-leave').addEventListener('click', leaveVoice)
  el('voice-deafen').addEventListener('click', () => { deafened = !deafened; applyMic() })
  el('voice-mode').addEventListener('change', e => { mode = e.target.value; held = false; muted = false; applyMic() })
  el('voice-people').addEventListener('click', () => {
    const roster = el('voice-roster'); roster.hidden = !roster.hidden
    el('voice-people').setAttribute('aria-expanded', String(!roster.hidden)); renderRoster()
  })
  addEventListener('keydown', e => { if (e.code === 'KeyV' && !typing() && joined && mode === 'ptt') { e.preventDefault(); setHeld(true) } })
  addEventListener('keyup', e => { if (e.code === 'KeyV') setHeld(false) })
  addEventListener('blur', () => setHeld(false))
  document.addEventListener('visibilitychange', () => { if (document.hidden) setHeld(false) })
  document.addEventListener('focusin', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) setHeld(false) })
  addEventListener('pagehide', leaveVoice)
  window.campfire.voice = { join: joinVoice, leave: leaveVoice, snapshot: voiceSnapshot }
  draw()
}
const samples = new Float32Array(256)
function level(analyser, buffer) {
  if (!analyser) return 0
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (const value of buffer) sum += value * value
  return Math.sqrt(sum / buffer.length)
}
export function updateVoice(dt) {
  if (!ctx || !state.me) return
  const now = ctx.currentTime, me = state.me.pos, listener = ctx.listener
  // Listen from the avatar, with orientation from the camera. Zoom never changes range.
  const set = (param, value) => param.setTargetAtTime(value, now, 0.03)
  camera.getWorldDirection(forward)
  up.copy(camera.up).applyQuaternion(camera.quaternion).normalize()
  set(listener.positionX, me.x); set(listener.positionY, 2.2); set(listener.positionZ, me.z)
  set(listener.forwardX, forward.x); set(listener.forwardY, forward.y); set(listener.forwardZ, forward.z)
  set(listener.upX, up.x); set(listener.upY, up.y); set(listener.upZ, up.z)
  localLevel = transmitting() ? level(localMeter, samples) : 0
  const voiceVolume=getSettings().voice
  for (const [id, r] of remotes) {
    const p = peers.get(id)?.critter?.pos
    if (!r.panner) continue
    if (p) { set(r.panner.positionX, p.x); set(r.panner.positionY, 2.2); set(r.panner.positionZ, p.z) }
    const distance = p ? Math.hypot(p.x - me.x, p.z - me.z) : Infinity
    // A soft cutoff keeps distant voices silent, even beyond PannerNode.maxDistance.
    r.gainValue = joined && !deafened && !r.muted && !remoteStates.get(id)?.muted ? Math.max(0, Math.min(1, (28 - distance) / 8)) : 0
    set(r.gain.gain, r.gainValue * voiceVolume)
    r.level = level(r.analyser, r.samples)
    const c = peers.get(id)?.critter
    if (c) c.voiceSpeaking = joined && r.gainValue > 0 && r.level > 0.015
  }
  uiClock += dt
  if (uiClock > 0.12) {
    uiClock = 0
    el('voice-join').classList.toggle('speaking', localLevel > 0.015)
    for (const row of el('voice-roster').querySelectorAll('[data-peer]')) row.classList.toggle('speaking', !!peers.get(row.dataset.peer)?.critter.voiceSpeaking)
  }
}
export function voiceSnapshot() {
  return { joined, pending, muted, deafened, mode, held, transmitting: transmitting(), localLevel, context: ctx?.state || null, tracks: (mic?.getAudioTracks() || []).map(t => ({ enabled: t.enabled, readyState: t.readyState })), remotes: [...remotes].map(([id, r]) => ({ id, level: r.level, gain: r.gainValue, outputGain:r.gain?.gain.value || 0, muted: r.muted, panner: r.panner ? [r.panner.positionX.value, r.panner.positionZ.value] : null })) }
}
