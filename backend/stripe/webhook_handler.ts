/**
 * backend/stripe/webhook_handler.ts
 * Idempotent Stripe webhook handler — runs as a Next.js API route or Edge function.
 * Processes: checkout.session.completed, invoice.paid, customer.subscription.*
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-04-30" });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Credit packages: Stripe Price ID → credits granted
const CREDIT_PACKAGES: Record<string, number> = {
  [process.env.STRIPE_PRICE_100_CREDITS!]:  100,
  [process.env.STRIPE_PRICE_500_CREDITS!]:  500,
  [process.env.STRIPE_PRICE_2000_CREDITS!]: 2000,
};

// Subscription plan → monthly credit allocation
const PLAN_CREDITS: Record<string, number> = {
  [process.env.STRIPE_PRICE_PRO!]:        1000,
  [process.env.STRIPE_PRICE_ENTERPRISE!]: 5000,
};

export async function handleStripeWebhook(request: Request): Promise<Response> {
  const sig = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response(`Webhook signature failed: ${(err as Error).message}`, { status: 400 });
  }

  // Idempotency guard — store event ID
  const { error: dupError } = await supabase
    .from("webhook_events")
    .insert({ id: event.id, event_type: event.type, idempotency_key: `stripe-${event.id}`, data: event.data })
    .select();

  if (dupError?.code === "23505") {
    // Duplicate — already processed
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionCancelled(event.data.object as Stripe.Subscription);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        console.log(`[stripe] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe] Handler error for ${event.type}:`, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id;
  const priceId = session.metadata?.price_id;
  if (!userId || !priceId) return;

  const credits = CREDIT_PACKAGES[priceId];
  if (!credits) return;

  await supabase.rpc("add_credits", {
    p_user_id: userId,
    p_amount: credits,
    p_operation: "purchase",
    p_reference_id: session.payment_intent as string,
    p_idempotency_key: `checkout-${session.id}`,
    p_metadata: { stripe_session_id: session.id, price_id: priceId },
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (invoice.billing_reason !== "subscription_cycle") return;
  const customerId = invoice.customer as string;
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();
  if (!profile) return;

  const priceId = invoice.lines.data[0]?.price?.id;
  const credits = priceId ? PLAN_CREDITS[priceId] : 0;
  if (!credits) return;

  await supabase.rpc("add_credits", {
    p_user_id: profile.id,
    p_amount: credits,
    p_operation: "subscription_renewal",
    p_reference_id: invoice.id,
    p_idempotency_key: `invoice-${invoice.id}`,
    p_metadata: { invoice_id: invoice.id },
  });
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const customerId = sub.customer as string;
  const priceId = sub.items.data[0]?.price.id;
  const plan = priceId === process.env.STRIPE_PRICE_PRO ? "pro"
    : priceId === process.env.STRIPE_PRICE_ENTERPRISE ? "enterprise" : "free";

  await supabase
    .from("user_profiles")
    .update({ plan, stripe_subscription_id: sub.id, updated_at: new Date().toISOString() })
    .eq("stripe_customer_id", customerId);
}

async function handleSubscriptionCancelled(sub: Stripe.Subscription) {
  await supabase
    .from("user_profiles")
    .update({ plan: "free", stripe_subscription_id: null, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", sub.id);
}

async function handlePaymentFailed(intent: Stripe.PaymentIntent) {
  console.warn(`[stripe] Payment failed: ${intent.id} — ${intent.last_payment_error?.message}`);
  // TODO: send email notification via Resend/Postmark
}
