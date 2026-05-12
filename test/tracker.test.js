import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// The tracker.js exports a singleton connected to the real data dir.
// We test it directly — this modifies the real DB but the operations
// we perform (record + query) are harmless additions.
import tracker from "../tracker.js";

describe("tracker", () => {
  // Record a unique tool name so we can find our test records later
  const TEST_TOOL = `test_${Date.now()}`;

  before(() => {
    // Record some test operations
    tracker.record(TEST_TOOL, 1, 2, 1, "/test/project");
    tracker.record(TEST_TOOL, 3, 6, 1, "/test/project");
    tracker.record(TEST_TOOL + "_other", 1, 2, 1, "/test/other");
  });

  it("record returns estimated tokens saved", () => {
    const saved = tracker.record(TEST_TOOL + "_check", 2, 4, 1, "/tmp");
    // (4 - 1) * 200 = 600
    assert.equal(saved, 600);
  });

  it("getSummary returns valid structure", () => {
    const summary = tracker.getSummary();

    assert.ok(typeof summary.total_operations === "number");
    assert.ok(summary.total_operations > 0);
    assert.ok(typeof summary.total_files === "number");
    assert.ok(typeof summary.total_standard_calls === "number");
    assert.ok(typeof summary.total_optimized_calls === "number");
    assert.ok(typeof summary.total_tokens_saved === "number");
    assert.ok(typeof summary.calls_saved === "number");
    assert.ok(typeof summary.savings_pct === "string");
    assert.ok(Array.isArray(summary.by_tool));
    assert.ok(summary.by_tool.length > 0);

    // Each by_tool entry should have the right shape
    for (const tool of summary.by_tool) {
      assert.ok(typeof tool.tool_name === "string");
      assert.ok(typeof tool.count === "number");
      assert.ok(typeof tool.files === "number");
      assert.ok(typeof tool.tokens_saved === "number");
    }
  });

  it("getDaily returns daily breakdown", () => {
    const daily = tracker.getDaily();

    assert.ok(Array.isArray(daily));
    assert.ok(daily.length > 0);

    const today = daily[0];
    assert.ok(typeof today.day === "string");
    assert.ok(typeof today.operations === "number");
    assert.ok(typeof today.files === "number");
    assert.ok(typeof today.standard_calls === "number");
    assert.ok(typeof today.optimized_calls === "number");
    assert.ok(typeof today.tokens_saved === "number");
    // Today should have at least our 4 test records
    assert.ok(today.operations >= 4);
  });

  it("getRecent returns recent operations", () => {
    const recent = tracker.getRecent(5);

    assert.ok(Array.isArray(recent));
    assert.ok(recent.length > 0);
    assert.ok(recent.length <= 5);

    const first = recent[0];
    assert.ok(typeof first.timestamp === "string");
    assert.ok(typeof first.tool_name === "string");
    assert.ok(typeof first.files_count === "number");
    assert.ok(typeof first.standard_calls === "number");
    assert.ok(typeof first.optimized_calls === "number");
    assert.ok(typeof first.estimated_tokens_saved === "number");
  });

  it("getRecent respects limit parameter", () => {
    const recent2 = tracker.getRecent(2);
    assert.ok(recent2.length <= 2);

    const recent10 = tracker.getRecent(10);
    assert.ok(recent10.length >= recent2.length);
  });

  // NOTE: We intentionally do NOT test reset() as it would destroy
  // real user data. The reset() method is simple enough (DELETE FROM operations)
  // that it doesn't need integration testing.
});
