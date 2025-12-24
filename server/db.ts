import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use DATABASE_URL if provided (for compatibility), otherwise use local file
const dbPath = process.env.DATABASE_URL 
  ? process.env.DATABASE_URL.replace(/^file:/, "") // Remove file: prefix if present
  : path.join(__dirname, "../fluxcal.db");

// Ensure directory exists
const dbDir = path.dirname(dbPath);
try {
  mkdirSync(dbDir, { recursive: true });
} catch (error: any) {
  // Ignore if directory already exists
  if (error.code !== "EEXIST") {
    throw error;
  }
}

// Create SQLite database connection
const sqlite = new Database(dbPath);

// Enable foreign keys
sqlite.pragma("foreign_keys = ON");

// For Drizzle ORM queries
export const db = drizzle(sqlite);
