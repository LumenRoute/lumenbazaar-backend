import { describe, expect, it } from "vitest";

import { getCorrelationId, runWithCorrelationId } from "./correlation.js";

describe("correlation context", () => {
  it("keeps concurrent asynchronous request contexts isolated", async () => {
    const observed = await Promise.all(
      ["corr_one", "corr_two"].map((id, index) =>
        runWithCorrelationId(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, index === 0 ? 5 : 1));
          return getCorrelationId();
        })
      )
    );

    expect(observed).toEqual(["corr_one", "corr_two"]);
    expect(getCorrelationId()).toBeUndefined();
  });
});
