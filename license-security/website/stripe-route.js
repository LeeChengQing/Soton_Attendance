// Next.js App Router adapter; see README for placement/import paths.
import { paymentWebhooks } from './runtime.js';
export const runtime = 'nodejs';
export const POST = paymentWebhooks.stripe;
