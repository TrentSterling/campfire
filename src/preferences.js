const defaults={ambience:.35,effects:.7,voice:1,quality:'high',particles:true,names:true}
let stored={}
try {stored=JSON.parse(localStorage.getItem('campfire-settings')) || {}}catch{}
const prefs={...defaults}
for(const key of ['ambience','effects','voice'])if(Number.isFinite(stored[key]))prefs[key]=Math.max(0,Math.min(1,stored[key]))
if(stored.quality==='low')prefs.quality='low'
for(const key of ['particles','names'])if(typeof stored[key]==='boolean')prefs[key]=stored[key]
export const getSettings=()=>({...prefs})
export function setPreference(key,value) {
  if(!(key in defaults))return
  if(typeof defaults[key]==='number')value=Math.max(0,Math.min(1,Number(value) || 0))
  else if(typeof defaults[key]==='boolean')value=!!value
  else if(!['high','low'].includes(value))return
  prefs[key]=value
  try {localStorage.setItem('campfire-settings',JSON.stringify(prefs))}catch{}
}
