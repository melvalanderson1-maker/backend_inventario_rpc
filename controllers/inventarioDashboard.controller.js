const { initDB } = require("../config/db");

let pool;
(async () => pool = await initDB())();

/* =====================================================
BASE QUERY
===================================================== */

const BASE_QUERY = `

WITH movimientos_lote AS (

SELECT
producto_id,
empresa_id,
almacen_id,
fabricante_id,

MAX(CONVERT_TZ(fecha_validacion_logistica,'+00:00','-05:00')) ultimo_movimiento_lote,

MAX(
CASE 
WHEN tipo_movimiento='salida'
THEN CONVERT_TZ(fecha_validacion_logistica,'+00:00','-05:00')
END
) ultima_salida_lote,

SUM(
CASE 
WHEN tipo_movimiento IN ('entrada','saldo_inicial')
THEN cantidad 
ELSE 0 
END
) total_entradas,

SUM(
CASE 
WHEN tipo_movimiento IN ('entrada','saldo_inicial')
THEN cantidad*precio 
ELSE 0 
END
) total_costo

FROM movimientos_inventario
WHERE estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')

GROUP BY producto_id,empresa_id,almacen_id,fabricante_id
),

lotes_valorizados AS (

SELECT
sp.producto_id,
sp.empresa_id,
sp.almacen_id,
sp.fabricante_id,

sp.cantidad stock_lote,

ml.ultimo_movimiento_lote,
ml.ultima_salida_lote,

ROUND(
COALESCE(ml.total_costo / NULLIF(ml.total_entradas,0),0),
4
) precio_promedio_lote

FROM stock_producto sp

LEFT JOIN movimientos_lote ml
ON ml.producto_id=sp.producto_id
AND ml.empresa_id=sp.empresa_id
AND ml.almacen_id=sp.almacen_id
AND (
(ml.fabricante_id IS NULL AND sp.fabricante_id IS NULL)
OR ml.fabricante_id=sp.fabricante_id
)

)

SELECT

p.codigo codigo_producto,
p.descripcion producto,
p.categoria_id,
c.nombre categoria,

e.nombre empresa,
a.nombre almacen,
f.nombre fabricante,

lv.stock_lote,
lv.precio_promedio_lote,

ROUND(lv.stock_lote*lv.precio_promedio_lote,2) valor_lote,

lv.ultimo_movimiento_lote,

DATEDIFF(CURDATE(),lv.ultimo_movimiento_lote) dias_sin_movimiento,

lv.ultima_salida_lote,

DATEDIFF(
CURDATE(),
COALESCE(lv.ultima_salida_lote,lv.ultimo_movimiento_lote)
) dias_sin_salida,

CASE
WHEN DATEDIFF(CURDATE(),COALESCE(lv.ultima_salida_lote,lv.ultimo_movimiento_lote))>90
THEN '🔴 INVENTARIO INMOVILIZADO'
WHEN DATEDIFF(CURDATE(),COALESCE(lv.ultima_salida_lote,lv.ultimo_movimiento_lote))>30
THEN '🟡 ROTACION LENTA'
ELSE '🟢 ROTACION NORMAL'
END estado_rotacion,

SUM(lv.stock_lote) OVER(PARTITION BY lv.producto_id) stock_total_producto,

ROUND(
SUM(lv.stock_lote*lv.precio_promedio_lote)
OVER(PARTITION BY lv.producto_id),
2
) valor_total_producto

FROM lotes_valorizados lv
JOIN productos p ON p.id=lv.producto_id
JOIN empresas e ON e.id=lv.empresa_id
JOIN almacenes a ON a.id=lv.almacen_id
LEFT JOIN fabricantes f ON f.id=lv.fabricante_id
JOIN categorias c ON c.id = p.categoria_id

WHERE lv.stock_lote>0
AND c.nombre <> 'ETIQUETAS'
AND p.eliminado = 0
AND p.activo = 1
`;

const getFechaFiltro = (req) => {
  let mes = req.query.mes;

  // limpiar basura real
  if (!mes || typeof mes !== "string") {
    mes = null;
  } else {
    mes = mes.trim();
    if (mes === "undefined" || mes === "null" || mes === "") {
      mes = null;
    }
  }

  let inicio, fin;

  if (mes) {

    if (!/^\d{4}-\d{2}$/.test(mes)) {
      throw new Error("Formato inválido (YYYY-MM)");
    }

    const [year, month] = mes.split("-").map(Number);

    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new Error("Mes inválido");
    }

    inicio = `${mes}-01`;

    const lastDay = new Date(year, month, 0);
    fin = lastDay.toISOString().split("T")[0];

  } else {

    const hoy = new Date();

    inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];
  }

  return { inicio, fin };
};
/* =====================================================
FILTRO DINAMICO
===================================================== */

function buildFilteredQuery(req){

  const { categoria } = req.query;

  let query = `SELECT * FROM (${BASE_QUERY}) t`;

  const conditions = [];

  if(categoria){
    conditions.push(`t.categoria_id = ${Number(categoria)}`);
  }

  if(conditions.length > 0){
    query += ` WHERE ` + conditions.join(" AND ");
  }

  return query;
}

function getPagination(req) {
  const page = Number(req.query.page || 0);
  const size = Number(req.query.size || 10);
  const offset = page * size;

  return { page, size, offset };
}


function addPagination(query, req) {
  const page = Number(req.query.page || 0);
  const size = Number(req.query.size || 10);

  const offset = page * size;

  return `${query} LIMIT ${size} OFFSET ${offset}`;
}


function joinImagenProducto() {
  return `
    LEFT JOIN (
      SELECT producto_id, storage_provider, storage_key
      FROM imagenes
      WHERE tipo = 'producto'
      ORDER BY id ASC
    ) img ON img.producto_id = p.id
  `;
}


/* =====================================================
KPIs
===================================================== */
exports.getKPIs = async (req, res) => {
  try {

    // =========================
    // 1. FECHAS (OBLIGATORIO)
    // =========================
    let inicio, fin;

    try {
      ({ inicio, fin } = getFechaFiltro(req));
    } catch (e) {
      return res.status(400).json({
        error: "Mes inválido",
        detalle: e.message
      });
    }

    const filteredQuery = buildFilteredQuery(req);

    const { categoria } = req.query;

    let whereProductos = `
      WHERE eliminado = 0
      AND activo = 1
    `;

    if (categoria) {
      whereProductos += ` AND categoria_id = ${categoria}`;
    }

    // =========================
    // 2. QUERIES EN PARALELO
    // =========================
    const [
      valorInventario,
      inmovilizado,
      productosTotales,
      productosConStock
    ] = await Promise.all([

      // ============================================
      // 🔥 VALOR INVENTARIO (MISMA LÓGICA QUE OFICIAL)
      // ============================================
      pool.query(`
        SELECT ROUND(SUM(t.stock * t.costo), 2) AS total
        FROM (
          SELECT 
            mi.empresa_id,
            mi.almacen_id,
            mi.producto_id,
            mi.stock_resultante AS stock,
            mi.costo_promedio_resultante AS costo
          FROM movimientos_inventario mi
          INNER JOIN (
            SELECT 
              empresa_id,
              almacen_id,
              producto_id,
              MAX(fecha_validacion_logistica) AS max_fecha
            FROM movimientos_inventario
            WHERE 
              estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
              AND fecha_validacion_logistica <= ?
            GROUP BY empresa_id, almacen_id, producto_id, fabricante_id
          ) ult
          ON mi.empresa_id = ult.empresa_id
          AND mi.almacen_id = ult.almacen_id
          AND mi.fabricante_id = ult.fabricante_id
          AND mi.producto_id = ult.producto_id
          AND mi.fecha_validacion_logistica = ult.max_fecha
        ) t
      `, [fin]),   // 🔥 CLAVE: PARAMETRO CORRECTO


      // ============================================
      // INVENTARIO INMOVILIZADO
      // ============================================
      pool.query(`
        SELECT COUNT(*) total
        FROM (${filteredQuery}) t
        WHERE estado_rotacion = '🔴 INVENTARIO INMOVILIZADO'
      `),


      // ============================================
      // TOTAL PRODUCTOS
      // ============================================
      pool.query(`
        SELECT COUNT(*) total
        FROM productos
        ${whereProductos}
      `),


      // ============================================
      // PRODUCTOS CON STOCK
      // ============================================
      pool.query(`
        SELECT COUNT(DISTINCT codigo_producto) total
        FROM (${filteredQuery}) t
        WHERE stock_lote > 0
      `)

    ]);

    // =========================
    // 3. RESPUESTA FINAL
    // =========================
    res.json({
      productos: productosTotales[0][0].total,
      productos_con_stock: productosConStock[0][0].total,
      valor: Number(valorInventario[0][0].total || 0),
      inmovilizado: inmovilizado[0][0].total
    });

  } catch (err) {

    console.error("🔥 ERROR KPIs:", err);

    res.status(500).json({
      error: "Error KPIs",
      detalle: err.sqlMessage || err.message
    });

  }
};


exports.getMovimientosProducto = async (req, res) => {
  try {

    const productoId = req.params.id;

    const [rows] = await pool.query(`
      SELECT
        m.id,
        m.tipo_movimiento,
        m.cantidad,
        m.precio,
        m.estado,
        CONVERT_TZ(m.fecha_validacion_logistica,'+00:00','-05:00') fecha

      FROM movimientos_inventario m
      WHERE m.producto_id = ?
      AND m.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')

      ORDER BY m.fecha_validacion_logistica DESC
      LIMIT 50
    `, [productoId]);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error movimientos producto" });
  }
};








/* =====================================================
RESUMEN POR CATEGORIA
===================================================== */

exports.getCategoriasResumen = async (req,res)=>{

try{

const filteredQuery = buildFilteredQuery(req);

const [rows] = await pool.query(`

SELECT
categoria_id,
categoria,

SUM(stock_lote) stock_total,

ROUND(SUM(valor_lote),2) valor_total

FROM (${filteredQuery}) t

GROUP BY categoria_id,categoria

ORDER BY stock_total DESC

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error categorias resumen"});

}

};


/* =====================================================
TOP PRODUCTOS VALOR
===================================================== */

exports.getTopProductosValor = async (req, res) => {
  try {

    const { size, offset } = getPagination(req);
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    const filteredQuery = buildFilteredQuery(req);

    const [rows] = await pool.query(`
      SELECT
        codigo_producto,
        producto,
        MAX(stock_total_producto) stock_total_producto,
        MAX(valor_total_producto) valor_total_producto
      FROM (${filteredQuery}) t
      GROUP BY codigo_producto, producto
      ORDER BY valor_total_producto ${order}
      LIMIT ? OFFSET ?
    `, [size, offset]);

    const [countRows] = await pool.query(`
      SELECT COUNT(*) total FROM (
        SELECT codigo_producto
        FROM (${filteredQuery}) t
        GROUP BY codigo_producto
      ) x
    `);

    const total = countRows[0].total;

    res.json({
      data: rows,
      hasMore: offset + size < total,
      total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error top productos valor" });
  }
};

/* =====================================================
ROTACION
===================================================== */

exports.getRotacion = async (req,res)=>{

try{

const filteredQuery = buildFilteredQuery(req);

const [rows] = await pool.query(`

SELECT
estado_rotacion estado,
COUNT(*) total

FROM (${filteredQuery}) t

GROUP BY estado_rotacion

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error rotacion"});

}

};


/* =====================================================
INVENTARIO
===================================================== */
exports.getInventario = async (req, res) => {
  try {

    const { size, offset } = getPagination(req);
    const { producto, tipo } = req.query;

    const baseQuery = buildFilteredQuery(req);

    // 🔥 CONDICIONES SEGURAS
    const conditions = [];

    if (producto) {
      conditions.push(`t.codigo_producto = ?`);
    }

    let finalQuery = `
      SELECT *
      FROM (${baseQuery}) t
    `;

    if (conditions.length > 0) {
      finalQuery += ` WHERE ` + conditions.join(" AND ");
    }

    // 🔥 ORDEN DINÁMICO
    if (tipo === "stock") {
      finalQuery += ` ORDER BY t.stock_total_producto DESC`;
    } else {
      finalQuery += ` ORDER BY t.valor_total_producto DESC`;
    }

    finalQuery += ` LIMIT ? OFFSET ?`;

    // 🔥 PARAMETROS DINÁMICOS
    const params = [];

    if (producto) {
      params.push(producto);
    }

    params.push(size, offset);

    const [rows] = await pool.query(finalQuery, params);

    // 🔥 COUNT (MISMA CONDICIÓN)
    let countQuery = `
      SELECT COUNT(*) total
      FROM (${baseQuery}) t
    `;

    const countParams = [];

    if (producto) {
      countQuery += ` WHERE t.codigo_producto = ?`;
      countParams.push(producto);
    }

    const [countRows] = await pool.query(countQuery, countParams);

    const total = countRows[0].total;

    res.json({
      data: rows,
      hasMore: offset + size < total,
      total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error inventario" });
  }
};
/* =====================================================
PRODUCTOS POR STOCK
===================================================== */

exports.getProductosStock = async (req, res) => {
  try {

    const { size, offset } = getPagination(req);
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    const filteredQuery = buildFilteredQuery(req);

    const [rows] = await pool.query(`
      SELECT
        codigo_producto,
        producto,
        MAX(stock_total_producto) stock_total_producto,
        MAX(valor_total_producto) valor_total_producto
      FROM (${filteredQuery}) t
      GROUP BY codigo_producto, producto
      ORDER BY stock_total_producto ${order}
      LIMIT ? OFFSET ?
    `, [size, offset]);

    const [countRows] = await pool.query(`
      SELECT COUNT(*) total FROM (
        SELECT codigo_producto
        FROM (${filteredQuery}) t
        GROUP BY codigo_producto
      ) x
    `);

    const total = countRows[0].total;

    res.json({
      data: rows,
      hasMore: offset + size < total,
      total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error productos stock" });
  }
};


/* =====================================================
VALOR POR EMPRESA
===================================================== */

exports.getValorPorEmpresa = async (req,res)=>{

try{

const filteredQuery = buildFilteredQuery(req);

const [rows] = await pool.query(`

SELECT
empresa,
ROUND(SUM(valor_lote),2) valor_inventario

FROM (${filteredQuery}) t

GROUP BY empresa
ORDER BY valor_inventario DESC

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error valor empresa"});

}

};


/* =====================================================
ABC INVENTARIO (PARETO)
===================================================== */

exports.getABCInventario = async (req,res)=>{

try{

const filteredQuery = buildFilteredQuery(req);

const [rows] = await pool.query(`

WITH productos_valor AS (

SELECT
codigo_producto,
producto,
MAX(valor_total_producto) valor_total_producto

FROM (${filteredQuery}) t

GROUP BY codigo_producto,producto

),

ordenados AS (

SELECT
*,
SUM(valor_total_producto) OVER() total_inventario,
SUM(valor_total_producto) OVER(ORDER BY valor_total_producto DESC) acumulado

FROM productos_valor

),

clasificacion AS (

SELECT
*,

(acumulado/total_inventario)*100 porcentaje_acumulado

FROM ordenados

)

SELECT

CASE
WHEN porcentaje_acumulado <=80 THEN 'A'
WHEN porcentaje_acumulado <=95 THEN 'B'
ELSE 'C'
END categoria,

COUNT(*) productos,
ROUND(SUM(valor_total_producto),2) valor

FROM clasificacion

GROUP BY categoria

ORDER BY categoria

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error ABC inventario"});

}

};


/* =====================================================
HEATMAP ALMACENES
===================================================== */

exports.getHeatmapAlmacenes = async (req,res)=>{
  try{

    const filteredQuery = buildFilteredQuery(req);

    const [rows] = await pool.query(`
      SELECT
        almacen,
        ROUND(SUM(valor_lote),2) valor_inventario
      FROM (${filteredQuery}) t
      GROUP BY almacen
      ORDER BY valor_inventario DESC
    `);

    res.json(rows);

  }catch(err){
    console.error(err);
    res.status(500).json({error:"Error heatmap almacenes"});
  }
}; // ✅ ← ESTE ES EL IMPORTANTE


exports.getEvolucionInventario = async (req, res) => {
  try {

    let inicio, fin;

    // =========================
    // 1. VALIDACIÓN FECHAS
    // =========================
    try {
      ({ inicio, fin } = getFechaFiltro(req));
    } catch (e) {
      return res.status(400).json({
        error: "Parámetro mes inválido",
        detalle: e.message
      });
    }

    // =====================================================
    // 2. SNAPSHOT INICIAL (seguro, sin JOIN peligroso)
    // =====================================================
    const [previos] = await pool.query(`
      SELECT 
        empresa_id,
        almacen_id,
        producto_id,
        fabricante_id,
        stock_resultante,
        costo_promedio_resultante
      FROM movimientos_inventario
      WHERE 
        estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
        AND fecha_validacion_logistica = (
          SELECT MAX(fecha_validacion_logistica)
          FROM movimientos_inventario mi2
          WHERE 
            mi2.empresa_id = movimientos_inventario.empresa_id
            AND mi2.almacen_id = movimientos_inventario.almacen_id
            AND mi2.fabricante_id = movimientos_inventario.fabricante_id
            AND mi2.producto_id = movimientos_inventario.producto_id
            AND mi2.fecha_validacion_logistica < ?
        )
    `, [inicio]);

    const estado = {};
    let totalGlobal = 0;

    for (const mov of previos) {

      const stock = Number(mov.stock_resultante ?? 0);
      const costo = Number(mov.costo_promedio_resultante ?? 0);

      const valor = stock * costo;

      const key = `${mov.empresa_id}|${mov.almacen_id}|${mov.producto_id}|${mov.fabricante_id}`;

      estado[key] = valor;
      totalGlobal += valor;
    }

    // =====================================================
    // 3. MOVIMIENTOS DEL PERIODO (orden seguro)
    // =====================================================
    const [rows] = await pool.query(`
      SELECT 
        empresa_id,
        almacen_id,
        fabricante_id,
        producto_id,
        fecha_validacion_logistica,
        stock_resultante,
        costo_promedio_resultante
      FROM movimientos_inventario
      WHERE 
        estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
        AND fecha_validacion_logistica BETWEEN ? AND ?
      ORDER BY fecha_validacion_logistica ASC, id ASC
    `, [inicio, fin]);

    const resultado = [];

    // =====================================================
    // 4. EVOLUCIÓN SEGURA
    // =====================================================
    for (const mov of rows) {

      const stock = Number(mov.stock_resultante ?? 0);
      const costo = Number(mov.costo_promedio_resultante ?? 0);

      const valorNuevo = stock * costo;

      const key = `${mov.empresa_id}|${mov.almacen_id}|${mov.producto_id}|${mov.fabricante_id}`;

      const valorAnterior = estado[key] ?? 0;

      estado[key] = valorNuevo;

      totalGlobal = totalGlobal - valorAnterior + valorNuevo;

      resultado.push({
        fecha: mov.fecha_validacion_logistica,
        total: Number(totalGlobal.toFixed(2))
      });
    }

    // =========================
    // 5. RESPUESTA
    // =========================
    return res.json(resultado);

  } catch (err) {
    console.error("🔥 ERROR EVOLUCIÓN INVENTARIO:", err);

    return res.status(500).json({
      error: "Error evolución inventario",
      detalle: err.sqlMessage || err.message
    });
  }
};


// =====================================================
// ENTRADAS Y SALIDAS
// =====================================================
exports.getEntradasSalidasMes = async (req, res) => {
  try {

    const { inicio, fin } = getFechaFiltro(req);

    const [[row]] = await pool.query(`
      SELECT
        COUNT(CASE WHEN tipo_movimiento = 'saldo_inicial' THEN 1 END) inicializaciones,

        COUNT(CASE WHEN tipo_movimiento = 'entrada' THEN 1 END) entradas,
        COUNT(CASE WHEN tipo_movimiento = 'salida' THEN 1 END) salidas,

        SUM(CASE WHEN tipo_movimiento = 'saldo_inicial' THEN cantidad ELSE 0 END) cant_inicial,
        SUM(CASE WHEN tipo_movimiento = 'entrada' THEN cantidad ELSE 0 END) cant_entradas,
        SUM(CASE WHEN tipo_movimiento = 'salida' THEN cantidad ELSE 0 END) cant_salidas

      FROM movimientos_inventario
      WHERE 
        estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
        AND fecha_validacion_logistica >= ?
        AND fecha_validacion_logistica < DATE_ADD(?, INTERVAL 1 DAY)
    `, [inicio, fin]);

    res.json(row);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error entradas/salidas" });
  }
};


// =====================================================
// VALOR INVENTARIO
// =====================================================
exports.getValorInventario = async (req, res) => {
  try {

    let inicio, fin;

    try {
      ({ inicio, fin } = getFechaFiltro(req));
    } catch (e) {
      return res.status(400).json({
        error: "Mes inválido",
        detalle: e.message
      });
    }

    // =====================================================
    // 🔥 VALOR FINAL CORRECTO (CORTE AL FIN DEL MES)
    // =====================================================
    const [rows] = await pool.query(`
      SELECT SUM(t.stock * t.costo) AS total
      FROM (
        SELECT 
          mi.empresa_id,
          mi.almacen_id,
          mi.producto_id,
          mi.stock_resultante AS stock,
          mi.costo_promedio_resultante AS costo
        FROM movimientos_inventario mi
        INNER JOIN (
          SELECT 
            empresa_id,
            almacen_id,
            producto_id,
            fabricante_id,
            MAX(fecha_validacion_logistica) AS max_fecha
          FROM movimientos_inventario
          WHERE 
            estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
            AND fecha_validacion_logistica <= ?
          GROUP BY empresa_id, almacen_id, producto_id, fabricante_id
        ) ult
        ON mi.empresa_id = ult.empresa_id
        AND mi.almacen_id = ult.almacen_id
        AND mi.fabricante_id = ult.fabricante_id
        AND mi.producto_id = ult.producto_id
        AND mi.fecha_validacion_logistica = ult.max_fecha
      ) t
    `, [fin]);

    const valorFinal = rows[0]?.total || 0;

    // =====================================================
    // 🔥 VALOR INICIAL (CORTE INICIO MES)
    // =====================================================
    const [rowsIni] = await pool.query(`
      SELECT SUM(t.stock * t.costo) AS total
      FROM (
        SELECT 
          mi.empresa_id,
          mi.almacen_id,
          mi.producto_id,
          mi.stock_resultante AS stock,
          mi.costo_promedio_resultante AS costo
        FROM movimientos_inventario mi
        INNER JOIN (
          SELECT 
            empresa_id,
            almacen_id,
            producto_id,
            MAX(fecha_validacion_logistica) AS max_fecha
          FROM movimientos_inventario
          WHERE 
            estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
            AND fecha_validacion_logistica <= ?
          GROUP BY empresa_id, almacen_id, producto_id, fabricante_id
        ) ult
        ON mi.empresa_id = ult.empresa_id
        AND mi.almacen_id = ult.almacen_id
        AND mi.producto_id = ult.producto_id
        AND mi.fabricante_id = ult.fabricante_id
        AND mi.fecha_validacion_logistica = ult.max_fecha
      ) t
    `, [inicio]);

    const valorInicial = rowsIni[0]?.total || 0;

    return res.json({
      valor_inicial: valorInicial,
      valor_final: valorFinal,
      variacion: valorFinal - valorInicial
    });

  } catch (err) {
    console.error("ERROR VALOR INVENTARIO:", err);
    return res.status(500).json({
      error: "Error valor inventario",
      detalle: err.sqlMessage || err.message
    });
  }
};


// =====================================================
// STOCK INICIAL
// =====================================================
exports.getStockInicial = async (req, res) => {
  try {

    const { inicio } = getFechaFiltro(req);

    const [rows] = await pool.query(`
      SELECT SUM(stock) AS total
      FROM (
        SELECT 
          empresa_id,
          almacen_id,
          producto_id,
          SUM(
            CASE 
              WHEN tipo_movimiento IN ('entrada','saldo_inicial') THEN cantidad
              WHEN tipo_movimiento = 'salida' THEN -cantidad
            END
          ) AS stock
        FROM movimientos_inventario
        WHERE 
          estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
          AND fecha_validacion_logistica < ?
        GROUP BY empresa_id, almacen_id, producto_id, fabricante_id
      ) t
    `, [inicio]);

    res.json({ stock_inicial: rows[0]?.total || 0 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error stock inicial" });
  }
};

exports.getSinMovimiento = async (req, res) => {
  try {

    const dias = Number(req.query.dias || 30);

    const [rows] = await pool.query(`
      SELECT 
        t.*,
        img.storage_provider,
        img.storage_key
      FROM (${buildFilteredQuery(req)}) t
      JOIN productos p ON p.codigo = t.codigo_producto
      LEFT JOIN imagenes img 
        ON img.producto_id = p.id AND img.tipo='producto'

      WHERE t.dias_sin_movimiento > ?

      ORDER BY t.dias_sin_movimiento DESC
    `, [dias]);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error sin movimiento" });
  }
};


exports.getRankingAntiguedad = async (req, res) => {
  try {

    const { size, offset } = getPagination(req);

    const [rows] = await pool.query(`
      SELECT
        t.codigo_producto,
        t.producto,

        img.storage_provider,
        img.storage_key,

        MAX(t.dias_sin_movimiento) dias_max,
        MAX(t.valor_total_producto) valor_total_producto

      FROM (${buildFilteredQuery(req)}) t
      JOIN productos p ON p.codigo = t.codigo_producto
      LEFT JOIN imagenes img 
        ON img.producto_id = p.id AND img.tipo='producto'

      GROUP BY 
        t.codigo_producto, 
        t.producto, 
        img.storage_provider, 
        img.storage_key

      ORDER BY dias_max DESC

      LIMIT ? OFFSET ?
    `, [size, offset]);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error ranking antiguedad" });
  }
};