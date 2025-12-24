import { defineConfig } from "drizzle-kit";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use DATABASE_URL if provided, otherwise use local file
const dbPath = process.env.DATABASE_URL 
  ? process.env.DATABASE_URL.replace(/^file:/, "")
  : path.join(__dirname, "fluxcal.db");

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
