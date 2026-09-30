// Shared SDF atlas and instanced glyph quads. Canvas is used only when a new
// glyph enters the atlas; labels and UI never become whole-text textures.
const CELL = 80, EM = 48, PAD = 12, BASE = 59, EDGE = 8, ATLAS = 2048, COLS = 25
const scratch = document.createElement('canvas'); scratch.width = scratch.height = CELL
const ink = scratch.getContext('2d', { willReadFrequently: true })
const bytes = new Uint8Array(ATLAS * ATLAS), glyphs = new Map()
let revision = 0
export const glyphAtlas = { bytes, size: ATLAS, cell: CELL, em: EM, pad: PAD, baseline: BASE,
  get revision() { return revision }, get count() { return glyphs.size } }
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export const graphemes = text => [...segments.segment(String(text))].map(s => s.segment)

// Exact squared Euclidean distance transform, separable into two 1D passes.
function distance(mask, inside) {
  const n = CELL, grid = new Float64Array(n*n), row = new Float64Array(n)
  const out = new Float64Array(n), sites = new Int32Array(n), cuts = new Float64Array(n+1)
  for (let i=0;i<grid.length;i++) grid[i] = (mask[i] >= 128) === inside ? 0 : 1e12
  const edt = () => {
    let k=0; sites[0]=0; cuts[0]=-Infinity; cuts[1]=Infinity
    for(let q=1;q<n;q++) {
      let s
      do { const p=sites[k]; s=((row[q]+q*q)-(row[p]+p*p))/(2*(q-p)); if(s<=cuts[k]) k--; else break } while(k>=0)
      k++; sites[k]=q; cuts[k]=s; cuts[k+1]=Infinity
    }
    k=0
    for(let q=0;q<n;q++) { while(cuts[k+1]<q) k++; const d=q-sites[k]; out[q]=d*d+row[sites[k]] }
  }
  for(let y=0;y<n;y++) { for(let x=0;x<n;x++) row[x]=grid[y*n+x]; edt(); for(let x=0;x<n;x++) grid[y*n+x]=out[x] }
  for(let x=0;x<n;x++) { for(let y=0;y<n;y++) row[y]=grid[y*n+x]; edt(); for(let y=0;y<n;y++) grid[y*n+x]=out[y] }
  return grid
}
export function glyph(char, bold=false) {
  const key=(bold?'b:':'r:')+char
  if(glyphs.has(key)) return glyphs.get(key)
  // A bounded atlas keeps peer-supplied Unicode from growing GPU memory forever.
  if(glyphs.size>=COLS*COLS-1) return glyph('\uFFFD',bold)
  ink.clearRect(0,0,CELL,CELL); ink.font=`${bold?700:500} ${EM}px Campfire, sans-serif`
  ink.fillStyle='white'; ink.textBaseline='alphabetic'; ink.fillText(char,PAD,BASE)
  const metrics=ink.measureText(char), image=ink.getImageData(0,0,CELL,CELL).data
  const mask=new Uint8Array(CELL*CELL)
  for(let i=0;i<mask.length;i++) mask[i]=image[i*4+3]
  const inner=distance(mask,true), outer=distance(mask,false)
  const index=glyphs.size, x=(index%COLS)*CELL, y=Math.floor(index/COLS)*CELL
  for(let j=0;j<CELL;j++) for(let i=0;i<CELL;i++) {
    const p=j*CELL+i, d=Math.sqrt(outer[p])-Math.sqrt(inner[p])+(mask[p]/255-.5)
    bytes[(y+j)*ATLAS+x+i]=Math.max(0,Math.min(255,Math.round(128+d*127/EDGE)))
  }
  const g={ uv:[x/ATLAS,y/ATLAS,CELL/ATLAS,CELL/ATLAS], advance:metrics.width/EM,
    ascent:(metrics.fontBoundingBoxAscent || 48)/EM, descent:(metrics.fontBoundingBoxDescent || 13)/EM }
  glyphs.set(key,g); revision++; return g
}
export async function loadGlyphFont() {
  await document.fonts.load('500 16px Campfire')
  await document.fonts.load('700 16px Campfire')
  glyph('\uFFFD'); glyph('\uFFFD',true)
  for(const ch of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!? /()-+\u00b7\u2026\u2197\u21b5') { glyph(ch); glyph(ch,true) }
}
export const measure = (text,size,bold=false) => graphemes(text).reduce((s,c)=>s+glyph(c,bold).advance*size,0)
export function wrap(text,size,maxWidth,bold=false) {
  const lines=[]; let line=''
  for(const word of String(text).split(/\s+/u)) {
    const next=line?line+' '+word:word
    if(measure(next,size,bold)<=maxWidth) { line=next; continue }
    if(line) { lines.push(line); line='' }
    for(const ch of graphemes(word)) {
      if(line && measure(line+ch,size,bold)>maxWidth) { lines.push(line); line='' }
      line+=ch
    }
  }
  if(line) lines.push(line)
  return lines.length?lines:['']
}
