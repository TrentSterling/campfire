import { state } from './state.js'
import { setAmbienceMuted } from './audio.js'
import { initDrawer, togglePanel } from './drawer.js'

export function refreshHint() {
  document.querySelector('.hint').textContent = 'WASD to wander · Space to hop · Enter to chat · H for controls'
}

export function initUI() {
  initDrawer()
  addEventListener('contextmenu',event=>event.preventDefault())
  const chat=document.getElementById('chatlog'),chatPanel=chat.closest('.chat-panel'),chatToggle=document.getElementById('chat-toggle')
  document.querySelector('.social-dock').prepend(chatPanel)
  let collapsed=true,unread=0
  function chatView() {
    chat.hidden=collapsed;chatPanel.dataset.collapsed=String(collapsed)
    chatToggle.setAttribute('aria-expanded',String(!collapsed))
    chatToggle.textContent=collapsed?'Show chat'+(unread?' ('+unread+')':''):'Hide chat'
  }
  chatToggle.addEventListener('click',()=>{collapsed=!collapsed;if(!collapsed)unread=0;chatView()})
  new MutationObserver(()=>{if(collapsed){unread=Math.min(6,chat.querySelectorAll('.chat-line').length);chatView()}}).observe(chat,{childList:true})
  chatView()
  const room = new URLSearchParams(location.search).get('room') || 'main'
  document.getElementById('room').textContent = room === 'main' ? 'The shared fire' : room
  const help = document.getElementById('help-button'), panel = document.getElementById('controls-panel')
  help.addEventListener('click', () => togglePanel('controls-panel'))
  addEventListener('keydown', e => {
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && (e.code==='KeyH' || e.key==='?')) {
      e.preventDefault();help.click()
    }
    if (e.key === 'Escape') { panel.hidden = true; help.setAttribute('aria-expanded', 'false') }
  })
  document.getElementById('sound-button').addEventListener('click', e => {
    const button = e.currentTarget
    const muted = button.getAttribute('aria-pressed') !== 'true'
    setAmbienceMuted(muted)
    button.setAttribute('aria-pressed', String(muted))
    button.setAttribute('aria-label', muted ? 'Unmute ambience' : 'Mute ambience')
    button.title = muted ? 'Unmute ambience' : 'Mute ambience'
  })
  let toastTimer
  document.getElementById('invite-button').addEventListener('click', async () => {
    const toast = document.getElementById('toast')
    try {
      await navigator.clipboard.writeText(location.href)
      toast.textContent = 'Link copied. There is room by the fire.'
    } catch { toast.textContent = 'Share this address: ' + location.href }
    toast.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.hidden = true }, 5000)
  })
  refreshHint()
  document.body.dataset.ready = 'true'
  for (const id of ['identity-tag', 'progress-chip']) {
    const el = document.getElementById(id)
    if (!el) continue
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); el.click() }
    })
  }
  document.getElementById('identity-tag')?.setAttribute('aria-label', 'Rename ' + state.myName)
}
