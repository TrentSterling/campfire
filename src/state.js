// src/state.js : shared mutable refs so modules avoid circular imports.
// critters: every live Critter (local player, remote peers, NPCs).
// peers: peerId -> { critter, name, seed, heading } (written by net/net.js).
// npcs: companion critters managed by net/net.js manageNPCs.
// state: local player identity + control targets (main.js boots me/myName/mySeed;
// player.js and net/api.js read/write autoTarget/followName; api.js mutates myName).
export const critters = []
export const peers = new Map()
export const npcs = []
export const state = {
  me: null,          // local player Critter (set by main.js at boot)
  myName: '',        // display name (net/api.js setMyName mutates)
  mySeed: 0,         // deterministic recipe seed broadcast to peers
  autoTarget: null,  // {x,z} goal set by campfire.moveTo()
  followName: null,  // '' = nearest peer, or a specific name; null = off
}
