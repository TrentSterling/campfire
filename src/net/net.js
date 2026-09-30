// src/net/net.js : Trystero networking. Resilient: the scene still runs if
// this fails (solo mode never crashes the page). NPC ownership, keeper
// election, and the shared entity store live in ./replication.js; this file
// only wires Trystero lanes into that store and drives the status UI.
// PROTOCOL (do not break, extend additively only): move/hello payloads are
// {seed, n, x, z, h}; chat payloads are {n, text}; sync payloads (NPCs) are
// {id, seed, n, x, z, tx, tz, f} or a despawn {id, gone:1} -- see
// replication.js's header for the full wire contract. Remote critters are
// BUILT from the seed and WALK to the broadcast position with their own gait
// (target mode, no lerping).
import { state, peers } from '../state.js'
import {
  setSelfId, setSendSync, onPlayerState, removePeerEntity,
  peerJoined, peerLeft, onSyncMessage, startNPCs,
} from './replication.js'
import { bindVoiceRoom, onVoiceState, voicePeerJoined, voicePeerLeft } from './voice.js'

const statusEl = document.getElementById('status'), dotEl = document.getElementById('dot')
export function setStatus(txt, on) { statusEl.textContent = txt; dotEl.classList.toggle('on', !!on) }

// live send fns (null until connect succeeds); other modules read net.sendChat etc.
// sendAct + selfId: additive 'act' lane ({t:'hop'|'pet'|'wave', target?}, see src/moves.js)
// sendSync: additive 'sync' lane (NPC snapshots/despawns, see src/net/replication.js)
export const net = { sendMove: null, sendHello: null, sendChat: null, sendAct: null, sendSync: null, selfId: null, room: null }

// normalize Trystero makeAction across tuple-form and object-form APIs
function wireAction(room, id, handler) {
  const a = room.makeAction(id)
  if (Array.isArray(a)) { const [send, get] = a; get((data, peerId) => handler(data, peerId)); return send }
  a.onMessage = (data, meta) => handler(data, meta && meta.peerId); return a.send.bind(a)
}

// move/hello share one handler: both feed the universal player-entity apply
// path in replication.js. Status text updates only the first time a peer is
// seen (onPlayerState returns whether this upsert was a new peer).
function handlePeerMsg(d, peerId) {
  if (onPlayerState(d, peerId)) setStatus(`${peers.size + 1} friends by the fire`, true)
}

export async function connect({ onChat, onAct }) {
  try {
    const { joinRoom, selfId } = await import('trystero')
    const room = new URLSearchParams(location.search).get('room') || 'main'
    const roomHandle = joinRoom({ appId: 'tront-campfire' }, room)
    net.room = roomHandle
    setStatus('The fire is warm. Room for a friend.', true)
    net.selfId = selfId
    setSelfId(selfId)

    net.sendMove = wireAction(roomHandle, 'move', handlePeerMsg)
    net.sendHello = wireAction(roomHandle, 'hello', handlePeerMsg)
    net.sendChat = wireAction(roomHandle, 'chat', (d, peerId) => onChat(peerId, d))
    if (onAct) net.sendAct = wireAction(roomHandle, 'act', (d, peerId) => onAct(d, peerId))
    net.sendSync = wireAction(roomHandle, 'sync', (d, peerId) => onSyncMessage(d, peerId))
    setSendSync(net.sendSync)
    bindVoiceRoom(roomHandle, wireAction(roomHandle, 'voice', onVoiceState))

    // v1.3+ additive fields: ht hat id, sb skateboard, wt warmth (title line),
    // fs/fseed/bx/bz are fishing (set by fishing.js via state.fishWire)
    const { getWarmth } = await import('../progress.js')
    const myState = () => ({
      seed: state.mySeed, n: state.myName, x: state.me.pos.x, z: state.me.pos.z, h: state.me.heading,
      ht: state.me.hatId ?? -1, sb: state.me.riding ? 1 : 0, wt: getWarmth(), ...state.fishWire,
    })
    roomHandle.onPeerJoin = peerId => { net.sendHello(myState()); peerJoined(peerId); voicePeerJoined(peerId) }
    roomHandle.onPeerLeave = peerId => {
      peerLeft(peerId)
      voicePeerLeft(peerId)
      if (removePeerEntity(peerId)) setStatus(peers.size ? `${peers.size + 1} friends by the fire` : 'The fire is warm. Room for a friend.', true)
    }

    // heartbeat + throttled movement broadcast
    setInterval(() => { if (net.sendMove) net.sendMove(myState()) }, 90)
    console.log('[campfire] connected, selfId', selfId)
  } catch (err) {
    console.warn('[campfire] networking unavailable, running solo:', err)
    setStatus('solo by the fire (no network)', false)
  }
}

export { startNPCs }
