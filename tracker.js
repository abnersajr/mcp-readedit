import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "readedit");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(home, "AppData", "Roaming"),
      "readedit"
    );
  }
  return path.join(home, ".local", "share", "readedit");
}

const DB_PATH = path.join(getDataDir(), "gain.db");

class ReadEditTracker {
  constructor() {
    // Ensure directory exists synchronously — better-sqlite3 requires it at open time
    const dbDir = path.dirname(DB_PATH);
    fs.mkdirSync(dbDir, { recursive: true });

    this.db = new Database(DB_PATH);
    this.initDB();
  }

  initDB() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        tool_name TEXT NOT NULL,
        files_count INTEGER NOT NULL,
        standard_calls INTEGER NOT NULL,
        optimized_calls INTEGER NOT NULL,
        estimated_tokens_saved INTEGER NOT NULL,
        project_path TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_operations_timestamp 
        ON operations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_operations_tool 
        ON operations(tool_name);
    `);
  }

  /**
   * Record an operation
   * @param {string} toolName - Tool used (read_edit, multi_edit, multi_read_edit)
   * @param {number} filesCount - Number of files processed
   * @param {number} standardCalls - Calls needed with standard tools (Read+Edit per file)
   * @param {number} optimizedCalls - Calls actually made (1 for multi_* tools)
   * @param {string} projectPath - Current working directory
   */
  record(toolName, filesCount, standardCalls, optimizedCalls, projectPath = null) {
    // Estimate tokens: ~200 tokens per tool call overhead (JSON formatting, tool result wrapper, etc.)
    const TOKENS_PER_CALL = 200;
    const estimatedTokensSaved = (standardCalls - optimizedCalls) * TOKENS_PER_CALL;

    const stmt = this.db.prepare(`
      INSERT INTO operations (tool_name, files_count, standard_calls, optimized_calls, estimated_tokens_saved, project_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(toolName, filesCount, standardCalls, optimizedCalls, estimatedTokensSaved, projectPath);

    return estimatedTokensSaved;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total_operations,
        SUM(files_count) as total_files,
        SUM(standard_calls) as total_standard_calls,
        SUM(optimized_calls) as total_optimized_calls,
        SUM(estimated_tokens_saved) as total_tokens_saved
      FROM operations
    `);

    const summary = stmt.get();

    // Get breakdown by tool
    const toolStmt = this.db.prepare(`
      SELECT 
        tool_name,
        COUNT(*) as count,
        SUM(files_count) as files,
        SUM(estimated_tokens_saved) as tokens_saved
      FROM operations
      GROUP BY tool_name
      ORDER BY tokens_saved DESC
    `);

    const byTool = toolStmt.all();

    return {
      total_operations: summary.total_operations || 0,
      total_files: summary.total_files || 0,
      total_standard_calls: summary.total_standard_calls || 0,
      total_optimized_calls: summary.total_optimized_calls || 0,
      total_tokens_saved: summary.total_tokens_saved || 0,
      calls_saved: (summary.total_standard_calls || 0) - (summary.total_optimized_calls || 0),
      savings_pct: summary.total_standard_calls > 0 
        ? ((summary.total_standard_calls - summary.total_optimized_calls) / summary.total_standard_calls * 100).toFixed(1)
        : 0,
      by_tool: byTool
    };
  }

  /**
   * Get daily breakdown
   */
  getDaily() {
    const stmt = this.db.prepare(`
      SELECT 
        DATE(timestamp) as day,
        COUNT(*) as operations,
        SUM(files_count) as files,
        SUM(standard_calls) as standard_calls,
        SUM(optimized_calls) as optimized_calls,
        SUM(estimated_tokens_saved) as tokens_saved
      FROM operations
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `);

    return stmt.all();
  }

  /**
   * Get recent operations
   */
  getRecent(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT 
        timestamp,
        tool_name,
        files_count,
        standard_calls,
        optimized_calls,
        estimated_tokens_saved
      FROM operations
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(limit);
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.db.exec("DELETE FROM operations");
    return true;
  }

  close() {
    this.db.close();
  }
}

// Export singleton
const tracker = new ReadEditTracker();
export default tracker;
