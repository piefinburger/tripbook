import pg from "pg";
let pool;
export function db() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}
export async function q(text, params) {
  return (await db().query(text, params)).rows;
}
