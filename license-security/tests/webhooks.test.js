import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createPaymentWebhooks } from '../website/webhooks.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const stripeSecret = 'whsec_unit_test';
const toySecret = 'unit-test-merchant-secret';
const stripe = new Stripe('sk_test_unit_test');
function harness({ source = 'stripe', amount = 1200, providerOrder = 'cs_unit_test', queryError = false, providerTransactions } = {}) {
  const licenses = [];
  const order = { id: orderId, source, provider_order_id: providerOrder, amount_minor: amount, currency: source === 'stripe' ? 'usd' : 'myr', max_devices: 2, expires_at: null };
  const china = createClient('https://china.example.com', 'server-only-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      const target = new URL(url);
      if (queryError) return Response.json({ code: 'offline', message: 'test database outage' }, { status: 503 });
      if (target.pathname.endsWith('/payment_orders')) return Response.json(order);
      if (init?.method === 'POST') {
        const candidate = JSON.parse(init.body);
        if (!licenses.some(row => row.payment_order_id === candidate.payment_order_id)) licenses.push(candidate);
        return new Response(null, { status: 201 });
      }
      return Response.json(licenses[0] ?? null);
    } },
  });
  let providerQueries = 0;
  const handlers = createPaymentWebhooks({
    china, stripe, stripeWebhookSecret: stripeSecret, stripeLiveMode: false, toyyibpaySecret: toySecret,
    fetch: async () => { providerQueries++; return Response.json(providerTransactions ?? [{ billpaymentStatus: '1', billpaymentInvoiceNo: 'invoice-unit-test', billExternalReferenceNo: orderId, billpaymentAmount: '12.00' }]); },
  });
  return { handlers, licenses, order, providerQueries: () => providerQueries };
}
function stripeRequest({ paid = true, signature = true, amount = 1200, type = 'checkout.session.completed' } = {}) {
  const payload = JSON.stringify({ id: 'evt_unit_test', object: 'event', type, livemode: false, data: { object: { id: 'cs_unit_test', mode: 'payment', payment_status: paid ? 'paid' : 'unpaid', payment_intent: 'pi_unit_test', currency: 'usd', amount_total: amount } } });
  return new Request('https://website.example/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature ? stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret }) : 'invalid' }, body: payload });
}
function toyRequest(overrides = {}) {
  const data = { status: '1', order_id: orderId, refno: 'ref-unit-test', billcode: 'bill-unit-test', amount: '12.00', ...overrides };
  data.hash ??= createHash('md5').update(toySecret + data.status + data.order_id + data.refno + 'ok').digest('hex');
  return new Request('https://website.example/api/webhooks/toyyibpay', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
}

test('Stripe signed retries issue one license with server-defined limits', async () => {
  const h = harness();
  assert.equal((await h.handlers.stripe(stripeRequest())).status, 200);
  assert.equal((await h.handlers.stripe(stripeRequest())).status, 200);
  assert.equal(h.licenses.length, 1);
  assert.equal(h.licenses[0].source, 'stripe');
  assert.equal(h.licenses[0].max_devices, 2);
  assert.equal(h.licenses[0].payment_reference, 'pi_unit_test');
});
test('Stripe forged, unpaid and mismatched-amount events cannot provision', async () => {
  const h = harness();
  assert.equal((await h.handlers.stripe(stripeRequest({ signature: false }))).status, 400);
  assert.equal((await h.handlers.stripe(stripeRequest({ paid: false }))).status, 200);
  assert.equal((await h.handlers.stripe(stripeRequest({ amount: 1 }))).status, 409);
  assert.equal(h.licenses.length, 0);
});
test('delayed Stripe payment success also provisions; database failures request retry', async () => {
  const h = harness();
  assert.equal((await h.handlers.stripe(stripeRequest({ type: 'checkout.session.async_payment_succeeded' }))).status, 200);
  assert.equal(h.licenses.length, 1);
  const offline = harness({ queryError: true });
  assert.equal((await offline.handlers.stripe(stripeRequest())).status, 503);
});
test('ToyyibPay verifies signature, known bill, amount and provider transaction', async () => {
  const h = harness({ source: 'toyyibpay', providerOrder: 'bill-unit-test' });
  assert.equal((await h.handlers.toyyibpay(toyRequest())).status, 200);
  assert.equal((await h.handlers.toyyibpay(toyRequest())).status, 200);
  assert.equal(h.licenses.length, 1);
  assert.equal(h.licenses[0].source, 'toyyibpay');
  assert.equal(h.providerQueries(), 2);
});
test('ToyyibPay tampering, mismatched bills and unsigned amount manipulation cannot provision', async () => {
  const h = harness({ source: 'toyyibpay', providerOrder: 'bill-unit-test' });
  assert.equal((await h.handlers.toyyibpay(toyRequest({ hash: '0'.repeat(32) }))).status, 400);
  assert.equal((await h.handlers.toyyibpay(toyRequest({ billcode: 'another-bill' }))).status, 409);
  assert.equal((await h.handlers.toyyibpay(toyRequest({ amount: '0.01' }))).status, 409);
  assert.equal(h.licenses.length, 0);
});

test('ToyyibPay callback success without matching provider evidence requests retry', async () => {
  for (const providerTransactions of [[], [{ billpaymentStatus: '1', billpaymentInvoiceNo: 'other-invoice', billExternalReferenceNo: 'other-order', billpaymentAmount: '12.00' }]]) {
    const h = harness({ source: 'toyyibpay', providerOrder: 'bill-unit-test', providerTransactions });
    assert.equal((await h.handlers.toyyibpay(toyRequest())).status, 503);
    assert.equal(h.licenses.length, 0);
  }
});
