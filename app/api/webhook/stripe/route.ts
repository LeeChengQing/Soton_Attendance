import { paymentWebhooks } from '../../../../lib/license-security/website/runtime.js';

export const runtime = 'nodejs';
export const POST = paymentWebhooks.stripe;
