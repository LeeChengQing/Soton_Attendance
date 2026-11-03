export function sameProfile(saved,current) {
  if(!saved||!current) return false;
  return ['student','name','studentType','group'].every(key=>{
    const value=profile=>String(profile[key]??(key==='studentType'?'local':key==='group'?'all':'')).trim();
    return value(saved)===value(current);
  });
}
