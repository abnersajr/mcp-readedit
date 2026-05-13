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
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("./package.json");

// Configurable limits via env vars
const MAX_FILES = parseInt(process.env.READEDIT_MAX_FILES) || 20;
const MAX_TOTAL_BYTES = parseInt(process.env.READEDIT_MAX_BYTES) || 2 * 1024 * 1024; // 2MB default

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
    version,
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
          "Read a file and optionally edit it in one call. For single-file tasks, use this instead of separate read_file + edit calls. Returns file content. Edit params (old_string, new_string) are optional — omit them for read-only.",
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
          "Edit multiple files when you already have their contents in context. ALWAYS use this instead of multiple separate edit calls. Each edit uses exact string or regex replacement. For read+edit combos, use multi_read_edit instead.",
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
          "Read and optionally edit multiple files in one call. ALWAYS batch multi-file operations here instead of separate read_file/edit calls. Read-only ops return file content. Edit ops return compact results by default (no content) to save tokens — set include_content=true to get post-edit content, include_original=true for diffing.",
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

// Helper: Error response
function errorResponse(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

// Helper: Apply edit to content
function applyEdit(content, oldString, newString, useRegex, replaceAll) {
  if (oldString === "") {
    throw new Error("old_string cannot be empty. Provide non-empty text to replace, or omit old_string/new_string for read-only operations.");
  }
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

      if (edits.length > MAX_FILES) {
        return errorResponse(`Too many files (${edits.length}). Max is ${MAX_FILES}. Split into multiple calls.`);
      }

      // Calculate standard calls: each file needs 1 Read + 1 Edit
      const standardCalls = edits.length * 2;

      // Group edits by file_path so we read each file only once
      const grouped = new Map();
      for (const edit of edits) {
        const key = edit.file_path;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(edit);
      }

      // Phase 1: Read + validate all edits in memory
      const plans = [];
      for (const [filePath, fileEdits] of grouped) {
        let content = await fs.readFile(filePath, "utf8");
        const original = content;

        for (const edit of fileEdits) {
          const {
            old_string,
            new_string,
            use_regex = false,
            replace_all = false,
          } = edit;

          content = applyEdit(content, old_string, new_string, use_regex, replace_all);
        }

        plans.push({ filePath, original, modified: content, fileEdits });
      }

      // Phase 2: Write all (only if all validations passed)
      for (const plan of plans) {
        await fs.writeFile(plan.filePath, plan.modified, "utf8");

        results.push({
          file_path: plan.filePath,
          edits_applied: plan.fileEdits.length,
          edited: true,
          message: `Applied ${plan.fileEdits.length} edit(s)`,
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

      const regexReplaces = edits.filter(e => e.use_regex && e.replace_all);
      const warnings = [];
      if (regexReplaces.length > 0) {
        warnings.push(`Warning: ${regexReplaces.length} edit(s) used replace_all with regex. Verify pattern matches only intended targets.`);
      }

      const response = {
        edited_files: results.length,
        total_edits: edits.length,
        results,
        message: `Successfully edited ${results.length} files (${edits.length} total edits)`,
      };
      if (warnings.length > 0) response.warnings = warnings;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    if (name === "multi_read_edit") {
      const { operations, include_content = false, include_original = false } = args;
      const results = [];
      const projectPath = process.cwd();

      if (operations.length > MAX_FILES) {
        return errorResponse(`Too many files (${operations.length}). Max is ${MAX_FILES}. Split into multiple calls.`);
      }

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

      // Phase 1: Read + validate all edits in memory
      const plans = [];
      for (const [filePath, fileOps] of grouped) {
        const firstOp = fileOps[0];
        const originalContent = await readFile(filePath, firstOp.offset, firstOp.limit);
        let content = originalContent;
        let editsApplied = 0;

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

        plans.push({ filePath, originalContent, modified: content, editsApplied, fileOps });
      }

      // Phase 2: Write only after all validations pass, then build results
      for (const plan of plans) {
        if (plan.editsApplied > 0) {
          await fs.writeFile(plan.filePath, plan.modified, "utf8");
        }

        const result = {
          file_path: plan.filePath,
          edits_applied: plan.editsApplied,
          read_only: plan.editsApplied === 0,
        };

        if (plan.editsApplied === 0) {
          result.content = plan.modified;
        } else {
          if (include_content) result.content = plan.modified;
          if (include_original) result.original_content = plan.originalContent;
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

      const editOps = operations.filter(op => op.old_string !== undefined && op.new_string !== undefined);
      const regexReplaces = editOps.filter(e => e.use_regex && e.replace_all);
      const warnings = [];
      if (regexReplaces.length > 0) {
        warnings.push(`Warning: ${regexReplaces.length} edit(s) used replace_all with regex. Verify pattern matches only intended targets.`);
      }

      const response = {
        files_processed: results.length,
        results,
        message: `Processed ${results.length} files`,
      };
      if (warnings.length > 0) response.warnings = warnings;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
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
