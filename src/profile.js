export function sameProfile(saved,current) {
  if(!saved||!current) return false;
  return ['student','name','studentType'].every(key=>{
    const value=profile=>String(profile[key]??(key==='studentType'?'local':'')).trim();
    return value(saved)===value(current);
  });
}
