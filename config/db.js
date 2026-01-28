// backend/config/db.js
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
    throw new Error("❌ Variables de entorno DB_* no definidas en .env");
  }

  try {
    pool = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      port: DB_PORT || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      timezone: "-05:00"
    });

    // Probar conexión
    const conn = await pool.getConnection();
    console.log(`✅ Conectado a MySQL → Base: ${DB_NAME}`);
    conn.release();

    return pool;

  } catch (err) {
    console.error("❌ Error conectando a MySQL:", err.message);
    process.exit(1);
  }
}

module.exports = { initDB };
