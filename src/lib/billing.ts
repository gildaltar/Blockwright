import type { BillingState, HostedPrincipal } from "./hosted-service.js";

type FetchLike = typeof fetch;

type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  client_reference_id?: string | null;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string; status?: string } | null;
  payment_status?: string;
  status?: string;
};

type StripePortalSession = { url?: string | null };
type StripeInvoice = { id: string; number?: string | null; status?: string | null; amount_due?: number; amount_paid?: number; currency?: string; hosted_invoice_url?: string | null; created?: number };
type StripeSubscription = { id: string; customer?: string | { id: string } | null; status?: string; metadata?: Record<string, string> };

export type StripeBillingConfig = {
  secretKey: string;
  priceId: string;
  publicUrl: string;
};

function stringId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

function mapSubscriptionStatus(value: string | undefined): BillingState["status"] {
  if (value === "active" || value === "trialing" || value === "past_due" || value === "canceled" || value === "incomplete") return value;
  return "incomplete";
}

export class StripeBillingClient {
  private readonly subscriptionRefreshes = new Map<string, Promise<Omit<BillingState, "updatedAt">>>();
  private readonly interactiveRequests = new Map<string, Promise<unknown>>();
  private activeSubscriptionRefreshes = 0;
  private activeInteractiveRequests = 0;
  private readonly maximumConcurrentSubscriptionRefreshes = 4;
  private readonly maximumConcurrentInteractiveRequests = 4;

  constructor(private readonly config: StripeBillingConfig, private readonly request: FetchLike = fetch) {
    if (!config.secretKey.startsWith("sk_")) throw new Error("Stripe secret key is not configured.");
    if (!config.priceId.startsWith("price_")) throw new Error("Stripe Studio price is not configured.");
    if (!config.publicUrl.startsWith("https://")) throw new Error("A public HTTPS URL is required for billing redirects.");
  }

  private async stripe<T>(path: string, init?: { method?: "GET" | "POST"; body?: URLSearchParams }) {
    const response = await this.request(`https://api.stripe.com/v1${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        ...(init?.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: init?.body,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json() as { error?: { message?: string } } & T;
    if (!response.ok) throw new Error(payload.error?.message || `Stripe request failed with HTTP ${response.status}.`);
    return payload;
  }

  private async coalescedInteractiveRequest<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.interactiveRequests.get(key);
    if (existing) return existing as Promise<T>;
    if (this.activeInteractiveRequests >= this.maximumConcurrentInteractiveRequests) {
      throw new Error("Stripe billing requests are temporarily at capacity.");
    }
    const pending = (async () => {
      this.activeInteractiveRequests += 1;
      try {
        return await operation();
      } finally {
        this.activeInteractiveRequests -= 1;
      }
    })();
    this.interactiveRequests.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.interactiveRequests.get(key) === pending) this.interactiveRequests.delete(key);
    }
  }

  async createCheckout(principal: HostedPrincipal) {
    const body = new URLSearchParams({
      mode: "subscription",
      client_reference_id: principal.tenantId,
      customer_email: principal.email,
      "line_items[0][price]": this.config.priceId,
      "line_items[0][quantity]": "1",
      "metadata[tenant_id]": principal.tenantId,
      "subscription_data[metadata][tenant_id]": principal.tenantId,
      allow_promotion_codes: "true",
      success_url: `${this.config.publicUrl}/assets/blockwright/index.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.publicUrl}/assets/blockwright/index.html?checkout=canceled`,
    });
    const session = await this.coalescedInteractiveRequest(`checkout:${principal.tenantId}`, () => (
      this.stripe<StripeCheckoutSession>("/checkout/sessions", { method: "POST", body })
    ));
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { checkoutUrl: session.url, sessionId: session.id };
  }

  async confirmCheckout(principal: HostedPrincipal, sessionId: string): Promise<Omit<BillingState, "updatedAt">> {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("Invalid checkout session identifier.");
    const session = await this.coalescedInteractiveRequest(`checkout-confirm:${principal.tenantId}:${sessionId}`, () => (
      this.stripe<StripeCheckoutSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`)
    ));
    if (session.client_reference_id !== principal.tenantId) throw new Error("Checkout session does not belong to this workspace.");
    const subscriptionId = stringId(session.subscription);
    const customerId = stringId(session.customer);
    if (!subscriptionId || !customerId) throw new Error("Checkout has not created a subscription yet.");
    const embeddedStatus = session.subscription && typeof session.subscription === "object" ? session.subscription.status : undefined;
    const status = mapSubscriptionStatus(embeddedStatus ?? (session.payment_status === "paid" && session.status === "complete" ? "active" : "incomplete"));
    return { tenantId: principal.tenantId, customerId, subscriptionId, status };
  }

  async createPortal(principal: HostedPrincipal, customerId: string) {
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error("Invalid Stripe customer identifier.");
    const body = new URLSearchParams({ customer: customerId, return_url: `${this.config.publicUrl}/app` });
    const session = await this.coalescedInteractiveRequest(`portal:${principal.tenantId}:${customerId}`, () => (
      this.stripe<StripePortalSession>("/billing_portal/sessions", { method: "POST", body })
    ));
    if (!session.url) throw new Error("Stripe did not return a customer portal URL.");
    return { portalUrl: session.url, tenantId: principal.tenantId };
  }

  async refreshSubscription(principal: HostedPrincipal, subscriptionId: string, customerId: string): Promise<Omit<BillingState, "updatedAt">> {
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw new Error("Invalid Stripe subscription identifier.");
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error("Invalid Stripe customer identifier.");
    const key = `${principal.tenantId}:${subscriptionId}:${customerId}`;
    const existing = this.subscriptionRefreshes.get(key);
    if (existing) return existing;
    if (this.activeSubscriptionRefreshes >= this.maximumConcurrentSubscriptionRefreshes) {
      throw new Error("Subscription verification is temporarily at capacity.");
    }
    const refresh = (async () => {
      this.activeSubscriptionRefreshes += 1;
      try {
        const subscription = await this.stripe<StripeSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
        if (subscription.id !== subscriptionId || stringId(subscription.customer) !== customerId) throw new Error("Stripe subscription identity does not match this workspace.");
        if (subscription.metadata?.tenant_id && subscription.metadata.tenant_id !== principal.tenantId) throw new Error("Stripe subscription does not belong to this workspace.");
        return { tenantId: principal.tenantId, customerId, subscriptionId, status: mapSubscriptionStatus(subscription.status) };
      } finally {
        this.activeSubscriptionRefreshes -= 1;
      }
    })();
    this.subscriptionRefreshes.set(key, refresh);
    try {
      return await refresh;
    } finally {
      this.subscriptionRefreshes.delete(key);
    }
  }

  async listInvoices(customerId: string) {
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error("Invalid Stripe customer identifier.");
    const result = await this.coalescedInteractiveRequest(`invoices:${customerId}`, () => (
      this.stripe<{ data: StripeInvoice[] }>(`/invoices?customer=${encodeURIComponent(customerId)}&limit=24`)
    ));
    return result.data.map((invoice) => ({
      id: invoice.id,
      number: invoice.number ?? undefined,
      status: invoice.status ?? undefined,
      amountDue: invoice.amount_due ?? 0,
      amountPaid: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? "usd",
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
      createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : undefined,
    }));
  }
}
