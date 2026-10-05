// Pure queue operations. Only the background worker writes this storage key.
export function enqueue(snapshot={},action,payload,now=Date.now()) {
  const q={version:snapshot.version||0,items:[...(snapshot.items||[])]};
  const logical=action==='sync'?'sync':action==='event'?`event:${payload.occurrenceKey}:${payload.status}`:`${action}:${payload.sessionId}`;
  if(action!=='sync'&&q.items.some(item=>item.logical===logical)) return q;
  if(action==='sync') {
    q.version=Math.max(q.version+1,now);
    q.items=q.items.filter(item=>item.action!=='sync');payload={...payload,version:q.version};
  }
  q.items.push({id:crypto.randomUUID(),logical,action,payload,attempts:0,availableAt:now});
  return q;
}
export const acknowledge=(q,id)=>({...q,items:(q.items||[]).filter(item=>item.id!==id),lastSuccessAt:new Date().toISOString()});
export function fail(q,id,error,now=Date.now()) {
  return {...q,items:(q.items||[]).map(item=>item.id!==id?item:{...item,attempts:item.attempts+1,lastError:String(error).slice(0,300),availableAt:now+Math.min(3600000,15000*2**Math.min(item.attempts,8))})};
}
export const nextReady=(q,now=Date.now())=>(q.items||[]).find(item=>item.availableAt<=now);
