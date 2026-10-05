// Dedicated cron credential, never a device/user token or service-role key.
export function schedulerAuthorized(request: Request,expected: string): boolean {
  if(!expected||expected.length<16) return false;
  const actual=request.headers.get("x-scheduler-secret")??"";
  if(actual.length!==expected.length) return false;
  let mismatch=0;for(let i=0;i<expected.length;i++) mismatch|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return mismatch===0;
}
