import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";

const SERVER_PATH = new URL("../index.js", import.meta.url).pathname;

/**
 * Create a temp file with given content. Returns the absolute path.
 */
export async function createTempFile(name, content) {
  const tmpDir = path.join(os.tmpdir(), "mcp-readedit-tests");
  await fs.mkdir(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${randomBytes(8).toString("hex")}_${name}`);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

/**
 * Remove a temp file if it exists.
 */
export async function cleanupFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}

/**
 * Spawn the MCP server, connect a Client, and return { client, transport }.
 */
export async function createServer() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return { client, transport };
}

/**
 * Helper: run a callback with a connected server, then tear down.
 * Usage:
 *   await withServer(async (client) => { ... });
 */
export async function withServer(fn) {
  const { client, transport } = await createServer();
  try {
    return await fn(client);
  } finally {
    await client.close();
    // Give the child process a moment to exit cleanly
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Helper to extract JSON result from an MCP tool call response.
 * The server returns content: [{ type: "text", text: "<json>" }]
 */
export function parseToolResult(result) {
  const text = result.content[0].text;
  return JSON.parse(text);
}
