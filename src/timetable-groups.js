const validGroups=new Set(['all','1','2','3']);

export function normalizeTimetableGroup(value) {
  const group=String(value??'all');
  return validGroups.has(group)?group:'all';
}

function labSession(row) {
  return /^(?:lab|laboratory)$/i.test(String(row?.type||'').trim())||/(?:^|[-\s])lab(?:oratory)?(?:$|\s)/i.test(String(row?.course||''));
}

function detectedGroup(row) {
  const explicit=String(row?.group||'').match(/^(?:group\s*)?([123])$/i)?.[1];
  if(explicit) return explicit;
  return String(row?.course||'').match(/\bgroup\s*([123])\b/i)?.[1]||'';
}

export function filterOtherLabGroups(rows,selectedGroup='all') {
  const group=normalizeTimetableGroup(selectedGroup);
  if(group==='all') return rows;
  return rows.filter(row=>{
    if(!labSession(row)) return true;
    const detected=detectedGroup(row);
    return !detected||detected===group;
  });
}
