// Discoverable activities on mouse, keyboard and touch. Existing gameplay owns
// hats, skating and fishing; this module supplies navigation and timely feedback.
import { state } from './state.js'
import { RACK_POS, nearRack } from './critter/gear.js'
import { doPet, doRide } from './moves.js'
import { doFish, getFishingState, fishFromSeed } from './fishing.js'
import { bubble } from './critter/tags.js'
import { walkPath } from './world/obstacles.js'

let job = null, lastFish = -1, noticeUntil = 0
const statusEl = () => document.getElementById('activity-status')
function notice(text, seconds = 4) {
  statusEl().textContent = text; statusEl().hidden = false
  noticeUntil = performance.now() + seconds * 1000
}
function walkTo(kind, target) {
  const r=Math.min(.36,Math.max(.18,state.me.bodyR*.55))
  const points = walkPath(state.me.pos,target,r)
  if(!points){notice('Finding a clear way around.');return}
  job = {kind,points,target:points.shift()}
  state.followName = null; state.autoTarget = job.target
  notice(kind === 'fish' ? 'Heading to the shore. Your line will cast when you arrive.' : kind === 'hats' ? 'Heading to the hat rack. Pick something that feels like you.' : 'There is always a spot by the fire.', 30)
}
function cancel() {
  job = null; state.autoTarget = null; state.me.target = null
}
export function initActivities() {
  document.getElementById('activity-fish').addEventListener('click', () => {
    if (getFishingState().st) { doFish(); return }
    if (job?.kind === 'fish') { cancel(); notice('Stay here a while.'); return }
    if (Math.hypot(state.me.pos.x,state.me.pos.z) >= 12) { doFish(); return }
    const p = state.me.pos, d = Math.hypot(p.x,p.z) || 1
    walkTo('fish',{x:p.x/d*14.4,z:p.z/d*14.4})
  })
  document.getElementById('activity-hats').addEventListener('click', () => {
    if (nearRack(state.me)) { doPet(); notice('Try on a hat. Wear it when you are ready.'); return }
    walkTo('hats',{...RACK_POS})
  })
  document.getElementById('activity-fire').addEventListener('click', () => walkTo('fire',{x:0,z:4.5}))
  document.getElementById('activity-skate').addEventListener('click', () => {
    doRide(); notice(state.me.riding ? 'Ride on. Hop to throw an ollie.' : 'Back on your feet.')
  })
  addEventListener('keydown', e => {
    if (!job || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(e.code)) { cancel(); notice('Take the path you like.') }
  })
  window.__activityState = () => ({walking:job?.kind || null,fish:getFishingState().st,riding:!!state.me.riding})
}
export function updateActivities() {
  if (job) {
    if (Math.hypot(state.me.pos.x-job.target.x,state.me.pos.z-job.target.z)<.6) {
      if (job.points.length) { job.target=job.points.shift();state.autoTarget=job.target }
      else {
        const kind=job.kind;cancel()
        if (kind==='fish') doFish()
        else if (kind==='hats') { doPet();notice('Try on a hat. Buying is your choice.') }
        else { bubble(state.me,'warm and toasty');notice('Make yourself at home.') }
      }
    } else if (!state.autoTarget) { job=null;notice('Take the path you like.') }
  }
  const fish=getFishingState(), button=document.getElementById('activity-fish')
  if (fish.st!==lastFish) {
    lastFish=fish.st
    button.textContent=fish.st===2?'Reel in!':fish.st===1?'Reel in':'Fish'
    button.dataset.phase=fish.st===2?'bite':String(fish.st)
    if (fish.st===1) notice('Watch for the dip. Reel in when the button lights up.',30)
    else if (fish.st===2) notice('It is biting. Reel in now!',3)
    else if (fish.st===3) {const f=fishFromSeed(fish.seed);notice(`${f.len}cm ${f.name}${f.golden?' (golden)':''}. Saved to your journal.`,7)}
  }
  document.getElementById('activity-skate').setAttribute('aria-pressed',String(!!state.me.riding))
  if (performance.now()>noticeUntil && fish.st===0 && !job) statusEl().hidden=true
}
