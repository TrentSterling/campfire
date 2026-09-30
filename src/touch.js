// src/touch.js (Lane B): virtual joystick + tap buttons for touch/mobile.
// Injects its own DOM (no index.html edits) and does nothing at all on
// non-touch devices (desktop mouse/keyboard untouched, zero DOM added).
//
// ---------------------------------------------------------------------------
// WIRING (for the pass that edits src/main.js):
//
//   import { initTouchControls, update as updateTouch } from './touch.js'
//   ...
//   initTouchControls({
//     onMove: (x, z) => { ... },   // see convention below
//     onHop:  () => window.campfire.hop(),
//     onPet:  () => window.campfire.pet(),
//     onWave: () => window.campfire.wave(),
//   })
//
//   // every frame, AFTER player.js's updateMovement(dt) (same slot as
//   // moves.js's updateMoves(dt) — the "last write wins" pattern already
//   // used for the gamepad path):
//   updateTouch(dt)
//
// onMove(x, z) convention: this mirrors the gamepad left-stick axes read in
// src/moves.js (gp.axes[0]/gp.axes[1]) EXACTLY, so the onMove callback can
// reuse that same math verbatim:
//
//   camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize()
//   right.crossVectors(fwd, UP).normalize()
//   state.autoTarget = null; state.followName = null
//   me.controlled = true
//   me.input.set(right.x * x - fwd.x * z, 0, right.z * x - fwd.z * z)
//   if (me.arch !== 'hopper') me.target = null
//
// x = strafe-right positive (-1..1), z = forward-negative / back-positive
// (-1..1) — i.e. dragging the knob straight up yields (0, -1), which is
// "forward" under the same sign convention gp.axes[1] uses. onMove is
// invoked continuously while the knob is held (on every drag move AND once
// per update(dt) tick, so a stationary held knob still re-asserts input
// every frame the way player.js's updateMovement expects) and exactly once
// with (0, 0) on release. onHop/onPet/onWave fire once per tap.
// ---------------------------------------------------------------------------

export const isTouchDevice = ('ontouchstart' in window)

let _onMove = () => {}
let _joyActive = false
let _joyX = 0
let _joyZ = 0

const STYLE = `
.cf-touch-joy-base, .cf-touch-btns { -webkit-tap-highlight-color: transparent; touch-action: none; }
.cf-touch-joy-base {
  position: fixed; left: 22px; bottom: 22px; z-index: 15;
  width: 108px; height: 108px; border-radius: 50%;
  background: rgba(40,30,56,0.55); border: 1px solid #ffffff2e;
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  user-select: none;
}
.cf-touch-joy-knob {
  width: 46px; height: 46px; border-radius: 50%;
  background: #ffd39b; opacity: .92;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
  transition: transform .15s ease;
  pointer-events: none;
}
.cf-touch-joy-knob.dragging { transition: none; }
.cf-touch-btns {
  position: fixed; right: 20px; bottom: 26px; z-index: 15;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
}
.cf-touch-btn {
  width: 58px; height: 58px; border-radius: 50%;
  background: rgba(40,30,56,0.55); border: 1px solid #ffffff2e;
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  font: 500 24px/1 ui-rounded, "Segoe UI", system-ui, sans-serif;
  color: #ffe9c7; text-shadow: 0 1px 3px rgba(0,0,0,.6);
  user-select: none; transition: background .1s ease, transform .1s ease;
}
.cf-touch-btn.active { background: rgba(255,211,155,0.35); transform: scale(0.92); }
`

export function initTouchControls({ onMove, onHop, onPet, onWave } = {}) {
  if (!isTouchDevice) return
  _onMove = typeof onMove === 'function' ? onMove : () => {}

  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  // --- joystick -------------------------------------------------------
  const base = document.createElement('div')
  base.className = 'cf-touch-joy-base'
  const knob = document.createElement('div')
  knob.className = 'cf-touch-joy-knob'
  base.appendChild(knob)
  document.body.appendChild(base)

  const RADIUS = 44 // px the knob can travel from center
  let activePointerId = null
  let cx = 0, cy = 0

  function setKnob(x, z) { knob.style.transform = `translate(${x * RADIUS}px, ${z * RADIUS}px)` }

  function applyFromClient(clientX, clientY) {
    const dx = clientX - cx, dz = clientY - cy
    const d = Math.hypot(dx, dz)
    const k = d > RADIUS ? RADIUS / d : 1
    const nx = (dx * k) / RADIUS, nz = (dz * k) / RADIUS
    _joyX = nx; _joyZ = nz
    setKnob(nx, nz)
    _onMove(nx, nz)
  }

  function endDrag(e) {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    e.stopPropagation()
    activePointerId = null
    _joyActive = false; _joyX = 0; _joyZ = 0
    knob.classList.remove('dragging')
    setKnob(0, 0)
    _onMove(0, 0)
  }

  base.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation()
    const r = base.getBoundingClientRect()
    cx = r.left + r.width / 2; cy = r.top + r.height / 2
    activePointerId = e.pointerId
    _joyActive = true
    knob.classList.add('dragging')
    if (base.setPointerCapture) { try { base.setPointerCapture(e.pointerId) } catch {} }
    applyFromClient(e.clientX, e.clientY)
  })
  base.addEventListener('pointermove', e => {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    e.preventDefault(); e.stopPropagation()
    applyFromClient(e.clientX, e.clientY)
  })
  base.addEventListener('pointerup', endDrag)
  base.addEventListener('pointercancel', endDrag)

  // --- hop / pet / wave buttons ----------------------------------------
  const btns = document.createElement('div')
  btns.className = 'cf-touch-btns'
  const mk = (glyph, label, cb) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('aria-label', label)
    b.className = 'cf-touch-btn'
    b.textContent = glyph
    let downId = null
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation()
      downId = e.pointerId
      b.classList.add('active')
      if (typeof cb === 'function') cb()
    })
    b.addEventListener('click', e => { if (e.detail === 0 && typeof cb === 'function') cb() })
    const clear = e => { if (downId !== null && e.pointerId === downId) downId = null; e.stopPropagation(); b.classList.remove('active') }
    b.addEventListener('pointerup', clear)
    b.addEventListener('pointercancel', clear)
    b.addEventListener('pointerleave', clear)
    btns.appendChild(b)
    return b
  }
  mk('\u{1F44B}', 'Wave', onWave)
  mk('❤️', 'Pet', onPet)
  mk('\u{1F43E}', 'Hop', onHop)
  document.body.appendChild(btns)
}

// Call every frame (after player.js's updateMovement, same slot as
// moves.js's updateMoves) so a held-but-motionless joystick keeps
// re-asserting its vector every tick instead of only on drag events.
export function update(_dt) {
  if (_joyActive) _onMove(_joyX, _joyZ)
}
