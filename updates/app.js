import { review } from './data.js'

const $=selector=>document.querySelector(selector)
const categoryNames={hats:'Hats',critters:'Creatures',world:'Campsite',fish:'Fish',equipment:'Equipment',flora:'Flora'}
let category='hats',model=review.models.find(m=>m.id==='hat-2'),angle='front'
const range=$('#comparison-range'),compare=$('#compare')
function setDivider(){compare.style.setProperty('--compare',range.value+'%')}
range.addEventListener('input',setDivider)
setDivider()

for(const [id,label] of Object.entries(categoryNames)){
  const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.category=id
  button.addEventListener('click',()=>{category=id;model=review.models.filter(m=>m.category===category).sort((a,b)=>a.rank-b.rank)[0];renderList();renderModel()})
  $('.category-bar').append(button)
}
function renderList(){
  $('.category-bar').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)))
  $('#category-name').textContent=categoryNames[category]
  const models=review.models.filter(m=>m.category===category).sort((a,b)=>a.rank-b.rank||a.id.localeCompare(b.id))
  $('#model-count').textContent=models.length+' variants'
  $('#model-list').replaceChildren()
  for(const m of models){
    const button=document.createElement('button');button.type='button';button.dataset.model=m.id;button.setAttribute('aria-pressed',String(m.id===model.id))
    const label=document.createElement('span');label.textContent=m.name
    if(m.seed){const seed=document.createElement('span');seed.className='seed';seed.textContent='Seed '+m.seed;label.append(seed)}
    const score=document.createElement('span');score.className='list-score';score.textContent=m.score.toFixed(1)
    button.append(label,score);button.addEventListener('click',()=>{model=m;renderList();renderModel()});$('#model-list').append(button)
  }
}
function renderModel(){
  const before=model.before[angle],after=model.after[angle]
  $('#model-name').textContent=model.name+(model.seed?' / '+model.seed:'')
  $('#model-score').textContent=model.score.toFixed(1)
  $('#model-rank').textContent='Visual pick #'+model.rank+' in '+categoryNames[category].toLowerCase()
  $('#model-note').textContent=model.note
  $('#image-error').hidden=true
  $('#before-image').hidden=!before
  if(before)$('#before-image').src='updates/media/'+before
  $('#after-image').src='updates/media/'+after
  $('#before-image').alt=model.name+', '+angle+' view before the polish'
  $('#after-image').alt=model.name+', '+angle+' view after the polish'
  $('#full-model').href='updates/media/'+after
  compare.classList.toggle('single',!before)
  range.disabled=!before
  $('#compare-hint').textContent=before?'Drag to compare · Arrow keys work too':'New review asset; no baseline capture'
  $('.angles').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.angle===angle)))
  window.__campfireReview={category,model:model.id,angle,hasBaseline:!!before,variants:review.models.length}
}
for(const b of $('.angles').querySelectorAll('button'))b.addEventListener('click',()=>{angle=b.dataset.angle;renderModel()})
for(const image of [$('#before-image'),$('#after-image')])image.addEventListener('error',()=>{$('#image-error').textContent='This capture could not load. Choose another model or reload the page.';$('#image-error').hidden=false})

function renderHats(){
  const family=$('#hat-family').value
  $('#hat-gallery').replaceChildren()
  for(let id=0;id<8;id++){
    const m=review.models.find(m=>m.id==='hat-'+id),button=document.createElement('button');button.type='button';button.className='hat-card';button.dataset.hat=id
    button.setAttribute('aria-label','Inspect '+m.name+'; shown on '+family)
    const holder=document.createElement('div');holder.className='hat-image'
    const image=document.createElement('img');image.src='updates/media/'+review.attachments[family][id];image.alt=family+' wearing the '+m.name;image.width=800;image.height=600;image.loading='lazy';holder.append(image)
    const caption=document.createElement('p'),label=document.createElement('span'),score=document.createElement('span');label.textContent=m.name;score.className='hat-price';score.textContent=m.score.toFixed(1)+' / 10';caption.append(label,score)
    button.append(holder,caption);button.addEventListener('click',()=>{category='hats';model=m;renderList();renderModel();$('#models').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})})
    $('#hat-gallery').append(button)
  }
}
$('#hat-family').addEventListener('change',renderHats)
renderList();renderModel();renderHats()
$('#rtp-packets').textContent=review.voice.packets.toLocaleString()
$('#rtp-bytes').textContent=review.voice.bytes.toLocaleString()
$('#receipt-status').textContent='Recorded on 30 September 2026 · '+review.models.length+' model variants · Nine captured test receipts passed · '+review.errors+' recorded application errors'

const observer=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){$('.masthead nav').querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.hash==='#'+entry.target.id))}
},{rootMargin:'-15% 0px -55% 0px'})
for(const section of document.querySelectorAll('main>section[id]'))observer.observe(section)
