import { describe, expect, it } from "vitest";
import { renderedVersionIds } from "@/lib/xds/render-context";

const now = new Date("2026-10-11T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("renderedVersionIds", () => {
  it("keeps the stable version and versions of active releases", () => {
    const ids = renderedVersionIds({
      stableVersionId: "v1",
      releases: [{ fromVersionId: "v1", candidateVersionId: "v2", finishedAt: null }],
      now,
    });
    expect([...ids].sort()).toEqual(["v1", "v2"]);
  });

  it("keeps versions of releases that finished less than 10 minutes ago (make-before-break)", () => {
    const ids = renderedVersionIds({
      stableVersionId: "v1",
      releases: [
        { fromVersionId: "v1", candidateVersionId: "v2", finishedAt: minutesAgo(5) },
        { fromVersionId: "v1", candidateVersionId: "v3", finishedAt: minutesAgo(15) },
      ],
      now,
    });
    expect([...ids].sort()).toEqual(["v1", "v2"]);
  });

  it("renders nothing for an app without a stable version or releases", () => {
    expect(renderedVersionIds({ stableVersionId: null, releases: [], now }).size).toBe(0);
  });
});
