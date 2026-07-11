import { readFileSync } from "fs";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
await pool.query(sql);
console.log("schema applied");
await pool.end();
