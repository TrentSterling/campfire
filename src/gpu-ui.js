import * as THREE from 'three'
import { camera, CURVE } from './world/scene.js'
import { critters } from './state.js'
import { loadGlyphFont, glyph, graphemes, measure, wrap } from './engine/glyphs.js'
import { createGlyphLayer } from './engine/webgpu-glyphs.js'

const cache=new WeakMap(), point=new THREE.Vector3()
let layer, clock=0, dirty=true, runs=[], hudRects=[], labels=[],covers=[],ellipses=[]
const range=document.createRange(), canvas=document.createElement('canvas')
canvas.id='gpu-text'; canvas.setAttribute('aria-hidden','true')
const colors=new Map()
function color(css,opacity=1) {
  if(!colors.has(css)) {const c=new THREE.Color(css).convertLinearToSRGB();colors.set(css,[c.r,c.g,c.b])}
  return [...colors.get(css),opacity]
}
function visible(el) {
  if(!el || el.closest('[hidden],.sr-only,script,style,#app,#gpu-text,option'))return false
  const s=getComputedStyle(el), r=el.getBoundingClientRect()
  return s.display!=='none' && s.visibility!=='hidden' && r.width>1 && r.height>1 && r.bottom>0 && r.top<innerHeight
}
function clipping(el) {
  const clip=[0,0,innerWidth,innerHeight];let opacity=1
  for(let p=el;p && p!==document.documentElement;p=p.parentElement) {
    const s=getComputedStyle(p);opacity*=Number(s.opacity)
    if(/auto|scroll|hidden|clip/.test(s.overflowX+' '+s.overflowY)) {
      const r=p.getBoundingClientRect();clip[0]=Math.max(clip[0],r.left);clip[1]=Math.max(clip[1],r.top);clip[2]=Math.min(clip[2],r.right);clip[3]=Math.min(clip[3],r.bottom)
      if(s.textOverflow==='ellipsis' && p.scrollWidth>p.clientWidth)clip[2]=Math.min(clip[2],r.right-parseFloat(s.fontSize))
    }
  }
  return {clip,opacity}
}
function collectUI() {
  covers=[...document.querySelectorAll('#campfire-drawer,.hat-shop-actions,#toast')].filter(visible).slice(0,4)
  layer.covers(covers.map(el=>{const r=el.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]}))
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), next=[]
  ellipses=[]
  while(walker.nextNode()) {
    const node=walker.currentNode,el=node.parentElement
    if(!node.textContent.trim() || !visible(el) || el.closest('select,svg'))continue
    const s=getComputedStyle(el),r=el.getBoundingClientRect(),size=parseFloat(s.fontSize),bold=Number(s.fontWeight)>=600
    const {clip,opacity}=clipping(el),mask=coverMask(el)
    const signature=[node.textContent,r.x,r.y,r.width,r.height,size,bold,s.color,...clip,opacity,mask].join('|')
    let entry=cache.get(node)
    if(entry?.signature!==signature) {
      const letters=[];let offset=0
      for(const ch of graphemes(node.textContent)) {
        range.setStart(node,offset);range.setEnd(node,offset+ch.length);offset+=ch.length
        const rect=range.getBoundingClientRect(),g=glyph(ch,bold)
        if(!rect.width || /^\s+$/u.test(ch))continue
        const baseline=rect.y+(rect.height-(g.ascent+g.descent)*size)*.5+g.ascent*size
        letters.push({ch,x:rect.x,baseline,size,bold,color:color(s.color,opacity),clip,mask})
      }
      entry={signature,letters};cache.set(node,entry)
    }
    next.push(...entry.letters)
  }
  runs=next
  for(const el of document.querySelectorAll('#status,#room,#identity-tag')) {
    if(!visible(el) || el.scrollWidth<=el.clientWidth)continue
    const r=el.getBoundingClientRect(),s=getComputedStyle(el),size=parseFloat(s.fontSize),{opacity}=clipping(el)
    ellipses.push({x:r.right-size,baseline:r.y+r.height*.5+size*.34,size,color:color(s.color,opacity),mask:coverMask(el)})
  }
  hudRects=[...document.querySelectorAll('.hud,.room-tools,.activity-bar,.activity-status,.social-dock,#campfire-drawer,#toast,#identity-input,.cf-touch-joy-base,.cf-touch-btns')]
    .filter(visible).map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})
}
function coverMask(el) {
  const level=node=>{let z=0;for(let p=node;p;p=p.parentElement)z+=parseInt(getComputedStyle(p).zIndex)||0;return z}
  const z=level(el)
  return covers.reduce((mask,cover,i)=>mask+(!cover.contains(el) && level(cover)>z?2**i:0),0)
}
function nativeFields() {
  for(const el of document.querySelectorAll('input:not([type=range]):not([type=checkbox]), select')) {
    if(!visible(el))continue
    const r=el.getBoundingClientRect(),s=getComputedStyle(el),size=parseFloat(s.fontSize)
    const bold=Number(s.fontWeight)>=600, focused=el===document.activeElement,select=el.tagName==='SELECT'
    const text=select?el.selectedOptions[0]?.textContent || '':el.value || el.placeholder
    const start=r.x+parseFloat(s.paddingLeft)+1-(select?0:el.scrollLeft),clip=[r.x+3,r.y,r.right-4,r.bottom]
    const parentClip=clipping(el).clip
    clip[0]=Math.max(clip[0],parentClip[0]);clip[1]=Math.max(clip[1],parentClip[1]);clip[2]=Math.min(clip[2],parentClip[2]);clip[3]=Math.min(clip[3],parentClip[3])
    const g=glyph('M',bold),baseline=r.y+r.height*.5+(g.ascent-g.descent)*size*.5
    const inkColor=color(!select && !el.value?'#9dadab':s.color),mask=coverMask(el)
    if(focused && !select && el.selectionStart!==el.selectionEnd) {
      const left=measure(text.slice(0,el.selectionStart),size,bold),right=measure(text.slice(0,el.selectionEnd),size,bold)
      const x=Math.max(clip[0],start+left),end=Math.min(clip[2],start+right)
      if(end>x)layer.panel(x,r.y+4,end-x,r.height-8,2,[.35,.58,.53,.45],mask)
    }
    layer.text(text,start,baseline,size,inkColor,bold,clip,mask)
    if(focused && !select && performance.now()%1000<550 && el.selectionStart===el.selectionEnd) {
      const x=start+measure(el.value.slice(0,el.selectionStart),size,bold)
      if(x>=clip[0] && x<clip[2])layer.panel(x,r.y+5,1,r.height-10,0,[.94,.89,.78,1],mask)
    }
    if(select)layer.text('\u2304',r.right-17,baseline,13,color('#9dadab'),false,clip,mask)
  }
}
function overlaps(a,b,gap=5) {return a.x<b.x+b.w+gap && a.x+a.w+gap>b.x && a.y<b.y+b.h+gap && a.y+a.h+gap>b.y}
function project(pos) {
  point.copy(pos).applyMatrix4(camera.matrixWorldInverse)
  if(point.z>-.1)return null
  point.y-=CURVE*(point.x*point.x+point.z*point.z);point.applyMatrix4(camera.projectionMatrix)
  if(point.z>1 || point.z<-1)return null
  return {x:(point.x*.5+.5)*innerWidth,y:(.5-point.y*.5)*innerHeight}
}
function worldText() {
  labels=[];const occupied=[...hudRects],small=innerWidth<640
  const ordered=[...critters].filter(c=>c.tag || c.bubble?.visible).sort((a,b)=>
    Number(!!b.bubble?.visible)-Number(!!a.bubble?.visible) || Number(!!b.voiceSpeaking)-Number(!!a.voiceSpeaking) || camera.position.distanceTo(a.pos)-camera.position.distanceTo(b.pos))
  for(const c of ordered) {
    const speech=c.bubble?.visible,own=c.tag?.userData.own
    if(!speech && own && !c.voiceSpeaking)continue
    if(!speech && (!c.tag?.visible || camera.position.distanceTo(c.pos)>30 || document.body.dataset.names==='off'))continue
    const pos=project(speech?c.bubble.position:c.tag.position)
    if(!pos || pos.x<-100 || pos.x>innerWidth+100)continue
    const size=speech?13:(small?11:12),bold=!speech,raw=speech?c.bubble.userData.text:c.tag.userData.text
    const maxW=Math.min(speech?230:180,innerWidth*.6),lines=wrap(raw,size,maxW-24,bold)
    const title=!speech && !own?c.tag.userData.title:''
    const w=Math.max(50,...lines.map(l=>measure(l,size,bold)+24)),h=lines.length*18+16+(title?15:0)
    let box=null
    for(let shift=0;shift<=100;shift+=20) {
      const test={x:Math.max(8,Math.min(innerWidth-w-8,pos.x-w*.5)),y:pos.y-h-shift,w,h}
      if(test.y<8)continue
      if(!occupied.some(o=>overlaps(test,o))) {box=test;break}
    }
    if(!box)continue
    occupied.push(box);labels.push({...box,kind:speech?'speech':'name',text:raw,id:c.id,lines:lines.length})
    layer.panel(box.x,box.y,w,h,speech?12:8,speech?[.97,.93,.83,.98]:[.055,.12,.13,.86])
    const textColor=speech?[.13,.19,.18,1]:c.voiceSpeaking?[.66,.89,.7,1]:[.9,.91,.83,.95]
    lines.forEach((l,i)=>layer.text(l,box.x+(w-measure(l,size,bold))*.5,box.y+20+i*18,size,textColor,bold))
    if(title)layer.text(title,box.x+(w-measure(title,10))*.5,box.y+h-8,10,[.72,.68,.52,.9])
    if(c.voiceSpeaking)layer.panel(box.x+w-7,box.y+5,4,4,2,[.65,.95,.68,1])
  }
}
export async function initGPUText() {
  await loadGlyphFont()
  layer=await createGlyphLayer(canvas, message=>{
    document.body.dataset.gpuText='false';canvas.hidden=true
    window.__gpuText={backend:'webgpu-lost',message}
  })
  document.body.appendChild(canvas);document.body.dataset.gpuText='true'
  window.__readGlyphPixels=()=>layer.readPixels()
  new MutationObserver(()=>{dirty=true}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','style','class','aria-pressed']})
  for(const event of ['resize','scroll','input','change','focusin','focusout'])addEventListener(event,()=>{dirty=true},true)
  addEventListener('resize',()=>layer.resize(innerWidth,innerHeight))
}
export function renderGPUText(dt) {
  if(!layer || canvas.hidden)return
  clock+=dt
  if(dirty || clock>.15) {collectUI();dirty=false;clock=0}
  layer.begin(innerWidth,innerHeight);worldText()
  for(const l of runs)layer.letter(l.ch,l.x,l.baseline,l.size,l.color,l.bold,l.clip,l.mask)
  for(const l of ellipses)layer.letter('\u2026',l.x,l.baseline,l.size,l.color,false,undefined,l.mask)
  nativeFields()
  window.__gpuText={...layer.render(),mode:'instanced-sdf',uiGlyphs:runs.length,labels,font:'Nunito',canvasTexturesForText:0}
}
