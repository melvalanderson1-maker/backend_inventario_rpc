const { initDB } = require("../config/db");

let db;

(async () => {
  db = await initDB();
})();

/* ===============================
KPIs
================================ */
exports.getKPIs = async (req, res) => {
  try {
    const [productos] = await db.query(`
      SELECT COUNT(*) total FROM productos
    `);

    const [conStock] = await db.query(`
      SELECT COUNT(DISTINCT producto_id) total
      FROM stock_producto
      WHERE cantidad > 0
    `);

    const [valorInventario] = await db.query(`
      SELECT SUM(cantidad * precio_promedio) valor
      FROM stock_producto
    `);

    const [sinMovimiento] = await db.query(`
      SELECT COUNT(*) total FROM (
        SELECT producto_id,
        MAX(fecha_validacion_logistica) ultima_fecha
        FROM movimientos_inventario
        GROUP BY producto_id
        HAVING DATEDIFF(CURDATE(), ultima_fecha) > 90
      ) t
    `);

    res.json({
      productos_registrados: productos[0].total,
      productos_con_stock: conStock[0].total,
      valor_inventario: valorInventario[0].valor || 0,
      productos_sin_movimiento: sinMovimiento[0].total
    });

  } catch (error) {
    console.error("❌ KPIs ERROR:", error);
    res.status(500).json({ error: "Error KPIs" });
  }
};

/* ===============================
TOP PRODUCTOS VALOR
================================ */
exports.topProductosValor = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.id, p.codigo, p.descripcion,
      SUM(sp.cantidad * sp.precio_promedio) valor_total
      FROM stock_producto sp
      JOIN productos p ON p.id = sp.producto_id
      GROUP BY p.id
      ORDER BY valor_total DESC
      LIMIT 10
    `);

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json(e);
  }
};

/* ===============================
ROTACION
================================ */
exports.rotacionInventario = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT estado_rotacion, COUNT(*) cantidad
      FROM inventario_resumen
      GROUP BY estado_rotacion
    `);

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json(e);
  }
};