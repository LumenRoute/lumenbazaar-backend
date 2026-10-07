import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const alerts = readFileSync("config/alerts.yml", "utf8");
const runbook = readFileSync("docs/operations/payment-incidents.md", "utf8");

describe("operator observability configuration", () => {
  it.each([
    "LumenBazaarDependencyUnavailable",
    "LumenBazaarSignerUnavailable",
    "LumenBazaarSettlementStuck",
    "LumenBazaarReconciliationNeedsReview",
    "LumenBazaarReplaySpike",
    "LumenBazaarVerificationRejectionRateHigh"
  ])("maps the %s alert to the incident runbook", (alert) => {
    expect(alerts).toContain(`alert: ${alert}`);
    expect(alerts).toContain("docs/operations/payment-incidents.md#");
  });

  it("documents correlation, redaction, and rollback without high-cardinality labels", () => {
    expect(runbook).toContain("correlationId");
    expect(runbook).toContain("Never\npaste signing keys");
    expect(runbook).toContain("## Rollback");
    expect(alerts).not.toMatch(/labelNames.*(correlation|receipt|transaction|wallet|resource)/iu);
  });
});
