import { overlapsBuilding } from './collision.js';
import { isDrivable } from '../config/roadConfig.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function projectSegment(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(len2||1)));
  return {x:a.x+dx*t,z:a.z+dz*t,t,distance:Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t)};
}
export function clearSegment(grid,a,b) {
  const n=Math.max(1,Math.ceil(distance(a,b)/.75));
  for(let i=0;i<=n;i++)if(overlapsBuilding(grid,a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n))return false;
  return true;
}
// OSM way points contain shared intersection coordinates. Subdivision provides
// precise snapping without joining overpasses or nearby unrelated streets.
export function buildRoadGraph(roads,buildingGrid) {
  const nodes=[],edges=[],keys=new Map(),cells=new Map();
  function node(p,layer) {
    const key=`${p.x.toFixed(2)},${p.z.toFixed(2)},${layer}`;
    if(!keys.has(key)){keys.set(key,nodes.length);nodes.push({id:nodes.length,x:p.x,z:p.z,edges:[],component:-1});}
    return keys.get(key);
  }
  for(const road of roads) {
    if(!isDrivable(road))continue;
    const layer=road.layer||0;
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i],n=Math.max(1,Math.ceil(distance(a,b)/8));
      for(let j=0;j<n;j++) {
        const from={x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n};
        const to={x:a.x+(b.x-a.x)*(j+1)/n,z:a.z+(b.z-a.z)*(j+1)/n};
        if(distance(from,to)<.01||!clearSegment(buildingGrid,from,to))continue;
        const u=node(from,layer),v=node(to,layer),length=distance(from,to);
        const oneWay=road.oneway??road.oneWay;
        const forward=oneWay!=='-1',backward=!(oneWay===true||oneWay==='yes'||oneWay==='1');
        const edge={id:edges.length,start:u,end:v,distance:length,width:road.width,type:road.type,forward,backward};edges.push(edge);
        if(forward)nodes[u].edges.push({to:v,cost:length,edge:edge.id});
        if(backward)nodes[v].edges.push({to:u,cost:length,edge:edge.id});
        for(let x=Math.floor(Math.min(from.x,to.x)/32);x<=Math.floor(Math.max(from.x,to.x)/32);x++)
          for(let z=Math.floor(Math.min(from.z,to.z)/32);z<=Math.floor(Math.max(from.z,to.z)/32);z++) {
            const k=`${x},${z}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(edge.id);
          }
      }
    }
  }
  // Weak components keep destination snapping on a connected road network.
  const adjacent=nodes.map(()=>[]);for(const e of edges){adjacent[e.start].push(e.end);adjacent[e.end].push(e.start);}
  let component=0;const sizes=[];
  for(const root of nodes){if(root.component!==-1)continue;const queue=[root.id];root.component=component;
    for(let i=0;i<queue.length;i++)for(const id of adjacent[queue[i]])if(nodes[id].component===-1){nodes[id].component=component;queue.push(id);}
    sizes.push(queue.length);component++;
  }
  return {nodes,edges,cells,sizes,mainComponent:sizes.indexOf(Math.max(...sizes))};
}
export function nearestEdge(graph,p,component=null,accept=null) {
  let best=null;
  const consider=id=>{const e=graph.edges[id],a=graph.nodes[e.start],b=graph.nodes[e.end];if(component!==null&&a.component!==component)return;
    const projection=projectSegment(p,a,b);if(accept&&!accept(projection,e))return;if(!best||projection.distance<best.distance)best={...projection,edge:e,component:a.component};};
  const cx=Math.floor(p.x/32),cz=Math.floor(p.z/32),seen=new Set();
  // Nearby indexed lookup; full scan only for distant/off-map queries.
  for(let x=cx-2;x<=cx+2;x++)for(let z=cz-2;z<=cz+2;z++)for(const id of graph.cells.get(`${x},${z}`)||[])if(!seen.has(id)){seen.add(id);consider(id);}
  if(!best||best.distance>32)for(const e of graph.edges)consider(e.id);
  return best;
}
class Heap {
  items=[];
  push(item){const a=this.items;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=item.f)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(last.f<=a[c].f)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}
export function aStar(graph,start,goal,blocked=new Set()) {
  const open=new Heap(),cost=new Map([[start,0]]),previous=new Map();
  open.push({id:start,f:distance(graph.nodes[start],graph.nodes[goal]),g:0});
  while(open.items.length){const current=open.pop();if(current.g!==cost.get(current.id))continue;
    if(current.id===goal){const path=[goal];while(path[0]!==start)path.unshift(previous.get(path[0]));return {ids:path,distance:current.g};}
    for(const e of graph.nodes[current.id].edges){if(blocked.has(e.edge))continue;const g=current.g+e.cost;
      if(g<(cost.get(e.to)??Infinity)){cost.set(e.to,g);previous.set(e.to,current.id);open.push({id:e.to,g,f:g+distance(graph.nodes[e.to],graph.nodes[goal])});}
    }
  }
  return null;
}
export function calculateRoute(graph,start,target,blocked=new Set(),targetFilter=null) {
  const s=nearestEdge(graph,start);if(!s)return null;
  const t=nearestEdge(graph,target,s.component,targetFilter);if(!t)return null;
  let best=null;
  const accept=(points,length,edgeIds)=>{if(!best||length<best.length){const filtered=points.filter((p,i)=>!i||distance(p,points[i-1])>.01);best={points:filtered,length,edgeIds,endpoint:{x:t.x,z:t.z},targetOffset:t.distance};}};
  if(s.edge.id===t.edge.id && ((t.t>=s.t&&s.edge.forward)||(t.t<=s.t&&s.edge.backward))&&!blocked.has(s.edge.id))accept([{x:s.x,z:s.z,width:s.edge.width},{x:t.x,z:t.z,width:t.edge.width}],Math.abs(t.t-s.t)*s.edge.distance,[s.edge.id]);
  const starts=[...(s.edge.backward?[s.edge.start]:[]),...(s.edge.forward?[s.edge.end]:[])];
  const ends=[...(t.edge.forward?[t.edge.start]:[]),...(t.edge.backward?[t.edge.end]:[])];
  // A virtual source/target combines the two legal entry and exit nodes in
  // one A* search. The old implementation repeated almost the same search
  // four times per destination change, reroute, and police replan.
  const open=new Heap(),cost=new Map(),previous=new Map(),goals=new Set(ends);
  for(const id of starts){const g=distance(s,graph.nodes[id]);if(g<(cost.get(id)??Infinity)){cost.set(id,g);open.push({id,g,f:g+distance(graph.nodes[id],t)});}}
  let winner=null,limit=best?.length??Infinity;
  while(open.items.length){
    const current=open.pop();if(current.g!==cost.get(current.id))continue;
    if(current.f>=limit)break;
    if(goals.has(current.id)){
      const total=current.g+distance(graph.nodes[current.id],t);
      if(total<limit){limit=total;winner=current.id;}
    }
    for(const e of graph.nodes[current.id].edges){
      if(blocked.has(e.edge))continue;
      const g=current.g+e.cost;
      if(g<(cost.get(e.to)??Infinity)){cost.set(e.to,g);previous.set(e.to,{id:current.id,edge:e.edge});open.push({id:e.to,g,f:g+distance(graph.nodes[e.to],t)});}
    }
  }
  if(winner!==null){
    const path=[winner],pathEdges=[];
    while(previous.has(path[0])){const p=previous.get(path[0]);path.unshift(p.id);pathEdges.unshift(p.edge);}
    const points=[{x:s.x,z:s.z,width:s.edge.width}],ids=[s.edge.id];
    for(let i=0;i<path.length;i++){
      const n=graph.nodes[path[i]],edge=i<pathEdges.length?graph.edges[pathEdges[i]]:t.edge;
      points.push({x:n.x,z:n.z,width:edge.width});ids.push(edge.id);
    }
    points.push({x:t.x,z:t.z,width:t.edge.width});accept(points,limit,ids);
  }
  return best;
}
export function routeProgress(points,position,lookahead=30) {
  if(!points?.length)return null;
  if(points.length===1)return {point:points[0],remaining:0,distance:distance(points[0],position),index:0};
  let best=null;
  for(let i=1;i<points.length;i++){const p=projectSegment(position,points[i-1],points[i]);if(!best||p.distance<best.distance)best={...p,index:i};}
  let remaining=distance(best,points[best.index]);for(let i=best.index+1;i<points.length;i++)remaining+=distance(points[i-1],points[i]);
  let point={x:best.x,z:best.z},left=lookahead;
  for(let i=best.index;i<points.length;i++){const len=distance(point,points[i]);if(len>=left){point={x:point.x+(points[i].x-point.x)*left/(len||1),z:point.z+(points[i].z-point.z)*left/(len||1)};left=0;break;}left-=len;point=points[i];}
  return {...best,point,remaining};
}
export function policeSpawn(graph,player,meters=185) {
  const snap=nearestEdge(graph,player);if(!snap)return null;
  // Traverse predecessor edges away from the player. Reversing this walk is a
  // valid pursuit path even when the source provides directed roads.
  const incoming=graph.nodes.map(()=>[]);for(const n of graph.nodes)for(const e of n.edges)incoming[e.to].push(n.id);
  const choices=[snap.edge.start,snap.edge.end].filter(id=>id===snap.edge.start?snap.edge.forward:snap.edge.backward);
  choices.sort((a,b)=>{const dot=id=>(graph.nodes[id].x-player.x)*Math.sin(player.yaw)+(graph.nodes[id].z-player.z)*Math.cos(player.yaw);return dot(a)-dot(b);});
  for(const first of choices){
    const path=[{x:snap.x,z:snap.z},graph.nodes[first]],seen=new Set([first]);let length=distance(path[0],path[1]),current=first;
    while(length<meters){
      const previous=path[path.length-2],at=graph.nodes[current];
      const options=incoming[current].filter(id=>!seen.has(id));if(!options.length)break;
      options.sort((a,b)=>{const score=id=>{const n=graph.nodes[id];const dx=distance(at,previous)<.1?-Math.sin(player.yaw):at.x-previous.x,dz=distance(at,previous)<.1?-Math.cos(player.yaw):at.z-previous.z;return (dx*(n.x-at.x)+dz*(n.z-at.z))/(distance(at,n)||1);};return score(b)-score(a);});
      const next=options[0];length+=distance(at,graph.nodes[next]);path.push(graph.nodes[next]);seen.add(next);current=next;
    }
    if(length<Math.min(150,meters))continue;
    let walked=0;for(let i=1;i<path.length;i++){const len=distance(path[i-1],path[i]);if(walked+len>=meters){const t=(meters-walked)/len,a=path[i-1],b=path[i];return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yaw:Math.atan2(a.x-b.x,a.z-b.z),distance:meters};}walked+=len;}
    const a=path.at(-1),b=path.at(-2);return {x:a.x,z:a.z,yaw:Math.atan2(b.x-a.x,b.z-a.z),distance:length};
  }
  return null;
}
