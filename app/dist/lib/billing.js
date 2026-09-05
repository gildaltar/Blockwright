function stringId(value) {
    return typeof value === "string" ? value : value?.id;
}
function mapSubscriptionStatus(value) {
    if (value === "active" || value === "trialing" || value === "past_due" || value === "canceled" || value === "incomplete")
        return value;
    return "incomplete";
}
export class StripeBillingClient {
    config;
    request;
    subscriptionRefreshes = new Map();
    interactiveRequests = new Map();
    activeSubscriptionRefreshes = 0;
    activeInteractiveRequests = 0;
    maximumConcurrentSubscriptionRefreshes = 4;
    maximumConcurrentInteractiveRequests = 4;
    constructor(config, request = fetch) {
        this.config = config;
        this.request = request;
        if (!config.secretKey.startsWith("sk_"))
            throw new Error("Stripe secret key is not configured.");
        if (!config.priceId.startsWith("price_"))
            throw new Error("Stripe Studio price is not configured.");
        if (!config.publicUrl.startsWith("https://"))
            throw new Error("A public HTTPS URL is required for billing redirects.");
    }
    async stripe(path, init) {
        const response = await this.request(`https://api.stripe.com/v1${path}`, {
            method: init?.method ?? "GET",
            headers: {
                authorization: `Bearer ${this.config.secretKey}`,
                ...(init?.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
            },
            body: init?.body,
            signal: AbortSignal.timeout(15_000),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error?.message || `Stripe request failed with HTTP ${response.status}.`);
        return payload;
    }
    async coalescedInteractiveRequest(key, operation) {
        const existing = this.interactiveRequests.get(key);
        if (existing)
            return existing;
        if (this.activeInteractiveRequests >= this.maximumConcurrentInteractiveRequests) {
            throw new Error("Stripe billing requests are temporarily at capacity.");
        }
        const pending = (async () => {
            this.activeInteractiveRequests += 1;
            try {
                return await operation();
            }
            finally {
                this.activeInteractiveRequests -= 1;
            }
        })();
        this.interactiveRequests.set(key, pending);
        try {
            return await pending;
        }
        finally {
            if (this.interactiveRequests.get(key) === pending)
                this.interactiveRequests.delete(key);
        }
    }
    async createCheckout(principal) {
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
        const session = await this.coalescedInteractiveRequest(`checkout:${principal.tenantId}`, () => (this.stripe("/checkout/sessions", { method: "POST", body })));
        if (!session.url)
            throw new Error("Stripe did not return a checkout URL.");
        return { checkoutUrl: session.url, sessionId: session.id };
    }
    async confirmCheckout(principal, sessionId) {
        if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId))
            throw new Error("Invalid checkout session identifier.");
        const session = await this.coalescedInteractiveRequest(`checkout-confirm:${principal.tenantId}:${sessionId}`, () => (this.stripe(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`)));
        if (session.client_reference_id !== principal.tenantId)
            throw new Error("Checkout session does not belong to this workspace.");
        const subscriptionId = stringId(session.subscription);
        const customerId = stringId(session.customer);
        if (!subscriptionId || !customerId)
            throw new Error("Checkout has not created a subscription yet.");
        const embeddedStatus = session.subscription && typeof session.subscription === "object" ? session.subscription.status : undefined;
        const status = mapSubscriptionStatus(embeddedStatus ?? (session.payment_status === "paid" && session.status === "complete" ? "active" : "incomplete"));
        return { tenantId: principal.tenantId, customerId, subscriptionId, status };
    }
    async createPortal(principal, customerId) {
        if (!/^cus_[A-Za-z0-9]+$/.test(customerId))
            throw new Error("Invalid Stripe customer identifier.");
        const body = new URLSearchParams({ customer: customerId, return_url: `${this.config.publicUrl}/app` });
        const session = await this.coalescedInteractiveRequest(`portal:${principal.tenantId}:${customerId}`, () => (this.stripe("/billing_portal/sessions", { method: "POST", body })));
        if (!session.url)
            throw new Error("Stripe did not return a customer portal URL.");
        return { portalUrl: session.url, tenantId: principal.tenantId };
    }
    async refreshSubscription(principal, subscriptionId, customerId) {
        if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId))
            throw new Error("Invalid Stripe subscription identifier.");
        if (!/^cus_[A-Za-z0-9]+$/.test(customerId))
            throw new Error("Invalid Stripe customer identifier.");
        const key = `${principal.tenantId}:${subscriptionId}:${customerId}`;
        const existing = this.subscriptionRefreshes.get(key);
        if (existing)
            return existing;
        if (this.activeSubscriptionRefreshes >= this.maximumConcurrentSubscriptionRefreshes) {
            throw new Error("Subscription verification is temporarily at capacity.");
        }
        const refresh = (async () => {
            this.activeSubscriptionRefreshes += 1;
            try {
                const subscription = await this.stripe(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
                if (subscription.id !== subscriptionId || stringId(subscription.customer) !== customerId)
                    throw new Error("Stripe subscription identity does not match this workspace.");
                if (subscription.metadata?.tenant_id && subscription.metadata.tenant_id !== principal.tenantId)
                    throw new Error("Stripe subscription does not belong to this workspace.");
                return { tenantId: principal.tenantId, customerId, subscriptionId, status: mapSubscriptionStatus(subscription.status) };
            }
            finally {
                this.activeSubscriptionRefreshes -= 1;
            }
        })();
        this.subscriptionRefreshes.set(key, refresh);
        try {
            return await refresh;
        }
        finally {
            this.subscriptionRefreshes.delete(key);
        }
    }
    async listInvoices(customerId) {
        if (!/^cus_[A-Za-z0-9]+$/.test(customerId))
            throw new Error("Invalid Stripe customer identifier.");
        const result = await this.coalescedInteractiveRequest(`invoices:${customerId}`, () => (this.stripe(`/invoices?customer=${encodeURIComponent(customerId)}&limit=24`)));
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
//# sourceMappingURL=billing.js.map