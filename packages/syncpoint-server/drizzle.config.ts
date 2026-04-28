import { defineConfig } from "drizzle-kit";
import path from "node:path";
import os from "node:os";

const dbPath = path.join(
  process.env.SYNCPOINT_DB_DIR ?? path.join(os.homedir(), ".syncpoint"),
  "syncpoint.db"
);

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
