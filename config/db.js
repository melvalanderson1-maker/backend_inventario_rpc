const mysql = require("mysql2/promise");

let pool;

async function initDB() {
  if (pool) return pool;

  const {
    DB_HOST,
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
    DB_PORT
  } = process.env;

  if (!DB_HOST || !DB_USER || !DB_NAME) {
    throw new Error("❌ Variables de entorno DB_* no definidas");
  }

  pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    port: DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Test conexión SIN matar proceso
  try {
    const conn = await pool.getConnection();
    console.log(`✅ MySQL conectado → ${DB_NAME}`);
    conn.release();
  } catch (err) {
    console.error("🔥 MySQL NO disponible:", err.message);
  }

  return pool;
}

module.exports = { initDB };
