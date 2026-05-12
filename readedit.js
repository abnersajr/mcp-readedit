#!/usr/bin/env node
/**
 * readedit CLI - Token savings analytics for MCP ReadEdit
 * 
 * Usage:
 *   readedit gain                    # Summary stats
 *   readedit gain --daily            # Day-by-day breakdown
 *   readedit gain --recent 20       # Recent operations
 *   readedit gain --all --format json # JSON export
 *   readedit gain --reset            # Reset stats
 */

import tracker from "./tracker.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
let breakdown = "summary";
let limit = 10;
let format = "text";
let reset = false;
let confirmReset = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--daily" || arg === "-d") breakdown = "daily";
  else if (arg === "--recent" || arg === "-r") {
    breakdown = "recent";
    limit = parseInt(args[i + 1]) || 10;
    i++;
  }
  else if (arg === "--all" || arg === "-a") breakdown = "all";
  else if (arg === "--format" || arg === "-f") {
    format = args[i + 1] || "text";
    i++;
  }
  else if (arg === "--reset" || arg === "--yes") {
    reset = true;
    if (arg === "--yes") confirmReset = true;
  }
  else if (arg === "--help" || arg === "-h") {
    console.log(`
readedit - MCP ReadEdit Token Savings Analytics

Usage:
  readedit gain                    # Summary stats
  readedit gain --daily            # Day-by-day breakdown
  readedit gain --recent [N]       # Recent operations (default: 10)
  readedit gain --all              # All data (daily + weekly + monthly)
  readedit gain --format json      # JSON export
  readedit gain --reset            # Reset all statistics
  readedit gain --yes             # Reset without confirmation

Options:
  -d, --daily      Show day-by-day breakdown
  -r, --recent N   Show last N operations
  -a, --all        Show all breakdowns
  -f, --format     Output format: text, json, csv
  --reset          Reset all statistics
  -h, --help       Show this help
  -V, --version    Show version

Examples:
  readedit gain                    # Show summary
  readedit gain --daily           # Daily breakdown
  readedit gain --recent 20      # Last 20 operations
  readedit gain --all --format json | jq # JSON export
`);
    process.exit(0);
  }
  else if (arg === "--version" || arg === "-V") {
    console.log(`readedit v${version}`);
    process.exit(0);
  }
}

// ANSI colors (TTY-aware)
const isTTY = process.stdout.isTTY;
const colors = {
  green: (text) => isTTY ? `\x1b[32m${text}\x1b[0m` : text,
  yellow: (text) => isTTY ? `\x1b[33m${text}\x1b[0m` : text,
  red: (text) => isTTY ? `\x1b[31m${text}\x1b[0m` : text,
  cyan: (text) => isTTY ? `\x1b[36m${text}\x1b[0m` : text,
  bold: (text) => isTTY ? `\x1b[1m${text}\x1b[0m` : text,
  dim: (text) => isTTY ? `\x1b[2m${text}\x1b[0m` : text,
};

function styled(text, strong = false) {
  if (!isTTY) return text;
  return strong ? colors.bold(colors.green(text)) : text;
}

function printHelp() {
  console.log(`
${styled("readedit", true)} - MCP ReadEdit Token Savings Analytics

${styled("Usage:")}
  readedit gain                    # Summary stats
  readedit gain --daily            # Day-by-day breakdown
  readedit gain --recent [N]       # Recent operations (default: 10)
  readedit gain --all              # All data (daily + weekly + monthly)
  readedit gain --format json      # JSON export
  readedit gain --reset            # Reset all statistics
  readedit gain --yes             # Reset without confirmation

${styled("Options:")}
  -d, --daily      Show day-by-day breakdown
  -r, --recent N   Show last N operations
  -a, --all        Show all breakdowns
  -f, --format     Output format: text, json, csv
  --reset          Reset all statistics
  --help           Show this help
  --version        Show version

${styled("Examples:")}
  readedit gain                    # Show summary
  readedit gain --daily           # Daily breakdown
  readedit gain --recent 20      # Last 20 operations
  readedit gain --all --format json | jq # JSON export
`);
}

function formatTokens(tokens) {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

function printEfficiencyMeter(pct) {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const coloredBar = isTTY ? colors.green(bar) : bar;
  const coloredPct = pct >= 70 ? colors.green(`${pct.toFixed(1)}%`) :
                     pct >= 40 ? colors.yellow(`${pct.toFixed(1)}%`) :
                     colors.red(`${pct.toFixed(1)}%`);
  console.log(`Efficiency meter: ${coloredBar} ${coloredPct}`);
}

function printKPI(label, value) {
  console.log(`${label.padEnd(20)} ${value}`);
}

function colorizePct(pct) {
  if (pct >= 70) return colors.green(`${pct.toFixed(1)}%`);
  if (pct >= 40) return colors.yellow(`${pct.toFixed(1)}%`);
  return colors.red(`${pct.toFixed(1)}%`);
}

function miniBar(value, max, width = 8) {
  if (max === 0 || width === 0) return " ".repeat(width);
  const filled = Math.round((value / max) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return isTTY ? colors.cyan(bar) : bar;
}

function truncate(text, width) {
  if (text.length <= width) return text.padEnd(width);
  return text.slice(0, width - 3) + "...";
}

// Handle reset
if (reset) {
  if (!confirmReset) {
    console.log("This will permanently delete all tracking data.");
    console.log("Use --yes to skip confirmation.");
    process.exit(1);
  }
  tracker.reset();
  console.log(styled("Token savings stats reset to zero."));
  process.exit(0);
}

// Main output
async function main() {
  const summary = tracker.getSummary();

  if (breakdown === "summary") {
    if (summary.total_operations === 0) {
      console.log("No tracking data yet.");
      console.log("Run MCP ReadEdit commands to start tracking savings.");
      return;
    }

    console.log(styled("MCP ReadEdit Token Savings", true));
    console.log("═".repeat(56));
    console.log();

    printKPI("Total operations", summary.total_operations.toString());
    printKPI("Total files", summary.total_files.toString());
    printKPI("Standard calls", summary.total_standard_calls.toString());
    printKPI("Optimized calls", summary.total_optimized_calls.toString());
    printKPI("Tokens saved", formatTokens(summary.total_tokens_saved));
    printKPI("Calls saved", summary.calls_saved.toString());
    printKPI("Savings rate", `${summary.savings_pct}%`);
    console.log();

    printEfficiencyMeter(parseFloat(summary.savings_pct));
    console.log();

    if (summary.by_tool && summary.by_tool.length > 0) {
      console.log(styled("By Tool", true));
      console.log("─".repeat(56));

      const maxSaved = Math.max(...summary.by_tool.map(t => t.tokens_saved || 0), 1);
      const toolWidth = 18;
      const countW = 8;
      const savedW = 10;
      const pctW = 8;

      console.log(
        "  " + "Tool".padEnd(toolWidth) + 
        "Count".padStart(countW) + "  " +
        "Saved".padStart(savedW) + "  " +
        "Impact".padEnd(pctW)
      );
      console.log("─".repeat(56));

      summary.by_tool.forEach((t, idx) => {
        const tool = truncate(t.tool_name, toolWidth);
        const count = t.count.toString();
        const saved = formatTokens(t.tokens_saved || 0);
        const pct = t.tokens_saved > 0 
          ? ((t.tokens_saved / summary.total_tokens_saved) * 100).toFixed(0) + "%"
          : "0%";
        
        const bar = miniBar(t.tokens_saved || 0, maxSaved, 8);
        console.log(
          `${(idx + 1).toString().padStart(2)}. ` +
          colors.cyan(truncate(tool, toolWidth)) +
          count.padStart(countW) + "  " +
          saved.padStart(savedW) + "  " +
          bar + " " + pct
        );
      });
      console.log();
    }

    console.log(colors.dim("Run 'readedit gain --daily' for day-by-day breakdown"));
    return;
  }

  if (breakdown === "recent") {
    const recent = tracker.getRecent(limit);
    if (recent.length === 0) {
      console.log("No recent operations.");
      return;
    }

    console.log(styled(`Recent Operations (last ${recent.length})`, true));
    console.log("─".repeat(56));

    recent.forEach((rec) => {
      const ts = rec.timestamp ? rec.timestamp.slice(0, 16) : "";
      const tool = truncate(rec.tool_name, 18);
      const files = rec.files_count || 1;
      const saved = formatTokens(rec.estimated_tokens_saved || 0);
      const calls = `${rec.standard_calls - rec.optimized_calls} calls`;

      console.log(
        `${ts} ${colors.cyan(tool)} ${files}f ${saved} (${calls})`
      );
    });
    console.log();
    return;
  }

  if (breakdown === "daily") {
    const daily = tracker.getDaily();
    if (daily.length === 0) {
      console.log("No daily data yet.");
      return;
    }

    console.log(styled("Daily Breakdown", true));
    console.log("─".repeat(56));

    const dayWidth = 12;
    const opsW = 6;
    const filesW = 6;
    const savedW = 10;
    const pctW = 8;

    console.log(
      "  " + "Date".padEnd(dayWidth) +
      "Ops".padStart(opsW) + "  " +
      "Files".padStart(filesW) + "  " +
      "Saved".padStart(savedW) + "  " +
      "Savings%".padEnd(pctW)
    );
    console.log("─".repeat(56));

    daily.forEach((day) => {
      const date = day.day ? day.day.slice(5) : ""; // MM-DD
      const ops = day.operations || 0;
      const files = day.files || 0;
      const saved = formatTokens(day.tokens_saved || 0);
      const pct = day.standard_calls > 0
        ? (((day.standard_calls - day.optimized_calls) / day.standard_calls) * 100).toFixed(1) + "%"
        : "0%";

      console.log(
        `  ${date.padEnd(dayWidth)}` +
        ops.toString().padStart(opsW) + "  " +
        files.toString().padStart(filesW) + "  " +
        saved.padStart(savedW) + "  " +
        colorizePct(parseFloat(pct)).padEnd(pctW)
      );
    });
    console.log();
    return;
  }

  if (breakdown === "all") {
    if (format === "json") {
      const summary = tracker.getSummary();
      const daily = tracker.getDaily();
      console.log(JSON.stringify({
        summary,
        daily
      }, null, 2));
      return;
    }

    if (format === "csv") {
      const daily = tracker.getDaily();
      console.log("# Daily Data");
      console.log("date,operations,files,standard_calls,optimized_calls,saved_tokens,savings_pct");
      daily.forEach((day) => {
        const pct = day.standard_calls > 0
          ? ((day.standard_calls - day.optimized_calls) / day.standard_calls * 100).toFixed(2)
          : "0";
        console.log(
          `${day.day},${day.operations},${day.files},${day.standard_calls},${day.optimized_calls},${day.tokens_saved},${pct}`
        );
      });
      return;
    }

    // Text format for all
    const summary = tracker.getSummary();
    
    // Show summary
    console.log(styled("MCP ReadEdit Token Savings", true));
    console.log("═".repeat(56));
    printKPI("Total operations", summary.total_operations.toString());
    printKPI("Total tokens saved", formatTokens(summary.total_tokens_saved));
    printKPI("Savings rate", `${summary.savings_pct}%`);
    console.log();

    // Show daily
    const daily = tracker.getDaily();
    if (daily.length > 0) {
      console.log(styled("Daily Breakdown", true));
      console.log("─".repeat(56));
      daily.slice(0, 7).forEach((day) => {
        const date = day.day ? day.day.slice(5) : "";
        const saved = formatTokens(day.tokens_saved || 0);
        const pct = day.standard_calls > 0
          ? ((day.standard_calls - day.optimized_calls) / day.standard_calls * 100).toFixed(1) + "%"
          : "0%";
        console.log(`  ${date.padEnd(10)} ${saved.padStart(8)} tokens  ${colorizePct(parseFloat(pct))}`);
      });
      console.log();
    }

    return;
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
