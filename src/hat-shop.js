import { state } from './state.js'
import { HAT_NAMES, nearRack, previewHat, setHat } from './critter/gear.js'
import { hatQuote, purchaseHat } from './progress.js'
import { saveIdentity } from './identity.js'
import { playChirp } from './audio.js'
import { showPanel, closeDrawer } from './drawer.js'

let panel,selected=0
export function openHatShop() {
  if(!panel||!nearRack(state.me))return
  showPanel('hat-shop')
  selected=state.me.hatId>=0?state.me.hatId:0
  previewHat(state.me,selected);refresh()
}
export function closeHatShop() {
  if(!panel||panel.hidden)return
  closeDrawer()
}
function refresh() {
  const q=hatQuote(selected),wearing=state.me.hatId===selected
  panel.querySelector('#hat-shop-balance').textContent=q.shells+' shells'
  panel.querySelector('#hat-shop-name').textContent=HAT_NAMES[selected]
  panel.querySelector('#hat-shop-hint').textContent=q.owned?'Yours to wear whenever you like.':q.affordable?'Try it on. Buy when it feels right.':`Fish to earn ${q.price-q.shells} more shells.`
  const apply=panel.querySelector('#hat-shop-apply')
  apply.textContent=wearing?'Wearing':q.owned?'Wear this hat':`Buy and wear · ${q.price} shells`
  apply.disabled=wearing||!q.affordable
  for(const b of panel.querySelectorAll('[data-hat]')) {
    const id=+b.dataset.hat,quote=hatQuote(id)
    b.setAttribute('aria-pressed',String(id===selected))
    b.querySelector('small').textContent=quote.owned?'Owned':quote.price+' shells'
  }
}
export function initHatShop() {
  panel=document.getElementById('hat-shop')
  const actions=document.createElement('div');actions.className='hat-shop-actions'
  for(const el of [panel.querySelector('.hat-shop-selection'),...['hat-shop-hint','hat-shop-apply','hat-shop-bare'].map(id=>document.getElementById(id))])actions.append(el)
  panel.append(actions)
  const choices=panel.querySelector('.hat-choices')
  HAT_NAMES.forEach((name,id)=>{
    const b=document.createElement('button');b.type='button';b.dataset.hat=id
    const image=document.createElement('img');image.src='./assets/hats/hat-'+id+'.png';image.width=800;image.height=600;image.alt=name;image.draggable=false
    const label=document.createElement('span');label.textContent=name
    const price=document.createElement('small');b.append(image,label,price);choices.append(b)
    b.addEventListener('click',()=>{selected=id;previewHat(state.me,id);refresh()})
  })
  panel.querySelector('#hat-shop-close').addEventListener('click',closeHatShop)
  panel.querySelector('#hat-shop-apply').addEventListener('click',()=>{
    if(!nearRack(state.me)||!purchaseHat(selected))return
    setHat(state.me,selected);saveIdentity(state.mySeed,state.myName,selected);playChirp('pet');refresh()
  })
  panel.querySelector('#hat-shop-bare').addEventListener('click',()=>{
    setHat(state.me,-1);saveIdentity(state.mySeed,state.myName,-1);closeHatShop()
  })
  document.addEventListener('campfire:panel-close',e=>{if(e.detail==='hat-shop')previewHat(state.me,null)})
  document.addEventListener('campfire:open-hats',()=>{if(nearRack(state.me))openHatShop();else {closeDrawer();document.getElementById('activity-hats').click()}})
  window.__hatShop=()=>({open:!panel.hidden,selected,preview:state.me.hatPreviewId,committed:state.me.hatId,quote:hatQuote(selected)})
}
export function updateHatShop() {if(panel&&!panel.hidden&&!nearRack(state.me))closeHatShop()}
