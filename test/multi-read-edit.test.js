import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import {
  withServer,
  createTempFile,
  cleanupFile,
  parseToolResult,
} from "./helpers.js";

describe("multi_read_edit tool", () => {
  let file1, file2;

  beforeEach(async () => {
    file1 = await createTempFile("mre1.txt", "file one\nhello world\nend");
    file2 = await createTempFile("mre2.txt", "file two\nfoo bar\nend");
  });

  afterEach(async () => {
    await cleanupFile(file1);
    await cleanupFile(file2);
  });

  it("reads multiple files without editing", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_read_edit",
        arguments: {
          operations: [{ file_path: file1 }, { file_path: file2 }],
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.files_processed, 2);

      const r1 = data.results.find((r) => r.file_path === file1);
      const r2 = data.results.find((r) => r.file_path === file2);

      assert.equal(r1.read_only, true);
      assert.ok(r1.content.includes("hello world"));
      assert.equal(r2.read_only, true);
      assert.ok(r2.content.includes("foo bar"));
    });
  });

  it("reads and edits multiple files", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_read_edit",
        arguments: {
          operations: [
            { file_path: file1, old_string: "hello", new_string: "HELLO" },
            { file_path: file2, old_string: "foo", new_string: "FOO" },
          ],
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.files_processed, 2);

      const r1 = data.results.find((r) => r.file_path === file1);
      const r2 = data.results.find((r) => r.file_path === file2);

      assert.equal(r1.edits_applied, 1);
      assert.equal(r1.read_only, false);
      assert.equal(r2.edits_applied, 1);
      assert.equal(r2.read_only, false);

      // Verify on disk
      const c1 = await fs.readFile(file1, "utf8");
      const c2 = await fs.readFile(file2, "utf8");
      assert.ok(c1.includes("HELLO"));
      assert.ok(c2.includes("FOO"));
    });
  });

  it("handles mixed read-only and read+edit operations", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_read_edit",
        arguments: {
          operations: [
            { file_path: file1 }, // read-only
            { file_path: file2, old_string: "foo", new_string: "FOO" }, // edit
          ],
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.files_processed, 2);

      const readOnly = data.results.find((r) => r.file_path === file1);
      const edited = data.results.find((r) => r.file_path === file2);

      assert.equal(readOnly.read_only, true);
      assert.ok(readOnly.content); // read-only always includes content
      assert.equal(edited.read_only, false);
      assert.equal(edited.edits_applied, 1);
      // By default, edit results do NOT include content
      assert.equal(edited.content, undefined);
    });
  });

  it("includes content when include_content is true", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_read_edit",
        arguments: {
          operations: [
            { file_path: file1, old_string: "hello", new_string: "HELLO" },
          ],
          include_content: true,
        },
      });

      const data = parseToolResult(result);
      const r = data.results[0];
      assert.equal(r.edits_applied, 1);
      assert.ok(r.content); // content included
      assert.ok(r.content.includes("HELLO"));
    });
  });

  it("includes original content when include_original is true", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_read_edit",
        arguments: {
          operations: [
            { file_path: file1, old_string: "hello", new_string: "HELLO" },
          ],
          include_original: true,
        },
      });

      const data = parseToolResult(result);
      const r = data.results[0];
      assert.equal(r.edits_applied, 1);
      assert.ok(r.original_content);
      assert.ok(r.original_content.includes("hello"));
      assert.ok(!r.original_content.includes("HELLO"));
    });
  });
});
