import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/core/inspect";

const token = "a1".repeat(32);

describe("redactSecrets", () => {
  it("removes every 64-hex secret from rendered config", () => {
    const routes = JSON.stringify([{ routes: [{ match: { headers: [{ name: "x-crossfade-tester", string_match: { exact: token } }] } }] }]);
    const redacted = redactSecrets(routes);
    expect(redacted).not.toMatch(/[0-9a-f]{64}/);
    expect(redacted).toContain("‹redacted›");
  });

  it("keeps everything else intact", () => {
    const clusters = JSON.stringify([{ name: "shop--v1", port_value: 3000, version: "1791688811129" }]);
    expect(redactSecrets(clusters)).toBe(clusters);
  });
});
