import { expect, it } from "vitest";
import { deliverWebhook } from "./webhookDelivery.js";
import type { WebhookDeliveryJobInput } from "./webhookDelivery.js";
it("rejects legacy oversized jobs without network delivery or retry", async () => {
  const result = await deliverWebhook({
    payload: { failureReason: "x".repeat(17000) }
  } as WebhookDeliveryJobInput);
  expect(result).toMatchObject({
    success: false,
    errorClass: "WebhookPayloadTooLarge",
    shouldRetry: false
  });
});
