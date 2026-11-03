// Enabled only by the separate --debug build; normal releases always enforce licensing.
export const developerMode=typeof __ATTENDANCE_DEV__!=='undefined'&&__ATTENDANCE_DEV__===true&&!chrome.runtime.getManifest().update_url;
