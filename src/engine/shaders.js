// src/engine/shaders.js : the SDF blend-shell shader suite (OG port). GLSL helpers
// (sdRC / fieldDist / fieldFull / fieldGrad), the two vertex shaders (WORLD-space
// for critters, LOCAL-space for props), body + outline fragment shaders, the
// shared uniforms, CRIT_MAXP, and buildCritterGeo (per-prim sphere shells).
import * as THREE from 'three'

// max prims per critter/prop; PRIM_COUNT define is CRIT_MAXP for EVERY material so
// all bodies (and all outlines) hit the same cached WebGL program
export const CRIT_MAXP = 40

export const sharedCritterUniforms = {
  uSunDir: { value: new THREE.Vector3(-0.4, 0.82, 0.3).normalize() },
  uFirePos: { value: new THREE.Vector3(0, 1.8, 0) },
  uFire: { value: 1.6 },
}

export const CRIT_HELPERS = `
float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba=b-a; float l2=dot(ba,ba);
  if(l2<1e-8) return length(p-a)-max(r1,r2);
  float rr_=r1-r2; float a2=l2-rr_*rr_; float il2=1.0/l2;
  vec3 pa=p-a; float y=dot(pa,ba); float z=y-l2;
  vec3 xv=pa*l2-ba*y; float x2=dot(xv,xv); float y2=y*y*l2; float z2=z*z*l2;
  float k=sign(rr_)*rr_*rr_*x2;
  if(sign(z)*a2*z2>k) return sqrt(x2+z2)*il2-r2;
  if(sign(y)*a2*y2<k) return sqrt(x2+y2)*il2-r1;
  return (sqrt(x2*a2*il2)+y*rr_)*il2-r1;
}
float fieldDist(vec3 p){
  float d=1e9;
  for(int i=0;i<PRIM_COUNT;i++){ if(i>=uCount) break; if(uPrimD[i].z>0.5) continue;
    float di=sdRC(p,uPrimA[i].xyz,uPrimB[i].xyz,uPrimA[i].w,uPrimB[i].w);
    float k=max(uPrimC[i].w,1e-4); float h=clamp(0.5+0.5*(di-d)/k,0.0,1.0);
    d=mix(di,d,h)-k*h*(1.0-h); }
  return d;
}
void fieldFull(vec3 p, out float dOut, out vec4 cgOut){
  float d=1e9; vec4 cg=vec4(1.0);
  for(int i=0;i<PRIM_COUNT;i++){ if(i>=uCount) break;
    float di=sdRC(p,uPrimA[i].xyz,uPrimB[i].xyz,uPrimA[i].w,uPrimB[i].w);
    float k=max(uPrimC[i].w,1e-4); float h=clamp(0.5+0.5*(di-d)/k,0.0,1.0);
    float dn=mix(di,d,h)-k*h*(1.0-h);
    cg=mix(vec4(uPrimC[i].rgb,uPrimD[i].x),cg,h);
    if(uPrimD[i].z<0.5) d=dn; }
  dOut=d; cgOut=cg;
}
vec3 fieldGrad(vec3 p){
  vec2 e=vec2(0.006,-0.006);
  return normalize(e.xyy*fieldDist(p+e.xyy)+e.yyx*fieldDist(p+e.yyx)+e.yxy*fieldDist(p+e.yxy)+e.xxx*fieldDist(p+e.xxx));
}`

// LOCAL-space variant (props): prims live in object space, modelMatrix applies
export const CRIT_VSH_LOCAL = `
attribute float aPrim;
uniform vec4 uPrimA[PRIM_COUNT]; uniform vec4 uPrimB[PRIM_COUNT];
uniform vec4 uPrimC[PRIM_COUNT]; uniform vec4 uPrimD[PRIM_COUNT];
uniform int uCount; uniform float uIso; uniform float uCurve;
varying vec3 vNormal; varying vec3 vWorldPos; varying vec4 vColGloss;
${CRIT_HELPERS}
void main(){
  int pi=int(aPrim+0.5); vec4 A=uPrimA[pi], B=uPrimB[pi];
  vec3 ba=B.xyz-A.xyz; float len=length(ba);
  vec3 yA=len>1e-5?ba/len:vec3(0.0,1.0,0.0);
  vec3 up2=abs(yA.y)>0.95?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0);
  vec3 xA=normalize(cross(up2,yA)); vec3 zA=cross(xA,yA);
  float tt=clamp(position.y*0.5+0.5,0.0,1.0); float rT=mix(A.w,B.w,tt);
  vec3 c=(A.xyz+B.xyz)*0.5;
  vec3 p=c+xA*(position.x*rT)+zA*(position.z*rT)+yA*(position.y*(len*0.5+rT));
  float iso=uIso>0.0001?min(uIso,rT*0.55):0.0;
  float maxStep=max(rT*1.5,0.12);
  vec3 g=fieldGrad(p); p-=g*clamp(fieldDist(p)-iso,-maxStep,maxStep);
  g=fieldGrad(p); p-=g*clamp(fieldDist(p)-iso,-maxStep,maxStep);
  float dF; vec4 cg; fieldFull(p,dF,cg); p-=g*clamp(dF-iso,-maxStep,maxStep);
  vec3 nF=fieldGrad(p);
  vec4 wp4=modelMatrix*vec4(p,1.0); vec3 wp=wp4.xyz;
  if(uIso>0.0001) wp+=normalize(wp-cameraPosition)*iso*2.5;
  vNormal=normalize(mat3(modelMatrix)*nF); vWorldPos=wp; vColGloss=cg;
  vec4 vp=viewMatrix*vec4(wp,1.0);
  vp.y-=uCurve*dot(vp.xz,vp.xz);
  gl_Position=projectionMatrix*vp;
}`

// WORLD-space variant (critters): OG VSH + Campfire curvature. The OG projects
// with projectionMatrix * viewMatrix * vec4(p,1.0) and NO modelMatrix; the group
// stays at identity. Curvature bends view-space y.
export const CRIT_VSH_WORLD = `
attribute float aPrim;
uniform vec4 uPrimA[PRIM_COUNT]; uniform vec4 uPrimB[PRIM_COUNT];
uniform vec4 uPrimC[PRIM_COUNT]; uniform vec4 uPrimD[PRIM_COUNT];
uniform int uCount; uniform float uIso; uniform float uCurve;
varying vec3 vNormal; varying vec3 vWorldPos; varying vec4 vColGloss;
${CRIT_HELPERS}
void main(){
  int pi=int(aPrim+0.5); vec4 A=uPrimA[pi], B=uPrimB[pi];
  vec3 ba=B.xyz-A.xyz; float len=length(ba);
  vec3 yA=len>1e-5?ba/len:vec3(0.0,1.0,0.0);
  vec3 up2=abs(yA.y)>0.95?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0);
  vec3 xA=normalize(cross(up2,yA)); vec3 zA=cross(xA,yA);
  float tt=clamp(position.y*0.5+0.5,0.0,1.0); float rT=mix(A.w,B.w,tt);
  vec3 c=(A.xyz+B.xyz)*0.5;
  vec3 p=c+xA*(position.x*rT)+zA*(position.z*rT)+yA*(position.y*(len*0.5+rT));
  // outline width: constant-ish in screen space, capped so thin parts get thin lines
  float distScale=clamp(length(cameraPosition-c)/9.0,0.35,2.5);
  float isoW=min(uIso*distScale,rT*0.55);
  float slideW=isoW;
  float d0=fieldDist(p);
  // concave blend valley detector: outline collapses to a hairline in smin valleys
  float dOwn=sdRC(p,A.xyz,B.xyz,A.w,B.w);
  float kOwn=max(uPrimC[pi].w,1e-4);
  float conc=smoothstep(0.55,1.15,(dOwn-d0)/(kOwn*0.25));
  if(uIso>0.0001) isoW*=(1.0-0.85*conc);
  // buried verts tuck just under the skin (kills creases + z-fighting in overlaps)
  float bury=smoothstep(0.12,0.50,(-d0)/max(rT,0.02));
  float buriedIso=(uIso>0.0001)?(-isoW*1.2):(-isoW*1.2-rT*0.06);
  if(uIso>0.0001&&uPrimD[pi].y>0.5){ bury=1.0; buriedIso=-rT*0.4-isoW*2.0; }
  if(uPrimD[pi].z>0.5){ bury=1.0; buriedIso=-rT*0.4-isoW*2.0; }
  float iso=mix(isoW,buriedIso,bury);
  // Newton projection, fresh gradient each step, clamped travel (no shrapnel spikes)
  float maxStep=max(rT*1.5,0.12);
  vec3 g=fieldGrad(p);
  p-=g*clamp(d0-iso,-maxStep,maxStep);
  g=fieldGrad(p);
  p-=g*clamp(fieldDist(p)-iso,-maxStep,maxStep);
  float dF; vec4 cg; fieldFull(p,dF,cg); p-=g*clamp(dF-iso,-maxStep,maxStep);
  vec3 nF=fieldGrad(p);
  if(uIso>0.0001){
    // slide the outline shell away from the camera along the view ray so interior
    // folds hide behind the body; buried and valley verts slide much further
    p+=normalize(p-cameraPosition)*slideW*(1.4+bury*60.0+conc*24.0);
  }
  vNormal=nF; vWorldPos=p; vColGloss=cg;
  vec4 vp=viewMatrix*vec4(p,1.0);
  vp.y-=uCurve*dot(vp.xz,vp.xz);
  gl_Position=projectionMatrix*vp;
}`

export const CRIT_FSH_BODY = `
uniform vec3 uSunDir; uniform vec3 uFirePos; uniform float uFire; uniform float uRim;
varying vec3 vNormal; varying vec3 vWorldPos; varying vec4 vColGloss;
void main(){
  vec3 N=normalize(vNormal); vec3 Vv=normalize(cameraPosition-vWorldPos);
  float nl=dot(N,uSunDir)*0.5+0.5;
  float band=0.5+0.28*smoothstep(0.40,0.50,nl)+0.22*smoothstep(0.68,0.80,nl);
  vec3 albedo=vColGloss.rgb; vec3 shadCol=albedo*vec3(0.40,0.56,0.61);
  vec3 col=mix(shadCol,albedo*1.02,band);
  vec3 toF=uFirePos-vWorldPos; float fdd=length(toF);
  float fl=max(dot(N,toF/max(fdd,1e-3)),0.0)*uFire/(1.0+0.07*fdd*fdd);
  col+=fl*vec3(.58,.29,.12)*(albedo*.65+.35);
  float fr=pow(1.0-max(dot(N,Vv),0.0),3.0); col+=fr*vec3(.09,.10,.12)*(0.3+0.5*nl);
  // warm campfire rim + faint fill, critters only (uRim=1; props leave it 0) so
  // creatures glow like toys near the fire while terrain keeps the night grade
  float rimF=pow(1.0-max(dot(N,Vv),0.0),2.2);
  col+=uRim*(rimF*vec3(.16,.10,.055)+.025*vec3(1.0,.72,.5));
  vec3 H=normalize(uSunDir+Vv); float spb=pow(max(dot(N,H),0.0),mix(20.0,80.0,vColGloss.a));
  col+=smoothstep(0.3,0.8,spb)*vColGloss.a*vec3(.24);
  float luma=dot(col,vec3(0.299,0.587,0.114)); col=mix(vec3(luma),col,0.92);
  col=pow(clamp(col,0.0,1.0),vec3(0.4545));
  gl_FragColor=vec4(col,1.0);
}`

export const CRIT_FSH_OUTLINE = `
uniform vec3 uOutlineTint;
varying vec3 vNormal; varying vec3 vWorldPos; varying vec4 vColGloss;
void main(){
  // A projected primitive can fold over inside a smooth union. Its triangle
  // winding is then unsuitable for an inverted hull, but the field normal
  // still identifies front-facing skin. Keep ink on the silhouette.
  if(dot(normalize(vNormal),normalize(cameraPosition-vWorldPos))>0.12) discard;
  vec3 col=mix(vColGloss.rgb,uOutlineTint,0.68)*0.34;
  col=pow(clamp(col,0.0,1.0),vec3(0.4545)); gl_FragColor=vec4(col,1.0);
}`

// non-indexed per-prim sphere shells sized by max radius (props path)
export function buildCritterGeo(prims) {
  const posChunks = [], apChunks = []
  prims.forEach((pr, i) => {
    if (pr.colorOnly) return
    const r = Math.max(pr.r1, pr.r2)
    let w, h
    if (r >= 0.3) { w = 28; h = 20 } else if (r >= 0.14) { w = 18; h = 14 } else if (r >= 0.06) { w = 13; h = 10 } else { w = 9; h = 8 }
    let gg = new THREE.SphereGeometry(1, w, h); gg.deleteAttribute('normal'); gg.deleteAttribute('uv'); gg = gg.toNonIndexed()
    posChunks.push(gg.attributes.position.array)
    apChunks.push(new Float32Array(gg.attributes.position.count).fill(i)); gg.dispose()
  })
  let total = 0; posChunks.forEach(a => total += a.length / 3)
  const positions = new Float32Array(total * 3), aprim = new Float32Array(total)
  let po = 0, ao = 0
  for (let k = 0; k < posChunks.length; k++) { positions.set(posChunks[k], po); po += posChunks[k].length; aprim.set(apChunks[k], ao); ao += apChunks[k].length }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aPrim', new THREE.BufferAttribute(aprim, 1))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 4)
  return geo
}
