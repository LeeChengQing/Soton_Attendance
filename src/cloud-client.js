// Settings delegates device initialization to the one background context.
async function request(action,payload={}) {
  const result=await chrome.runtime.sendMessage({type:'CLOUD_REQUEST',action,...payload});
  if(result?.error) {const error=Error(result.error);error.code=result.error;error.retryAfterSeconds=result.retryAfterSeconds;throw error;}
  return result;
}
export const ensureCloudDevice=()=>request('device');
export const getEntitlementStatus=()=>request('entitlement');
export const redeemActivationKey=activationKey=>request('redeem',{activationKey});
export const startPhoneSubscriptionRecovery=activationKey=>request('recovery-start',{activationKey});
export const completePhoneSubscriptionRecovery=(challengeId,code)=>request('recovery-complete',{challengeId,code});
export const phoneSubscriptionRecoveryStatus=()=>request('recovery-status');
export const cancelPhoneSubscriptionRecovery=()=>request('recovery-cancel');
