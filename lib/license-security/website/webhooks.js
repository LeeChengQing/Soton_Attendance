import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { failure, HttpError, json, readJson, readText, UUID } from '../shared/http.js';

function minorUnits(value) {
  // Decimal strings -> exact integer cents; avoid floating-point price checks.
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) throw new HttpError(409, 'payment_mismatch');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new HttpError(409, 'payment_mismatch');
  return cents;
}

export function createPaymentWebhooks({ china, stripe, stripeWebhookSecret, stripeLiveMode, toyyibpaySecret, toyyibpaySandbox = false, fetch: fetchApi = fetch }) {
  if (!stripeWebhookSecret || !toyyibpaySecret || typeof stripeLiveMode !== 'boolean') throw new Error('Missing payment webhook server configuration');
  const toyUrl = toyyibpaySandbox
    ? 'https://dev.toyyibpay.com/index.php/api/getBillTransactions'
    : 'https://toyyibpay.com/index.php/api/getBillTransactions';

  async function loadOrder(source, providerOrderId) {
    const { data, error } = await china.from('payment_orders')
      .select('id,source,provider_order_id,amount_minor,currency,max_devices,expires_at')
      .eq('source', source).eq('provider_order_id', providerOrderId).maybeSingle();
    // Retry instead of acknowledging a payment before its local order exists.
    if (error || !data) throw new HttpError(503, 'order_not_available');
    if (data.source !== source || data.provider_order_id !== providerOrderId) throw new HttpError(409, 'payment_mismatch');
    return data;
  }

  async function issueLicense(order, reference) {
    if (typeof reference !== 'string' || reference.length < 1 || reference.length > 256) throw new HttpError(409, 'payment_mismatch');
    // Direct insertion into CHINA. ON CONFLICT DO NOTHING is deliberate:
    // replayed webhooks cannot reset bindings, expiry or a revoked license.
    const { error } = await china.from('license_keys').upsert({
      key: randomUUID(), source: order.source, max_devices: order.max_devices,
      bound_devices: [], is_active: true, expires_at: order.expires_at,
      payment_order_id: order.id, payment_reference: reference,
    }, { onConflict: 'payment_order_id', ignoreDuplicates: true });
    if (error) throw new HttpError(503, 'license_write_failed');
    // Another webhook instance may have won the insert. Always read the winner.
    const { data, error: readError } = await china.from('license_keys')
      .select('key,source,payment_reference').eq('payment_order_id', order.id).maybeSingle();
    if (readError || !data) throw new HttpError(503, 'license_write_failed');
    if (data.source !== order.source || data.payment_reference !== reference) throw new HttpError(409, 'payment_mismatch');
    // Do not send licenses in webhook responses. An authenticated website server
    // can deliver this key only to the buyer recorded on payment_orders.buyer_id.
    return data.key;
  }

  async function stripeWebhook(request) {
    try {
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const rawBody = await readText(request, 262144);
      let event;
      try {
        // Verify the untouched body before any JSON parsing.
        event = stripe.webhooks.constructEvent(rawBody, request.headers.get('stripe-signature') ?? '', stripeWebhookSecret);
      } catch { throw new HttpError(400, 'invalid_signature'); }
      if (event.livemode !== stripeLiveMode) throw new HttpError(400, 'payment_environment_mismatch');
      if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        return json({ received: true });
      }
      const session = event.data.object;
      // A completed checkout may still be unpaid for delayed payment methods.
      if (session.payment_status !== 'paid') return json({ received: true });
      if (session.mode !== 'payment' || typeof session.id !== 'string'
        || typeof session.payment_intent !== 'string') throw new HttpError(409, 'payment_mismatch');
      const order = await loadOrder('stripe', session.id);
      if (!Number.isSafeInteger(session.amount_total) || session.amount_total !== order.amount_minor
        || session.currency !== order.currency) throw new HttpError(409, 'payment_mismatch');
      await issueLicense(order, session.payment_intent);
      return json({ received: true });
    } catch (error) {
      // Any storage/network failure returns non-2xx so Stripe can retry.
      return failure(error);
    }
  }

  async function toyyibpayWebhook(request) {
    try {
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new HttpError(415, 'form_required');
      const fields = new URLSearchParams(await readText(request, 8192));
      const body = {};
      for (const name of ['status', 'order_id', 'refno', 'billcode', 'amount', 'hash']) {
        if (fields.getAll(name).length !== 1) throw new HttpError(400, 'invalid_callback');
        body[name] = fields.get(name);
        if (!body[name] || body[name].length > 256) throw new HttpError(400, 'invalid_callback');
      }
      if (!UUID.test(body.order_id) || !/^[0-9a-f]{32}$/i.test(body.hash)) throw new HttpError(400, 'invalid_callback');
      // Provider-prescribed callback verification; do not invent an HMAC format.
      const expected = createHash('md5')
        .update(toyyibpaySecret + body.status + body.order_id + body.refno + 'ok', 'utf8').digest();
      if (!timingSafeEqual(expected, Buffer.from(body.hash, 'hex'))) throw new HttpError(400, 'invalid_signature');
      if (body.status !== '1') return json({ received: true });

      const order = await loadOrder('toyyibpay', body.billcode);
      // amount and billcode are not protected by ToyyibPay's callback hash.
      if (body.order_id !== order.id || order.currency !== 'myr'
        || minorUnits(body.amount) !== order.amount_minor) throw new HttpError(409, 'payment_mismatch');
      let transactions;
      try {
        const response = await fetchApi(toyUrl, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ billCode: order.provider_order_id, billpaymentStatus: '1' }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Provider unavailable'); }
        transactions = await readJson(response, 262144);
      } catch { throw new HttpError(503, 'payment_verification_unavailable'); }
      if (!Array.isArray(transactions)) throw new HttpError(503, 'payment_verification_unavailable');
      const confirmed = transactions.filter(transaction => {
        if (String(transaction.billpaymentStatus) !== '1' || transaction.billExternalReferenceNo !== order.id
          || typeof transaction.billpaymentInvoiceNo !== 'string') return false;
        try { return minorUnits(transaction.billpaymentAmount) === order.amount_minor; } catch { return false; }
      });
      // Bills must be fixed-price, single-use. Ambiguous/missing records need
      // retry/reconciliation; never choose an unrelated transaction as evidence.
      if (confirmed.length !== 1) throw new HttpError(503, 'payment_not_confirmed');
      await issueLicense(order, confirmed[0].billpaymentInvoiceNo);
      return json({ received: true });
    } catch (error) {
      return failure(error);
    }
  }
  return { stripe: stripeWebhook, toyyibpay: toyyibpayWebhook };
}
