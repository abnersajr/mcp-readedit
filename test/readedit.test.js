import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  withServer,
  createTempFile,
  cleanupFile,
  parseToolResult,
} from "./helpers.js";

describe("read_edit tool", () => {
  let tmpFile;
  const FILE_CONTENT = `line 1
line 2
line 3
line 4
line 5`;

  beforeEach(async () => {
    tmpFile = await createTempFile("readedit.txt", FILE_CONTENT);
  });

  afterEach(async () => {
    await cleanupFile(tmpFile);
  });

  it("reads a file without editing", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "read_edit",
        arguments: { file_path: tmpFile },
      });

      const data = parseToolResult(result);
      assert.equal(data.file_path, tmpFile);
      assert.equal(data.content, FILE_CONTENT);
      assert.equal(data.edited, false);
      assert.ok(data.message.includes("read successfully"));
    });
  });

  it("reads and edits a file", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "read_edit",
        arguments: {
          file_path: tmpFile,
          old_string: "line 2",
          new_string: "LINE TWO",
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.edited, true);
      assert.ok(data.content.includes("LINE TWO"));
      assert.ok(!data.content.includes("line 2"));
      assert.ok(data.message.includes("edited"));

      // Verify file was actually modified on disk
      const { readFile } = await import("fs/promises");
      const diskContent = await readFile(tmpFile, "utf8");
      assert.ok(diskContent.includes("LINE TWO"));
      assert.ok(!diskContent.includes("line 2"));
    });
  });

  it("reads with offset and limit", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "read_edit",
        arguments: {
          file_path: tmpFile,
          offset: 2,
          limit: 2,
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.edited, false);
      // offset=2 starts at line 2, limit=2 gives 2 lines
      assert.ok(data.content.includes("line 2"));
      assert.ok(data.content.includes("line 3"));
    });
  });

  it("edits with regex", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "read_edit",
        arguments: {
          file_path: tmpFile,
          old_string: "line \\d",
          new_string: "ITEM",
          use_regex: true,
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.edited, true);
      // Without replace_all, only first match is replaced
      assert.ok(data.content.startsWith("ITEM"));
    });
  });

  it("edits with replace_all", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "read_edit",
        arguments: {
          file_path: tmpFile,
          old_string: "line",
          new_string: "LINE",
          replace_all: true,
        },
      });

      const data = parseToolResult(result);
      assert.equal(data.edited, true);
      assert.ok(!data.content.includes("line "));
      assert.ok(data.content.includes("LINE 1"));
      assert.ok(data.content.includes("LINE 5"));
    });
  });

  it("errors when file not found", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "read_edit",
        arguments: {
          file_path: "/nonexistent/path/file.txt",
        },
      });

      assert.equal(result.isError, true);
      const data = parseToolResult(result);
      assert.ok(data.error);
    });
  });

  it("errors when old_string not found", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({
        name: "read_edit",
        arguments: {
          file_path: tmpFile,
          old_string: "THIS DOES NOT EXIST",
          new_string: "replacement",
        },
      });

      assert.equal(result.isError, true);
      const data = parseToolResult(result);
      assert.ok(data.error.includes("old_string not found"));
    });
  });
});
