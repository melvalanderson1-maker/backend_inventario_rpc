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
TOP PRODUCTOS POR VALOR
================================ */
exports.topProductosValor = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        p.id,
        p.codigo,
        p.descripcion,
        SUM(sp.cantidad * sp.precio_promedio) valor_total
      FROM stock_producto sp
      JOIN productos p ON p.id = sp.producto_id
      GROUP BY p.id
      ORDER BY valor_total DESC
      LIMIT 10
    `);

    res.json(rows);

  } catch (e) {
    console.error("❌ TOP VALOR ERROR:", e);
    res.status(500).json(e);
  }
};

/* ===============================
TOP STOCK
================================ */
exports.topProductosStock = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        p.id,
        p.codigo,
        p.descripcion,
        SUM(sp.cantidad) stock_total
      FROM stock_producto sp
      JOIN productos p ON p.id = sp.producto_id
      GROUP BY p.id
      ORDER BY stock_total DESC
      LIMIT 10
    `);

    res.json(rows);

  } catch (e) {
    console.error("❌ TOP STOCK ERROR:", e);
    res.status(500).json(e);
  }
};

/* ===============================
STOCK BAJO
================================ */
exports.productosStockBajo = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        p.id,
        p.codigo,
        p.descripcion,
        SUM(sp.cantidad) stock_total
      FROM stock_producto sp
      JOIN productos p ON p.id = sp.producto_id
      GROUP BY p.id
      ORDER BY stock_total ASC
      LIMIT 10
    `);

    res.json(rows);

  } catch (e) {
    console.error("❌ STOCK BAJO ERROR:", e);
    res.status(500).json(e);
  }
};

/* ===============================
INVENTARIO POR ALMACÉN
================================ */
exports.inventarioPorAlmacen = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        a.nombre,
        SUM(sp.cantidad * sp.precio_promedio) valor
      FROM stock_producto sp
      JOIN almacenes a ON a.id = sp.almacen_id
      GROUP BY a.id
      ORDER BY valor DESC
    `);

    res.json(rows);

  } catch (e) {
    console.error("❌ ALMACEN ERROR:", e);
    res.status(500).json(e);
  }
};

/* ===============================
ROTACIÓN
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
    console.error("❌ ROTACION ERROR:", e);
    res.status(500).json(e);
  }
};

/* ===============================
PRODUCTOS SIN MOVIMIENTO
================================ */
exports.productosSinMovimiento = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        p.id,
        p.codigo,
        p.descripcion,
        DATEDIFF(CURDATE(), MAX(mi.fecha_validacion_logistica)) dias
      FROM movimientos_inventario mi
      JOIN productos p ON p.id = mi.producto_id
      GROUP BY p.id
      ORDER BY dias DESC
      LIMIT 20
    `);

    res.json(rows);

  } catch (e) {
    console.error("❌ SIN MOVIMIENTO ERROR:", e);
    res.status(500).json(e);
  }
};

/* ===============================
DETALLE LOTES
================================ */
exports.detalleLotesProducto = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT *
      FROM stock_producto
      WHERE producto_id = ?
      AND cantidad > 0
    `, [id]);

    res.json(rows);

  } catch (e) {
    console.error("❌ LOTES ERROR:", e);
    res.status(500).json(e);
  }
};