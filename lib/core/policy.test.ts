import { describe, expect, it } from "vitest";
import { type Action, type Actor, actorRef, can } from "@/lib/core/policy";

const admin: Actor = { kind: "user", id: "u-admin", role: "admin", readOnly: false };
const alice: Actor = { kind: "user", id: "u-alice", role: "user", readOnly: false };
const bob: Actor = { kind: "user", id: "u-bob", role: "user", readOnly: false };
const impersonated: Actor = { kind: "user", id: "u-bob", role: "user", readOnly: true };
const ciKey: Actor = { kind: "apikey", id: "key-1", ownerId: "u-alice", apps: ["shop"] };
const engine: Actor = { kind: "engine" };

const release = (createdBy: string, requiresApproval = false) => ({ app: "shop", createdBy, requiresApproval });

describe("can()", () => {
  it.each<[string, Actor, Action, boolean]>([
    // reading
    ["users read releases", alice, { type: "release.read", app: "shop" }, true],
    ["impersonated sessions still read", impersonated, { type: "release.read", app: "shop" }, true],
    ["keys read their own apps", ciKey, { type: "release.read", app: "shop" }, true],
    ["keys cannot read other apps", ciKey, { type: "release.read", app: "blog" }, false],
    ["users read the edge page", alice, { type: "edge.read" }, true],
    ["keys cannot read the edge page", ciKey, { type: "edge.read" }, false],
    // creating releases
    ["users create releases", alice, { type: "release.create", app: "shop" }, true],
    ["keys create releases for their apps", ciKey, { type: "release.create", app: "shop" }, true],
    ["keys cannot create releases for other apps", ciKey, { type: "release.create", app: "blog" }, false],
    ["impersonated sessions are read-only", impersonated, { type: "release.create", app: "shop" }, false],
    // approving (four-eyes)
    ["someone else approves", bob, { type: "release.approve", ...release("u-alice", true) }, true],
    ["the creator cannot approve", alice, { type: "release.approve", ...release("u-alice", true) }, false],
    ["an admin creator cannot approve either", admin, { type: "release.approve", ...release("u-admin", true) }, false],
    ["the key owner cannot approve a key-created release", alice, { type: "release.approve", ...release("u-alice", true) }, false],
    ["keys never approve", ciKey, { type: "release.approve", ...release("u-bob", true) }, false],
    ["impersonated sessions never approve", impersonated, { type: "release.approve", ...release("u-alice", true) }, false],
    // controlling a rollout
    ["anyone signed in pauses", alice, { type: "release.control", control: "pause", ...release("u-bob") }, true],
    ["anyone signed in aborts", bob, { type: "release.control", control: "abort", ...release("u-bob", true) }, true],
    ["the creator advances without four-eyes", alice, { type: "release.control", control: "advance", ...release("u-alice") }, true],
    ["the creator cannot advance with four-eyes", alice, { type: "release.control", control: "advance", ...release("u-alice", true) }, false],
    ["the creator cannot promote now with four-eyes", alice, { type: "release.control", control: "promote", ...release("u-alice", true) }, false],
    ["another user promotes with four-eyes", bob, { type: "release.control", control: "promote", ...release("u-alice", true) }, true],
    ["keys do not control rollouts", ciKey, { type: "release.control", control: "abort", ...release("u-alice") }, false],
    ["impersonated sessions do not control rollouts", impersonated, { type: "release.control", control: "pause", ...release("u-alice") }, false],
    // admin-only surfaces
    ["admins manage apps", admin, { type: "app.manage" }, true],
    ["users cannot manage apps", alice, { type: "app.manage" }, false],
    ["admins reveal tester tokens", admin, { type: "app.reveal-token", app: "shop" }, true],
    ["users cannot reveal tester tokens", alice, { type: "app.reveal-token", app: "shop" }, false],
    ["admins manage settings", admin, { type: "settings.manage" }, true],
    ["impersonated admins cannot manage settings", { ...admin, readOnly: true }, { type: "settings.manage" }, false],
    ["keys cannot manage anything", ciKey, { type: "app.manage" }, false],
    // internal actors
    ["the engine acts on releases", engine, { type: "release.control", control: "abort", ...release("u-alice", true) }, true],
    ["system actors act on everything", { kind: "system" }, { type: "app.manage" }, true],
  ])("%s", (_name, actor, action, expected) => {
    expect(can(actor, action)).toBe(expected);
  });
});

describe("actorRef", () => {
  it("maps actors to audit references", () => {
    expect(actorRef(alice)).toEqual({ kind: "user", id: "u-alice" });
    expect(actorRef(ciKey)).toEqual({ kind: "apikey", id: "key-1" });
    expect(actorRef(engine)).toEqual({ kind: "engine", id: null });
    expect(actorRef({ kind: "system", id: "seed" })).toEqual({ kind: "system", id: "seed" });
  });
});
