import { describe, expect, it } from "vitest";

import { validateRouteTemplate } from "./index.js";

describe("route template validation", () => {
  it("accepts safe templates whose path params exist in the input schema", () => {
    expect(
      validateRouteTemplate("/weather/{city}", {
        type: "object",
        properties: {
          city: {
            type: "string"
          }
        }
      })
    ).toEqual({
      params: ["city"]
    });
  });

  it.each(["weather/{city}", "/../secret", "/weather//{city}", "/weather/{bad-param}"])(
    "rejects unsafe template %s",
    (template) => {
      expect(() => validateRouteTemplate(template)).toThrow("Route template");
    }
  );

  it("rejects params not described by the input schema", () => {
    expect(() =>
      validateRouteTemplate("/weather/{city}", {
        type: "object",
        properties: {
          country: {
            type: "string"
          }
        }
      })
    ).toThrow("missing from input schema");
  });
});
