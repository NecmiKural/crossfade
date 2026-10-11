import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const configLines = (file: string): string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"));

describe("Envoy bootstraps", () => {
  it("behind-proxy differs from the direct bootstrap only by trusting one XFF hop", () => {
    const direct = configLines("envoy/envoy.yaml");
    const behindProxy = configLines("envoy/envoy.behind-proxy.yaml");
    const extra = behindProxy.filter((line) => !direct.includes(line));
    expect(extra.map((line) => line.trim())).toEqual(["xff_num_trusted_hops: 1"]);
    expect(behindProxy.filter((line) => line.trim() !== "xff_num_trusted_hops: 1")).toEqual(direct);
  });
});
