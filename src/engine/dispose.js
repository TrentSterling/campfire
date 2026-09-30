// Procedural gear/tackle own their resources. Shared meshes within a group
// (board nose/tail and fish fins) are disposed once.
export function disposeObject(root) {
  if(!root)return
  root.removeFromParent()
  const geometry=new Set(),materials=new Set()
  root.traverse(o=>{
    if(o.geometry)geometry.add(o.geometry)
    if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)
  })
  geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())
}
