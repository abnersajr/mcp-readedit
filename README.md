# MCP ReadEdit

[![npm version](https://img.shields.io/npm/v/mcp-readedit.svg)](https://www.npmjs.com/package/mcp-readedit)
[![CI](https://github.com/abnersajr/mcp-readedit/actions/workflows/ci.yml/badge.svg)](https://github.com/abnersajr/mcp-readedit/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Combine Read+Edit into single tool calls — 80-95% fewer tool calls for multi-file refactoring.**

An [MCP](https://modelcontextprotocol.io) server that gives any AI coding assistant batch file operations. Instead of separate Read → Edit calls per file, do it all in one shot.

## Quick Start

No install needed — run directly with npx:

```bash
npx mcp-readedit
```

Or install globally for faster startup:

```bash
npm install -g mcp-readedit
```

Then add it to your MCP client (see [Client Setup](#client-setup) below).

## Client Setup

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "readedit": {
      "command": "npx",
      "args": ["mcp-readedit"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add readedit -- npx mcp-readedit
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "readedit": {
      "command": "npx",
      "args": ["mcp-readedit"]
    }
  }
}
```

### Windsurf

Go to **Settings → MCP Servers** and add:

```json
{
  "readedit": {
    "command": "npx",
    "args": ["mcp-readedit"]
    }
}
```

### Cline (VS Code Extension)

In Cline settings, add to MCP Servers:

```json
{
  "readedit": {
    "command": "npx",
    "args": ["mcp-readedit"]
  }
}
```

### Continue

Add to `.continue/config.yaml`:

```yaml
mcpServers:
  - name: readedit
    command: npx
    args:
      - mcp-readedit
```

### Zed

Add to your Zed `settings.json`:

```json
{
  "context_servers": {
    "readedit": {
      "command": "npx",
      "args": ["mcp-readedit"]
    }
  }
}
```

## Tools

| Tool | What it does |
|------|-------------|
| `read_edit` | Read a file, optionally edit it — 1 call instead of 2 |
| `multi_edit` | Edit multiple files at once |
| `multi_read_edit` | Read + optionally edit multiple files — the powerhouse |
| `get_gain` | Show your token savings statistics |

### `read_edit` — Single file read + optional edit

Read a file and optionally replace text in one call. Returns file content.

```json
{
  "file_path": "/absolute/path/to/file.ts",
  "old_string": "text to replace",
  "new_string": "replacement text"
}
```

Options: `use_regex` (boolean), `replace_all` (boolean), `offset` (line number), `limit` (line count). Omit `old_string`/`new_string` to just read.

### `multi_edit` — Edit multiple files

Batch edits across files in a single call. Use when you already have the file contents.

```json
{
  "edits": [
    { "file_path": "/path/a.ts", "old_string": "foo", "new_string": "bar" },
    { "file_path": "/path/b.ts", "old_string": "baz", "new_string": "qux", "replace_all": true }
  ]
}
```

### `multi_read_edit` — Read + edit multiple files

The most powerful tool. Read and optionally edit any number of files in one call.

```json
{
  "operations": [
    { "file_path": "/path/a.ts" },
    { "file_path": "/path/b.ts", "old_string": "old", "new_string": "new" },
    { "file_path": "/path/c.ts", "old_string": "\\d+", "new_string": "0", "use_regex": true }
  ]
}
```

Options: `include_content` (boolean, default false) and `include_original` (boolean, default false) control what's returned.

### `get_gain` — Token savings stats

```json
{ "breakdown": "summary" }
```

Breakdown types: `summary` (default), `daily`, `recent`, `all`.

## Before / After

Refactoring a feature across 9 files:

**Without MCP ReadEdit** — 52 tool calls:
```
Read file1 → Edit file1 → Read file2 → Edit file2 → ... → Read file9 → Edit file9
28 Edit + 19 Read + 5 Write = 52 calls
```

**With MCP ReadEdit** — 4 tool calls:
```
multi_read_edit (files 1-3) → multi_read_edit (files 4-6) → multi_read_edit (files 7-9) → multi_edit (final batch)
```

**Result: 48 calls saved (~9,600 tokens)**

## How Gain Tracking Works

Each tool call is recorded to a local SQLite database. The tracker calculates what it *would have* taken with standard Read+Edit calls:

- `read_edit` with edit: 2 standard calls → 1 optimized call
- `multi_edit` (N files): 2N standard calls → 1 optimized call
- `multi_read_edit` (N files): 2N standard calls → 1 optimized call

Token savings are estimated at ~200 tokens per avoided call (JSON overhead, tool result wrapping). The database auto-creates on first use.

## CLI Usage

If installed globally (`npm install -g mcp-readedit`), the `readedit` command gives terminal access to gain stats:

```bash
readedit gain                  # Summary
readedit gain --daily          # Day-by-day breakdown
readedit gain --recent 20      # Last 20 operations
readedit gain --all            # All breakdowns
readedit gain --format json    # JSON export
readedit gain --reset          # Reset statistics
```

Works with npx too: `npx mcp-readedit` starts the server, `readedit gain` runs the CLI.

## Contributing

```bash
git clone https://github.com/abnersajr/mcp-readedit.git
cd mcp-readedit
npm install
npm test
```

Issues and PRs welcome at [github.com/abnersajr/mcp-readedit](https://github.com/abnersajr/mcp-readedit).

## License

MIT
