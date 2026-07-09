// src/net/api.js : chat UI (log + input + speech bubbles wiring) and the
// window.campfire control API that drives a headless bot/tester.
// API SURFACE (must not shrink): name, peers, peerList(), me(), moveTo(x,z),
// follow(name), stop(), say(text), setName(n), chatLog.
import { state, peers } from '../state.js'
import { bubble } from '../critter/tags.js'
import { net } from './net.js'
import { doJump, doPet, doWave } from '../moves.js'
import { setZoom, getZoom } from '../player.js'
import { isTouchDevice } from '../touch.js'

const chatLogArr = []
const chatLogEl = document.getElementById('chatlog')
const chatInput = document.getElementById('chatinput')
const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
function renderChatLog() { chatLogEl.innerHTML = chatLogArr.slice(-6).map(l => '<b>' + esc(l.name) + ':</b> ' + esc(l.text)).join('<br>') }
function logChat(name, text) { chatLogArr.push({ name, text }); if (chatLogArr.length > 80) chatLogArr.shift(); renderChatLog() }

export function doSay(text) {
  text = String(text).slice(0, 120); if (!text) return
  if (net.sendChat) net.sendChat({ n: state.myName, text })
  bubble(state.me, text); logChat(state.myName, text)
}

export function onChat(peerId, d) {
  if (!d || !d.text) return
  const p = peers.get(peerId)
  const name = (p && p.name) || d.n || peerId.slice(0, 4)
  if (p) bubble(p.critter, d.text)
  logChat(name, d.text)
}

export function setMyName(n) {
  state.myName = String(n).slice(0, 24) || state.myName
  state.me.tag.userData.draw(state.myName)
  // mirrors main.js's boot-time hint text (touch vs desktop instructions) so a
  // rename doesn't revert a touch device's hint back to desktop-only copy
  document.querySelector('.hint').innerHTML = 'you are <b style="color:#ffd39b">' + esc(state.myName) + '</b> &nbsp;·&nbsp; ' +
    (isTouchDevice ? 'joystick to walk · buttons to hop/pet/wave · drag to look' : 'WASD walk · Space hop · E pet · Q wave · drag to look · gamepad works')
  if (net.sendHello) net.sendHello({ seed: state.mySeed, n: state.myName, x: state.me.pos.x, z: state.me.pos.z, h: state.me.heading })
}

// human chat input: Enter focuses it, then Enter sends
chatInput.addEventListener('keydown', e => {
  e.stopPropagation()
  if (e.key === 'Enter') { const v = chatInput.value.trim(); if (v) doSay(v); chatInput.value = ''; chatInput.blur() }
  else if (e.key === 'Escape') { chatInput.value = ''; chatInput.blur() }
})
addEventListener('keydown', e => { if (e.key === 'Enter' && document.activeElement !== chatInput) { e.preventDefault(); chatInput.focus() } })

// the control API a headless bot drives its critter through (moveTo/follow feed
// the local critter's target; manual WASD input overrides)
window.campfire = {
  get name() { return state.myName },
  get peers() { return peers.size },
  peerList() { return [...peers.entries()].map(([id, p]) => ({ id, name: p.name || null, x: +p.critter.pos.x.toFixed(2), z: +p.critter.pos.z.toFixed(2), arch: p.critter.arch, airY: +p.critter.airY.toFixed(2), puff: +p.critter.puffK.toFixed(2) })) },
  me() { return { name: state.myName, x: +state.me.pos.x.toFixed(2), z: +state.me.pos.z.toFixed(2), arch: state.me.arch, airY: +state.me.airY.toFixed(2), puff: +state.me.puffK.toFixed(2) } },
  moveTo(x, z) { state.followName = null; state.autoTarget = { x: +x, z: +z } },
  follow(name) { state.autoTarget = null; state.followName = (name == null ? '' : String(name)) },
  stop() { state.followName = null; state.autoTarget = null; state.me.target = null },
  say(text) { doSay(text) },
  setName(n) { setMyName(n) },
  chatLog: chatLogArr,
  // moves (additive surface, Lane A): jump/hop, pet nearest critter, wave shimmy
  hop() { doJump() },
  pet() { doPet() },
  wave() { doWave() },
  // camera zoom (additive surface): set distance (clamped 6..18) or read it back
  zoom(d) { return d == null ? getZoom() : setZoom(d) },
}
