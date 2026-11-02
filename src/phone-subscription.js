import {currentLanguage} from './options-locale.js';

export function initPhoneSubscription({onChange}) {
  const root=document.getElementById('phone-subscription');
  const track=root.querySelector('.phone-plan-switch'),pill=root.querySelector('.phone-plan-pill');
  const buttons=[...root.querySelectorAll('[data-phone-plan]')];
  let product='phone',animations=[];
  const english=()=>currentLanguage()==='en';
  function render() {
    animations.forEach(animation=>animation.cancel());animations=[];
    root.querySelectorAll('[data-phone-zh]').forEach(element=>{element.textContent=element.dataset[english()?'phoneEn':'phoneZh'];});
    const yearly=product==='yearly';
    track.dataset.yearly=String(yearly);
    buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.phonePlan===product)));
    root.querySelector('#phone-plan-name').textContent=yearly?(english()?'Yearly Plan':'年度方案 · Yearly Plan'):(english()?'Semester Plan':'学期方案 · Semester Plan');
    root.querySelector('#phone-plan-duration').textContent=yearly?(english()?'12 months of notifications':'12 个月手机提醒服务'):(english()?'130 days of notifications':'130 天手机提醒服务');
    root.querySelector('#purchase-subscription').textContent=yearly?(english()?'Choose yearly plan →':'开通年度方案 →'):(english()?'Choose semester plan →':'开通学期方案 →');
  }
  function foldText() {
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    root.querySelectorAll('[data-phone-fold]').forEach(element=>{
      const text=element.textContent;
      const accessible=document.createElement('span');accessible.className='phone-fold-accessible';accessible.textContent=text;
      const visual=document.createElement('span');visual.setAttribute('aria-hidden','true');
      element.replaceChildren(accessible,visual);
      Array.from(text).forEach((char,index)=>{
        const segment=document.createElement('span');segment.className='phone-fold-segment';
        const piece=document.createElement('span');piece.className='phone-fold-piece';piece.textContent=char;piece.dataset.foldText=char;
        segment.append(piece);visual.append(segment);
        // FoldText paper/top: 92 degrees, 700px perspective, power3.out, 45ms stagger.
        const frames=Array.from({length:31},(_,i)=>{const progress=1-(1-i/30)**4;return {offset:i/30,transform:`rotateX(${-92*(1-progress)}deg)`,opacity:progress,'--phone-crease':String(.55*(1-progress))};});
        const animation=piece.animate(frames,{duration:650,delay:index*45,fill:'both',easing:'linear'});
        animation.onfinish=()=>animation.cancel();animations.push(animation);
      });
    });
  }
  buttons.forEach(button=>button.addEventListener('click',()=>{
    product=button.dataset.phonePlan;render();onChange();
    pill.classList.remove('phone-jelly');void pill.offsetWidth;pill.classList.add('phone-jelly');
    foldText();
  }));
  render();
  return {render,getProduct:()=>product};
}
