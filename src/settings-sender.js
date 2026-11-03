function isPageSender(sender,page,runtime) {
  if(!sender || sender.id&&sender.id!==runtime.id) return false;
  try {
    const url=new URL(sender.url||sender.documentUrl||sender.tab?.url||'');
    url.hash='';url.search='';
    return url.href===runtime.getURL(page);
  } catch {return false;}
}
export function isSettingsSender(sender,runtime=chrome.runtime) {return isPageSender(sender,'options.html',runtime);}
export function isPopupSender(sender,runtime=chrome.runtime) {return isPageSender(sender,'popup.html',runtime);}
