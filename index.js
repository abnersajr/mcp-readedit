#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import tracker from "./tracker.js";

// ── Logger ──────────────────────────────────────────────────────────────
// All output goes to stderr (stdout is reserved for MCP JSON-RPC transport).
// Timestamps are ISO-8601 with local timezone for easy correlation with
// Hermes agent.log entries.

function timestamp() {
  return new Date().toISOString();
}

function logInfo(msg) {
  console.error(`[${timestamp()}] INFO  ${msg}`);
}

function logWarn(msg) {
  console.error(`[${timestamp()}] WARN  ${msg}`);
}

function logError(msg, err) {
  const detail = err instanceof Error ? `\n  ${err.stack || err.message}` : "";
  console.error(`[${timestamp()}] ERROR ${msg}${detail}`);
}

// Log unhandled rejections so they appear in mcp-stderr.log
process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = new Server(
  {
    name: "mcp-readedit",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_edit",
        description:
          "Read a file and optionally edit it in one operation. Returns file content to Claude. Supports exact string or regex replacement.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the file",
            },
            old_string: {
              type: "string",
              description: "Text to replace (exact match or regex if use_regex=true)",
            },
            new_string: {
              type: "string",
              description: "Text to replace with",
            },
            use_regex: {
              type: "boolean",
              description: "Treat old_string as regex (default: false)",
              default: false,
            },
            replace_all: {
              type: "boolean",
              description: "Replace all occurrences (default: false)",
              default: false,
            },
            offset: {
              type: "number",
              description: "Line number to start reading from (optional)",
            },
            limit: {
              type: "number",
              description: "Number of lines to read (optional)",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "multi_edit",
        description:
          "Edit multiple files in one operation. Each edit can use exact string or regex replacement.",
        inputSchema: {
          type: "object",
          properties: {
            edits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  file_path: {
                    type: "string",
                    description: "Absolute path to the file",
                  },
                  old_string: {
                    type: "string",
                    description: "Text to replace",
                  },
                  new_string: {
                    type: "string",
                    description: "Text to replace with",
                  },
                  use_regex: {
                    type: "boolean",
                    description: "Treat old_string as regex",
                    default: false,
                  },
                  replace_all: {
                    type: "boolean",
                    description: "Replace all occurrences",
                    default: false,
                  },
                },
                required: ["file_path", "old_string", "new_string"],
              },
            },
          },
          required: ["edits"],
        },
      },
      {
        name: "multi_read_edit",
        description:
          "Read multiple files and optionally edit them in one operation. Returns full content for read-only operations. Edit operations return compact results by default (no file content) to save tokens. Use include_content/include_original flags to opt into full content when needed.",
        inputSchema: {
          type: "object",
          properties: {
            operations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  file_path: {
                    type: "string",
                    description: "Absolute path to the file",
                  },
                  old_string: {
                    type: "string",
                    description: "Text to replace (optional - if omitted, just reads)",
                  },
                  new_string: {
                    type: "string",
                    description: "Text to replace with",
                  },
                  use_regex: {
                    type: "boolean",
                    description: "Treat old_string as regex",
                    default: false,
                  },
                  replace_all: {
                    type: "boolean",
                    description: "Replace all occurrences",
                    default: false,
                  },
                  offset: {
                    type: "number",
                    description: "Line number to start reading from",
                  },
                  limit: {
                    type: "number",
                    description: "Number of lines to read",
                  },
                },
                required: ["file_path"],
              },
            },
            include_content: {
              type: "boolean",
              description: "Include full file content in edit results (default: false for token savings)",
              default: false,
            },
            include_original: {
              type: "boolean",
              description: "Include original pre-edit content in edit results (default: false)",
              default: false,
            },
          },
          required: ["operations"],
        },
      },
      {
        name: "get_gain",
        description:
          "Show token savings statistics from using optimized ReadEdit tools vs standard Read+Edit calls.",
        inputSchema: {
          type: "object",
          properties: {
            breakdown: {
              type: "string",
              enum: ["summary", "daily", "recent", "all"],
              description: "Type of breakdown to show",
              default: "summary",
            },
            limit: {
              type: "number",
              description: "Number of recent operations to show (for 'recent' breakdown)",
              default: 10,
            },
          },
        },
      },
    ],
  };
});

// Helper: Read file with optional offset/limit
async function readFile(filePath, offset, limit) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split("\n");

  if (offset !== undefined || limit !== undefined) {
    const start = offset ? offset - 1 : 0;
    const end = limit ? start + limit : lines.length;
    return lines.slice(start, end).join("\n");
  }

  return content;
}

// Helper: Apply edit to content
function applyEdit(content, oldString, newString, useRegex, replaceAll) {
  if (useRegex) {
    const flags = replaceAll ? "g" : "";
    const regex = new RegExp(oldString, flags);
    return content.replace(regex, newString);
  } else {
    if (replaceAll) {
      return content.split(oldString).join(newString);
    } else {
      const count = (content.match(new RegExp(oldString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      if (count === 0) {
        throw new Error(`old_string not found: ${oldString}`);
      }
      if (count > 1) {
        throw new Error(`old_string found ${count} times (use replace_all=true)`);
      }
      return content.replace(oldString, newString);
    }
  }
}

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const start = Date.now();

  // Log tool call entry (truncate large args for readability)
  const argsSummary = args
    ? JSON.stringify(args).slice(0, 300) + (JSON.stringify(args).length > 300 ? "…" : "")
    : "{}";
  logInfo(`tool_call: ${name} args=${argsSummary}`);

  try {
    if (name === "read_edit") {
      const {
        file_path,
        old_string,
        new_string,
        use_regex = false,
        replace_all = false,
        offset,
        limit,
      } = args;

      const projectPath = process.cwd();

      // Calculate standard calls: 1 Read + (edit ? 1 Edit : 0)
      const standardCalls = old_string !== undefined && new_string !== undefined ? 2 : 1;

      // Read file
      const originalContent = await readFile(file_path, offset, limit);
      let finalContent = originalContent;
      let edited = false;

      // Edit if requested
      if (old_string !== undefined && new_string !== undefined) {
        finalContent = applyEdit(
          originalContent,
          old_string,
          new_string,
          use_regex,
          replace_all
        );
        await fs.writeFile(file_path, finalContent, "utf8");
        edited = true;
      }

      // Track: 1 optimized call (read_edit) vs standardCalls
      const tokensSaved = tracker.record(
        "read_edit",
        1,
        standardCalls,
        1,
        projectPath
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                file_path,
                content: finalContent,
                original_content: edited ? originalContent : undefined,
                edited,
                tokens_saved: tokensSaved,
                message: edited
                  ? "File read and edited successfully"
                  : "File read successfully",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "multi_edit") {
      const { edits } = args;
      const results = [];
      const projectPath = process.cwd();

      // Calculate standard calls: each file needs 1 Read + 1 Edit
      const standardCalls = edits.length * 2;

      // Group edits by file_path so we read each file only once
      const grouped = new Map();
      for (const edit of edits) {
        const key = edit.file_path;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(edit);
      }

      for (const [filePath, fileEdits] of grouped) {
        let content = await fs.readFile(filePath, "utf8");

        for (const edit of fileEdits) {
          const {
            old_string,
            new_string,
            use_regex = false,
            replace_all = false,
          } = edit;

          content = applyEdit(content, old_string, new_string, use_regex, replace_all);
        }

        await fs.writeFile(filePath, content, "utf8");

        results.push({
          file_path: filePath,
          edits_applied: fileEdits.length,
          edited: true,
          message: `Applied ${fileEdits.length} edit(s)`,
        });
      }

      // Track: 1 optimized call (multi_edit) vs standardCalls
      const tokensSaved = tracker.record(
        "multi_edit",
        edits.length,
        standardCalls,
        1,
        projectPath
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                edited_files: results.length,
                total_edits: edits.length,
                results,
                tokens_saved: tokensSaved,
                message: `Successfully edited ${results.length} files (${edits.length} total edits)`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "multi_read_edit") {
      const { operations, include_content = false, include_original = false } = args;
      const results = [];
      const projectPath = process.cwd();

      // Calculate standard calls: each file needs 1 Read + (edit ? 1 Edit : 0)
      let standardCalls = 0;
      for (const op of operations) {
        standardCalls += 1; // Read
        if (op.old_string !== undefined && op.new_string !== undefined) {
          standardCalls += 1; // Edit
        }
      }

      // Group operations by file_path so we read each file only once
      const grouped = new Map();
      for (const op of operations) {
        const key = op.file_path;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(op);
      }

      for (const [filePath, fileOps] of grouped) {
        // Read once for all ops on this file
        const firstOp = fileOps[0];
        const originalContent = await readFile(filePath, firstOp.offset, firstOp.limit);
        let content = originalContent;
        let editsApplied = 0;

        // Apply edits sequentially in-memory
        for (const op of fileOps) {
          if (op.old_string !== undefined && op.new_string !== undefined) {
            content = applyEdit(
              content,
              op.old_string,
              op.new_string,
              op.use_regex ?? false,
              op.replace_all ?? false
            );
            editsApplied++;
          }
        }

        // Write once after all edits
        if (editsApplied > 0) {
          await fs.writeFile(filePath, content, "utf8");
        }

        // Build result: read-only gets full content, edits get compact by default
        const result = {
          file_path: filePath,
          edits_applied: editsApplied,
          read_only: editsApplied === 0,
        };

        if (editsApplied === 0) {
          // Read-only: always return content (agent needs it to understand code)
          result.content = content;
        } else {
          // Edit: compact by default, opt-in to full content
          if (include_content) result.content = content;
          if (include_original) result.original_content = originalContent;
        }

        results.push(result);
      }

      // Track: 1 optimized call (multi_read_edit) vs standardCalls
      const tokensSaved = tracker.record(
        "multi_read_edit",
        operations.length,
        standardCalls,
        1,
        projectPath
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                files_processed: results.length,
                results,
                message: `Processed ${results.length} files`,
                tokens_saved: tokensSaved,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "get_gain") {
      const { breakdown = "summary", limit = 10 } = args;

      if (breakdown === "summary" || breakdown === "all") {
        const summary = tracker.getSummary();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  type: "summary",
                  data: summary,
                  message: `Total tokens saved: ${summary.total_tokens_saved} (${summary.savings_pct}% reduction)`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (breakdown === "daily") {
        const daily = tracker.getDaily();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  type: "daily",
                  data: daily,
                  message: `Showing ${daily.length} days of data`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (breakdown === "recent") {
        const recent = tracker.getRecent(limit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  type: "recent",
                  data: recent,
                  message: `Last ${recent.length} operations`,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const elapsed = Date.now() - start;
    logError(`tool_error: ${name} (${elapsed}ms) ${error.message}`, error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: error.message,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logInfo("MCP ReadEdit server running on stdio");
}

main().catch((error) => {
  logError("Fatal error", error);
  process.exit(1);
});
