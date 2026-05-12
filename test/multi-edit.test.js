import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import {
  withServer,
  createTempFile,
  cleanupFile,
  parseToolResult,
} from "./helpers.js";

describe("multi_edit tool", () => {
  let file1, file2;

  beforeEach(async () => {
    file1 = await createTempFile("multi1.txt", "hello world\nfoo bar");
    file2 = await createTempFile("multi2.txt", "alpha beta\ngamma delta");
  });

  afterEach(async () => {
    await cleanupFile(file1);
    await cleanupFile(file2);
  });

  it("edits multiple files", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_edit",
        arguments: {
          edits: [
            { file_path: file1, old_string: "hello", new_string: "HELLO" },
            { file_path: file2, old_string: "alpha", new_string: "ALPHA" },
          ],
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.edited_files, 2);
      assert.equal(data.total_edits, 2);

      // Verify on disk
      const c1 = await fs.readFile(file1, "utf8");
      const c2 = await fs.readFile(file2, "utf8");
      assert.ok(c1.includes("HELLO"));
      assert.ok(!c1.includes("hello"));
      assert.ok(c2.includes("ALPHA"));
      assert.ok(!c2.includes("alpha"));
    });
  });

  it("applies multiple edits on same file", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_edit",
        arguments: {
          edits: [
            { file_path: file1, old_string: "hello", new_string: "HELLO" },
            { file_path: file1, old_string: "foo", new_string: "FOO" },
          ],
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.edited_files, 1);
      assert.equal(data.total_edits, 2);

      const content = await fs.readFile(file1, "utf8");
      assert.ok(content.includes("HELLO"));
      assert.ok(content.includes("FOO"));
      assert.ok(!content.includes("hello"));
      assert.ok(!content.includes("foo"));
    });
  });

  it("edits with replace_all", async () => {
    const tmpFile = await createTempFile(
      "replaceall.txt",
      "aaa bbb aaa ccc aaa"
    );
    try {
      await withServer(async (client) => {
        const result = await client.callTool({
          name: "multi_edit",
          arguments: {
            edits: [
              {
                file_path: tmpFile,
                old_string: "aaa",
                new_string: "AAA",
                replace_all: true,
              },
            ],
          },
        });

        const data = parseToolResult(result);
        assert.equal(data.edited_files, 1);

        const content = await fs.readFile(tmpFile, "utf8");
        assert.equal(content, "AAA bbb AAA ccc AAA");
      });
    } finally {
      await cleanupFile(tmpFile);
    }
  });

  it("errors when file not found", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "multi_edit",
        arguments: {
          edits: [
            {
              file_path: "/nonexistent/file.txt",
              old_string: "x",
              new_string: "y",
            },
          ],
        },
      });

      assert.equal(result.isError, true);
      const data = parseToolResult(result);
      assert.ok(data.error);
    });
  });
});
