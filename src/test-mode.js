import {validateFormsUrl} from './forms.js';

export function testFormIdentity(value) {
  const url=validateFormsUrl(value);
  return {host:url.hostname.toLowerCase(),formId:url.searchParams.get('id') || url.pathname.match(/^\/r\/([\w-]+)/)?.[1]};
}
export function testFormAllowed(binding,allowlist=[]) {
  if(binding?.isTest!==true || !Array.isArray(allowlist)) return false;
  try {
    const identity=testFormIdentity(binding.url);
    return allowlist.some(entry=>entry?.host===identity.host && entry?.formId===identity.formId);
  } catch {return false;}
}
