export const PLAN_IDS = ["demo", "standard", "cautious", "manual"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanStep = Readonly<{ weight: number; bakeSeconds: number }>;

export type Plan = Readonly<{
  id: PlanId;
  description: string;
  /** Candidate traffic share per step; promotion follows the last step. */
  steps: readonly PlanStep[];
  /** Below this many candidate requests in a step, the engine refuses to judge and holds. */
  minRequests: number;
  /** Candidate 5xx share above which the release rolls back. */
  maxErrorRate: number;
  /** Advance automatically after each bake; manual plans wait for a person. */
  autoAdvance: boolean;
  /** How long the candidate may take to become healthy at the edge before the release fails. */
  warmupTimeoutSeconds: number;
}>;

/** The broker-style catalog (Open Service Broker "plans"): typed, versioned with the code, served as JSON. */
export const PLANS: Readonly<Record<PlanId, Plan>> = {
  demo: {
    id: "demo",
    description: "Fast plan for the demo: 10% then 50%, 15 s each.",
    steps: [
      { weight: 10, bakeSeconds: 15 },
      { weight: 50, bakeSeconds: 15 },
    ],
    minRequests: 30,
    maxErrorRate: 0.02,
    autoAdvance: true,
    warmupTimeoutSeconds: 60,
  },
  standard: {
    id: "standard",
    description: "5%, 25%, 50% over about 12 minutes.",
    steps: [
      { weight: 5, bakeSeconds: 120 },
      { weight: 25, bakeSeconds: 300 },
      { weight: 50, bakeSeconds: 300 },
    ],
    minRequests: 200,
    maxErrorRate: 0.01,
    autoAdvance: true,
    warmupTimeoutSeconds: 300,
  },
  cautious: {
    id: "cautious",
    description: "1%, 5%, 25%, 50% over about 85 minutes.",
    steps: [
      { weight: 1, bakeSeconds: 600 },
      { weight: 5, bakeSeconds: 900 },
      { weight: 25, bakeSeconds: 1800 },
      { weight: 50, bakeSeconds: 1800 },
    ],
    minRequests: 500,
    maxErrorRate: 0.005,
    autoAdvance: true,
    warmupTimeoutSeconds: 300,
  },
  manual: {
    id: "manual",
    description: "10% then 50%; a person advances each step. The error guard still rolls back.",
    steps: [
      { weight: 10, bakeSeconds: 0 },
      { weight: 50, bakeSeconds: 0 },
    ],
    minRequests: 30,
    maxErrorRate: 0.02,
    autoAdvance: false,
    warmupTimeoutSeconds: 300,
  },
};

const CAUTION_RANK: Readonly<Record<PlanId, number>> = { demo: 0, standard: 1, cautious: 2, manual: 3 };

/** CI may pick a plan, but never a less cautious one than the app's default. */
export function isAtLeastAsCautious(requested: PlanId, appDefault: PlanId): boolean {
  return CAUTION_RANK[requested] >= CAUTION_RANK[appDefault];
}
