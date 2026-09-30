import { getSettings, setPreference } from './preferences.js'
import { applyAudioSettings } from './audio.js'
import { applyWorldSettings } from './world/scene.js'
import { togglePanel, closeDrawer } from './drawer.js'
export function initSettings() {
  const button=document.getElementById('settings-button'),panel=document.getElementById('settings-panel')
  const apply=()=>{
    const s=getSettings();applyAudioSettings();applyWorldSettings(s)
    document.body.dataset.names=s.names?'on':'off'
    for(const key of Object.keys(s)) {
      const input=document.getElementById('setting-'+key)
      if(input.type==='checkbox')input.checked=s[key];else input.value=s[key]
      const output=document.getElementById('setting-'+key+'-value')
      if(output)output.textContent=Math.round(s[key]*100)+'%'
    }
  }
  button.addEventListener('click',()=>togglePanel('settings-panel'))
  document.getElementById('settings-close').addEventListener('click',closeDrawer)
  panel.addEventListener('input',e=>{
    const key=e.target.id.replace('setting-','')
    setPreference(key,e.target.type==='checkbox'?e.target.checked:e.target.value);apply()
  })
  panel.addEventListener('change',e=>{if(e.target.tagName==='SELECT'){setPreference('quality',e.target.value);apply()}})
  window.campfire.settings={snapshot:getSettings}
  apply()
}
