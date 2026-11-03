import {currentLanguage} from './options-locale.js';
const API='https://qckpwckfukyurkobrsig.supabase.co/functions/v1/device-api';
export function pricingCards(data) {
  if (!data?.server_now || !Array.isArray(data.products) || !data.products.length) throw Error('pricing_unavailable');
  return data.products.filter(p=>['extension','phone','yearly','bundle'].includes(p.product_key)).map(p=>{
    if (p.enabled && (!Number.isSafeInteger(p.effective_amount_minor)||p.effective_amount_minor<100)) throw Error('pricing_unavailable');
    return {productKey:p.product_key,amountMinor:p.effective_amount_minor,regularMinor:p.regular_amount_minor,enabled:p.enabled,promotionActive:p.promotion_active,endsAt:p.campaign_ends_at};
  });
}
export async function loadPricing(currency='myr') {
  const identity=await chrome.storage.local.get('attendanceCloudToken');
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',...(identity.attendanceCloudToken?{Authorization:'Bearer '+identity.attendanceCloudToken}:{})},body:JSON.stringify({action:'pricing',currency}),cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok) throw Error('pricing_unavailable');
  const data=await r.json(); pricingCards(data); return data;
}

export function startPricingPanel({getCurrency=()=> 'myr',getProduct=()=> 'phone'}={}) {
  const price=document.getElementById('subscription-price'),link=document.getElementById('purchase-subscription');
  const status=document.getElementById('phone-pricing-status');
  let generation=0,timer,data=null,loading=false;
  function render(){
    const yearly=getProduct()==='yearly',en=currentLanguage()==='en';
    const card=data?pricingCards(data).find(c=>c.productKey===getProduct()):null;
    const validPrice=Number.isSafeInteger(card?.amountMinor)&&card.amountMinor>=100;
    const expectedPrice=!yearly||card?.amountMinor===1999;
    const available=validPrice&&expectedPrice&&card.enabled&&data?.checkout_allowed===true&&Array.isArray(data.providers)&&data.providers.length>0;
    link?.setAttribute('aria-disabled',String(!available||loading));
    if(link)link.href='https://vf-auto-check.vercel.app/?product='+(yearly?'mobile_notification_yearly':'mobile_notification')+'&billing='+(yearly?'yearly':'semester');
    const amount=yearly?1999:validPrice?card.amountMinor:1199;
    if(price)price.textContent=new Intl.NumberFormat('en-MY',{style:'currency',currency:getCurrency().toUpperCase()}).format(amount/100);
    if(status)status.textContent=loading?(en?'Checking price and availability…':'正在确认价格与购买状态…'):available?(en?'Final price and validity are confirmed at checkout.':'价格与有效期以结算页为准。'):(en?'Listed price · Checkout currently unavailable.':'方案标价 · 当前暂未开放购买。');
  }
  async function refresh(){
    const version=++generation;clearTimeout(timer);loading=true;render();
    try{
      const result=await loadPricing(getCurrency());if(version!==generation)return;
      data=result;
    }catch{if(version!==generation)return;data=null;}
    finally{if(version===generation){loading=false;render();}}
    if(version!==generation)return;
    const server=Date.parse(data?.server_now),next=[Date.parse(data?.campaign?.starts_at),Date.parse(data?.campaign?.ends_at)].filter(t=>t>server);
    timer=setTimeout(()=>void refresh(),data?Math.max(100,Math.min(30000,...next.map(t=>t-server))):15000);
  }
  refresh.render=render;
  void refresh();return refresh;
}
