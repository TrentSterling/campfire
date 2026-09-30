import * as THREE from 'three'
import { curve } from './scene.js'

const maps = new Map()
export function woodTexture(kind = 'bark') {
  if (maps.has(kind)) return maps.get(kind)
  const c=document.createElement('canvas');c.width=256;c.height=512
  const g=c.getContext('2d'),bark=kind==='bark'
  g.fillStyle=bark?'#79634b':'#b39b74';g.fillRect(0,0,c.width,c.height)
  g.lineCap='round'
  for(let i=0;i<26;i++) {
    const x=i*11-10
    g.strokeStyle=bark?(i%3?'#65523f':'#927658'):(i%3?'#a28a66':'#c1a980')
    g.lineWidth=bark?2+(i%4)*1.5:1+(i%3)*.8
    g.beginPath();g.moveTo(x,-5)
    g.bezierCurveTo(x+Math.sin(i)*12,160,x+Math.cos(i*1.4)*9,330,x+Math.sin(i*2)*6,520);g.stroke()
  }
  for(const [x,y] of [[56,132],[179,371]]) {
    g.strokeStyle=bark?'#584838':'#937858';g.lineWidth=2
    for(const r of [5,10,17]) {g.beginPath();g.ellipse(x,y,r*.55,r*2.5,.12,0,Math.PI*2);g.stroke()}
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace
  t.wrapS=t.wrapT=THREE.RepeatWrapping;maps.set(kind,t);return t
}
export function woodMaterial(color = 0xffffff, bark = true) {
  const m=new THREE.MeshStandardMaterial({color,map:woodTexture(bark?'bark':'cut'),roughness:1})
  curve(m);return m
}
export function branchGeometry(radiusTop, radiusBase, height, segments = 12) {
  const geo=new THREE.CylinderGeometry(radiusTop,radiusBase,height,segments,5)
  const p=geo.attributes.position
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x)
    const wobble=1+.04*Math.sin(a*5+y*2)+.025*Math.cos(a*3-y*3)
    p.setXYZ(i,x*wobble+Math.sin(y*2)*radiusBase*.08,y,z*wobble)
  }
  geo.computeVertexNormals();return geo
}
