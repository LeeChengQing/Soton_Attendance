export function initWorkflowNav() {
  const dock=document.getElementById('workflow-dock'),toggle=document.getElementById('dock-toggle'),panel=document.getElementById('workflow-panel');
  let keyboard=false;
  const setOpen=open=>{dock.classList.toggle('expanded',open);toggle.setAttribute('aria-expanded',String(open));panel.inert=!open;};
  dock.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse') {keyboard=false;setOpen(true);}});
  dock.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&!(keyboard&&dock.matches(':focus-within'))) setOpen(false);});
  toggle.addEventListener('click',()=>setOpen(toggle.getAttribute('aria-expanded')!=='true'));
  document.addEventListener('keydown',event=>{if(['Tab','Enter',' '].includes(event.key)) keyboard=true;});
  dock.addEventListener('focusin',event=>{if(keyboard&&event.target!==toggle) setOpen(true);});
  dock.addEventListener('focusout',event=>{if(!dock.contains(event.relatedTarget)) setOpen(false);});
  dock.addEventListener('keydown',event=>{if(event.key==='Escape') {event.preventDefault();setOpen(false);toggle.focus({preventScroll:true});}});
  document.addEventListener('pointerdown',event=>{if(!dock.contains(event.target)) setOpen(false);});
}
