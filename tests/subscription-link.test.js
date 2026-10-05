import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriptionCheckoutUrl} from '../src/subscription-link.js';

test('RM subscription link opens mobile notifications with the semester plan selected',()=>{
  const url=new URL(subscriptionCheckoutUrl('rm'));
  assert.equal(url.origin,'https://vf-auto-check.vercel.app');
  assert.equal(url.searchParams.get('product'),'mobile_notification');
  assert.equal(url.searchParams.get('billing'),'semester');
  assert.equal(url.hash,'#hero');
});

test('RMB subscription link keeps its existing storefront destination',()=>{
  assert.equal(subscriptionCheckoutUrl('rmb'),'https://shop.368fk.cn/shop/CFI5VKXO');
});
