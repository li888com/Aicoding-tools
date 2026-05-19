import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { getDatabaseConfig } from "../src/config.js";

const migrationFile = process.argv[2];

if (!migrationFile) {
  throw new Error("Usage: tsx scripts/run-migration.ts <sql-file>");
}

const sql = await readFile(migrationFile, "utf8");
const config = getDatabaseConfig();
const connection = await mysql.createConnection({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  timezone: "Z",
  multipleStatements: true
});

try {
  await connection.query(sql);
  console.log(`Applied migration: ${migrationFile}`);
} finally {
  await connection.end();
}
