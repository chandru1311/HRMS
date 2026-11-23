import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import dns from "node:dns";
import { fileURLToPath } from "url";

// Prioritize IPv4 to avoid NAT64/IPv6 proxy timeouts on cellular/Wi-Fi networks
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const { Pool } = pg;

const DEFAULT_DB_URL = "postgresql://postgres:wbmoHIZoKMKVvFhmAHgDYLUdVhZCcTzq@kodama.proxy.rlwy.net:52896/railway";
const activeDbUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;

const pool = new Pool({
  connectionString: activeDbUrl,
  ssl: { rejectUnauthorized: false },
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on("connect", (client) => {
  // connection established
});

pool.on("error", (err, client) => {
  console.warn("⚠️ PostgreSQL client warning/drop:", err.message);
});

export const query = async (text, params) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      const isTransient = err.code === 'ECONNRESET' ||
        err.code === '57P01' ||
        (err.message && (
          err.message.includes("timeout") ||
          err.message.includes("Connection terminated") ||
          err.message.includes("closed") ||
          err.message.includes("ECONNRESET") ||
          err.message.includes("Connection ended")
        ));
      if (isTransient && attempt < 2) {
        console.warn(`⚠️ Retrying query after connection issue (attempt ${attempt + 1}/3):`, text.slice(0, 50));
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
};
export default pool;
