// The rendered benches and posts supply their collision footprints here.
export const obstacles = []
export const addObstacle = (ax,az,bx,bz,r,height=.7) => obstacles.push({ax,az,bx,bz,r,height})
export function obstacleDistance(p,o) {
  const dx=o.bx-o.ax,dz=o.bz-o.az,k=Math.max(0,Math.min(1,((p.x-o.ax)*dx+(p.z-o.az)*dz)/(dx*dx+dz*dz||1)))
  const x=o.ax+dx*k,z=o.az+dz*k
  return {x,z,d:Math.hypot(p.x-x,p.z-z)}
}
export function resolveObstacles(p,r,air=0) {
  for(let pass=0;pass<2;pass++)for(const o of obstacles) {
    if(air>o.height+.05)continue
    const hit=obstacleDistance(p,o),limit=o.r+r
    if(hit.d>=limit)continue
    let dx=p.x-hit.x,dz=p.z-hit.z
    if(hit.d<1e-5){dx=o.bz-o.az||1;dz=-(o.bx-o.ax);const l=Math.hypot(dx,dz);dx/=l;dz/=l}
    else{dx/=hit.d;dz/=hit.d}
    p.x=hit.x+dx*(limit+.002);p.z=hit.z+dz*(limit+.002)
  }
}
export const walkable=(p,r=.25)=>Math.hypot(p.x,p.z)<=16.45&&Math.hypot(p.x,p.z)>2.35+r&&obstacles.every(o=>obstacleDistance(p,o).d>o.r+r+.06)
export function nearestWalkable(p,r=.25) {
  const d=Math.hypot(p.x,p.z),center=d>16.4?{x:p.x/d*16.4,z:p.z/d*16.4}:{x:p.x,z:p.z}
  if(walkable(center,r))return center
  for(let radius=.12;radius<5;radius+=.12)for(let i=0;i<48;i++) {
    const a=i*Math.PI/24,q={x:center.x+Math.cos(a)*radius,z:center.z+Math.sin(a)*radius}
    if(walkable(q,r))return q
  }
  return null
}
export function segmentFree(a,b,r) {
  const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.18)
  for(let i=1;i<=n;i++)if(!walkable({x:a.x+(b.x-a.x)*i/n,z:a.z+(b.z-a.z)*i/n},r))return false
  return true
}
export function walkPath(start,end,r=.25) {
  end=nearestWalkable(end,r)
  if(!end)return null
  if(segmentFree(start,end,r))return [end]
  const origin=nearestWalkable(start,r)
  if(!origin)return null
  return searchPath(start,origin,end,r,.4) || searchPath(start,origin,end,r,.22)
}
function searchPath(start,origin,end,r,step) {
  const key=(x,z)=>x+','+z,toPoint=n=>({x:origin.x+n.x*step,z:origin.z+n.z*step})
  const first={x:0,z:0,g:0,parent:null}
  const goal={x:Math.round((end.x-origin.x)/step),z:Math.round((end.z-origin.z)/step)}, open=[first],best=new Map([[key(first.x,first.z),0]])
  let found=null
  for(let iteration=0;open.length&&iteration<30000;iteration++) {
    open.sort((a,b)=>(a.g+Math.hypot(a.x-goal.x,a.z-goal.z))-(b.g+Math.hypot(b.x-goal.x,b.z-goal.z)))
    const n=open.shift(),p=toPoint(n)
    if(Math.hypot(p.x-end.x,p.z-end.z)<.85&&segmentFree(p,end,r)){found=n;break}
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const next={x:n.x+dx,z:n.z+dz,g:n.g+Math.hypot(dx,dz),parent:n},k=key(next.x,next.z),q=toPoint(next)
      if(next.g>=(best.get(k)??Infinity)||!segmentFree(p,q,r))continue
      best.set(k,next.g);open.push(next)
    }
  }
  if(!found)return null
  const raw=[end]
  for(let n=found;n.parent;n=n.parent)raw.unshift(toPoint(n))
  const path=[];let from=start
  while(raw.length) {
    let index=0
    for(let i=raw.length-1;i>=0;i--)if(segmentFree(from,raw[i],r)){index=i;break}
    from=raw[index];path.push(from);raw.splice(0,index+1)
  }
  return path
}
