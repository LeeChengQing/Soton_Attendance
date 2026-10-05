export function isSettingsSender(sender,runtime=chrome.runtime) {
  if(!sender || sender.id&&sender.id!==runtime.id) return false;
  try {
    const url=new URL(sender.url||sender.documentUrl||sender.tab?.url||'');
    url.hash='';url.search='';
    return url.href===runtime.getURL('options.html');
  } catch {return false;}
}
