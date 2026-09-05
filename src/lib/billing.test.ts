import { describe, expect, it, vi } from "vitest";
import { StripeBillingClient } from "./billing.js";
import type { HostedPrincipal } from "./hosted-service.js";

const principal: HostedPrincipal = {
  userId: "usr_1",
  tenantId: "ten_1",
  email: "owner@example.com",
  tenantName: "Studio",
  role: "owner",
  plan: "free",
  sessionExpiresAt: "2099-01-01T00:00:00.000Z",
};

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
}

describe("StripeBillingClient", () => {
  it("creates a tenant-bound subscription checkout", async () => {
    const request = vi.fn(async () => response({ id: "cs_test_1", url: "https://checkout.stripe.com/test" }));
    const billing = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, request as typeof fetch);
    const result = await billing.createCheckout(principal);
    expect(result.checkoutUrl).toContain("stripe.com");
    const [, init] = request.mock.calls[0];
    const body = init?.body as URLSearchParams;
    expect(body.get("client_reference_id")).toBe("ten_1");
    expect(body.get("subscription_data[metadata][tenant_id]")).toBe("ten_1");
    expect(body.get("mode")).toBe("subscription");
  });

  it("rejects checkout confirmation from another tenant", async () => {
    const request = vi.fn(async () => response({ id: "cs_test_1", client_reference_id: "ten_other", customer: "cus_1", subscription: { id: "sub_1", status: "active" } }));
    const billing = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, request as typeof fetch);
    await expect(billing.confirmCheckout(principal, "cs_test_1")).rejects.toThrow(/does not belong/);
  });

  it("confirms an active subscription and returns invoice links", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ id: "cs_test_1", client_reference_id: "ten_1", customer: "cus_1", subscription: { id: "sub_1", status: "active" } }))
      .mockResolvedValueOnce(response({ data: [{ id: "in_1", number: "BW-1", status: "paid", amount_due: 5900, amount_paid: 5900, currency: "usd", hosted_invoice_url: "https://invoice.stripe.com/1", created: 1_800_000_000 }] }));
    const billing = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, request as typeof fetch);
    expect((await billing.confirmCheckout(principal, "cs_test_1")).status).toBe("active");
    expect((await billing.listInvoices("cus_1"))[0].hostedInvoiceUrl).toContain("invoice.stripe.com");
  });

  it("refreshes entitlement only from the workspace's exact Stripe subscription", async () => {
    const request = vi.fn(async () => response({ id: "sub_1", customer: "cus_1", status: "canceled", metadata: { tenant_id: "ten_1" } }));
    const billing = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, request as typeof fetch);
    expect((await billing.refreshSubscription(principal, "sub_1", "cus_1")).status).toBe("canceled");

    const foreign = vi.fn(async () => response({ id: "sub_1", customer: "cus_2", status: "active", metadata: { tenant_id: "ten_2" } }));
    const foreignBilling = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, foreign as typeof fetch);
    await expect(foreignBilling.refreshSubscription(principal, "sub_1", "cus_1")).rejects.toThrow(/does not match|does not belong/);
  });

  it("coalesces concurrent subscription checks for one workspace", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async () => {
      await held;
      return response({ id: "sub_1", customer: "cus_1", status: "active", metadata: { tenant_id: "ten_1" } });
    });
    const billing = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, request as typeof fetch);
    const checks = Array.from({ length: 20 }, () => billing.refreshSubscription(principal, "sub_1", "cus_1"));
    release();
    expect((await Promise.all(checks)).every((state) => state.status === "active")).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent checkout, portal, and invoice work", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async (input: string | URL | Request) => {
      await held;
      const url = String(input);
      if (url.includes("billing_portal")) return response({ url: "https://billing.stripe.com/session" });
      if (url.includes("/invoices")) return response({ data: [] });
      return response({ id: "cs_test_1", url: "https://checkout.stripe.com/test" });
    });
    const billing = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, request as typeof fetch);
    const work = [
      billing.createCheckout(principal), billing.createCheckout(principal),
      billing.createPortal(principal, "cus_1"), billing.createPortal(principal, "cus_1"),
      billing.listInvoices("cus_1"), billing.listInvoices("cus_1"),
    ];
    release();
    await Promise.all(work);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("caps distinct interactive Stripe work globally", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async () => {
      await held;
      return response({ id: "cs_test", url: "https://checkout.stripe.com/test" });
    });
    const billing = new StripeBillingClient({ secretKey: "sk_test_secret", priceId: "price_studio", publicUrl: "https://blockwright.example" }, request as typeof fetch);
    const active = Array.from({ length: 4 }, (_, index) => billing.createCheckout({ ...principal, tenantId: `ten_${index}` }));
    await expect(billing.createCheckout({ ...principal, tenantId: "ten_overflow" })).rejects.toThrow(/at capacity/);
    release();
    await Promise.all(active);
    expect(request).toHaveBeenCalledTimes(4);
  });
});
