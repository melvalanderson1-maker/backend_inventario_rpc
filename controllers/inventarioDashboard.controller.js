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
) ultima_salida_lote

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

sp.cantidad AS stock_lote,
sp.costo_promedio AS precio_promedio_lote,
sp.valor_stock AS valor_lote,

ml.ultimo_movimiento_lote,
ml.ultima_salida_lote

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
lv.valor_lote,

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
SUM(lv.valor_lote) OVER(PARTITION BY lv.producto_id),
2
) valor_total_producto

FROM lotes_valorizados lv
JOIN productos p ON p.id=lv.producto_id
JOIN empresas e ON e.id=lv.empresa_id
JOIN almacenes a ON a.id=lv.almacen_id
LEFT JOIN fabricantes f ON f.id=lv.fabricante_id
JOIN categorias c ON c.id = p.categoria_id

WHERE 
lv.stock_lote > 0
AND p.categoria_id NOT IN (18, 33) -- 🔥 CORRECTO
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
    fin = `${mes}-${String(lastDay.getDate()).padStart(2,'0')} 23:59:59`;

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




const queryValorPorFecha = `
SELECT 
  ROUND(SUM(t.stock * t.costo), 2) AS total
FROM (
  SELECT 
    mi.producto_id,
    mi.empresa_id,
    mi.almacen_id,
    IFNULL(mi.fabricante_id,0) fabricante_id,

    mi.stock_resultante AS stock,
    mi.costo_promedio_resultante AS costo,

    ROW_NUMBER() OVER (
      PARTITION BY 
        mi.producto_id, 
        mi.empresa_id, 
        mi.almacen_id, 
        IFNULL(mi.fabricante_id,0)
      ORDER BY 
        mi.fecha_validacion_logistica DESC, 
        mi.id DESC
    ) AS rn

  FROM movimientos_inventario mi
  INNER JOIN productos p ON p.id = mi.producto_id

  WHERE 
    mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')

    -- 🔥 CORRECCIÓN REAL
    AND mi.fecha_validacion_logistica <= CONCAT(?, ' 23:59:59')

    AND p.categoria_id NOT IN (18, 33)
    AND p.eliminado = 0
    AND p.activo = 1

) t
WHERE t.rn = 1
`;
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
s
KPI===================================================== */
exports.getKPIs = async (req, res) => {
  try {

    const { categoria } = req.query;

    let whereProductos = `
      WHERE eliminado = 0
      AND activo = 1
    `;

    if (categoria) {
      whereProductos += ` AND categoria_id = ${categoria}`;
    }

    // 🔥 FECHA ACTUAL (IMPORTANTE)
    const hoy = new Date().toISOString().split("T")[0];

    // 🔥 CLONAMOS queryValorPorFecha PERO SIN PARAMETRO EXTERNO
    const queryValorActual = `
      SELECT 
        ROUND(SUM(t.stock * t.costo), 2) AS total
      FROM (
        SELECT 
          mi.producto_id,
          mi.empresa_id,
          mi.almacen_id,
          IFNULL(mi.fabricante_id,0) fabricante_id,

          mi.stock_resultante AS stock,
          mi.costo_promedio_resultante AS costo,

          ROW_NUMBER() OVER (
            PARTITION BY 
              mi.producto_id, 
              mi.empresa_id, 
              mi.almacen_id, 
              IFNULL(mi.fabricante_id,0)
            ORDER BY 
              mi.fecha_validacion_logistica DESC, 
              mi.id DESC
          ) AS rn

        FROM movimientos_inventario mi
        INNER JOIN productos p ON p.id = mi.producto_id

        WHERE 
          mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')

          -- 🔥 ESTADO ACTUAL REAL
          AND mi.fecha_validacion_logistica <= CONCAT(?, ' 23:59:59')

          AND p.categoria_id NOT IN (18, 33)
          AND p.eliminado = 0
          AND p.activo = 1

      ) t
      WHERE t.rn = 1
    `;

    const [
      valorInventario,
      productosTotales,
      productosConStock
    ] = await Promise.all([

      // ✅ NUEVO VALOR CORRECTO
      pool.query(queryValorActual, [hoy]),

      // TOTAL PRODUCTOS
      pool.query(`
        SELECT COUNT(*) total
        FROM productos
        ${whereProductos}
      `),

      // PRODUCTOS CON STOCK (también corregido)
      pool.query(`
        SELECT COUNT(*) total
        FROM (
          SELECT 
            mi.producto_id,
            mi.empresa_id,
            mi.almacen_id,
            IFNULL(mi.fabricante_id,0) fabricante_id,

            mi.stock_resultante,

            ROW_NUMBER() OVER (
              PARTITION BY 
                mi.producto_id, 
                mi.empresa_id, 
                mi.almacen_id, 
                IFNULL(mi.fabricante_id,0)
              ORDER BY 
                mi.fecha_validacion_logistica DESC, 
                mi.id DESC
            ) rn

          FROM movimientos_inventario mi
          INNER JOIN productos p ON p.id = mi.producto_id

          WHERE 
            mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
            AND mi.fecha_validacion_logistica <= CONCAT(?, ' 23:59:59')
            AND p.categoria_id NOT IN (18, 33)
            AND p.eliminado = 0
            AND p.activo = 1

        ) t
        WHERE rn = 1 AND stock_resultante > 0
      `, [hoy])

    ]);

    res.json({
      productos: productosTotales[0][0].total,
      productos_con_stock: productosConStock[0][0].total,
      valor: Number(valorInventario[0][0].total || 0)
    });

  } catch (err) {
    console.error("🔥 ERROR KPIs:", err);
    res.status(500).json({
      error: "Error KPIs",
      detalle: err.message
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

    const { inicio, fin } = getFechaFiltro(req);

    const [rows] = await pool.query(`
      WITH fechas AS (
        SELECT DISTINCT DATE(mi.fecha_validacion_logistica) fecha
        FROM movimientos_inventario mi
        INNER JOIN productos p ON p.id = mi.producto_id
        WHERE 
          mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
          AND mi.fecha_validacion_logistica BETWEEN ? AND ?
          AND p.categoria_id NOT IN (18, 33)
      ),

      ultimos AS (
        SELECT 
          f.fecha,

          mi.producto_id,
          mi.empresa_id,
          mi.almacen_id,
          IFNULL(mi.fabricante_id,0) fabricante_id,

          mi.stock_resultante stock,
          mi.costo_promedio_resultante costo,

          ROW_NUMBER() OVER (
            PARTITION BY 
              f.fecha,
              mi.producto_id,
              mi.empresa_id,
              mi.almacen_id,
              IFNULL(mi.fabricante_id,0)
            ORDER BY mi.fecha_validacion_logistica DESC, mi.id DESC
          ) rn

        FROM fechas f
        JOIN movimientos_inventario mi
          ON mi.fecha_validacion_logistica <= CONCAT(f.fecha,' 23:59:59')

        JOIN productos p ON p.id = mi.producto_id

        WHERE 
          mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
          AND p.categoria_id NOT IN (18, 33)
          AND p.eliminado = 0
          AND p.activo = 1
      )

      SELECT 
        fecha,
        ROUND(SUM(stock * costo),2) total
      FROM ultimos
      WHERE rn = 1
      GROUP BY fecha
      ORDER BY fecha
    `, [inicio, fin]);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error evolución inventario" });
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

      -- 🔵 KPI 1: NÚMERO DE MOVIMIENTOS
      COUNT(CASE WHEN mi.tipo_movimiento = 'saldo_inicial' THEN 1 END) movimientos_inicial,
      COUNT(CASE WHEN mi.tipo_movimiento = 'entrada' THEN 1 END) movimientos_entrada,
      COUNT(CASE WHEN mi.tipo_movimiento = 'salida' THEN 1 END) movimientos_salida,

      -- 🟢 KPI 2: CANTIDAD REAL MOVIDA
      SUM(CASE WHEN mi.tipo_movimiento = 'saldo_inicial' THEN mi.cantidad ELSE 0 END) unidades_inicial,
      SUM(CASE WHEN mi.tipo_movimiento = 'entrada' THEN mi.cantidad ELSE 0 END) unidades_entrada,
      SUM(CASE WHEN mi.tipo_movimiento = 'salida' THEN mi.cantidad ELSE 0 END) unidades_salida

      FROM movimientos_inventario mi
      INNER JOIN productos p ON p.id = mi.producto_id
      WHERE 
        mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
        AND mi.fecha_validacion_logistica BETWEEN ? AND ?
        AND p.categoria_id NOT IN (18, 33) -- 🔥 CLAVE
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
    ({ inicio, fin } = getFechaFiltro(req));

    const [finRows] = await pool.query(queryValorPorFecha, [fin]);
    const [iniRows] = await pool.query(queryValorPorFecha, [inicio]);

    const valorFinal = Number(finRows[0]?.total || 0);
    const valorInicial = Number(iniRows[0]?.total || 0);

    return res.json({
      valor_inicial: valorInicial,
      valor_final: valorFinal,
      variacion: valorFinal - valorInicial
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error valor inventario histórico" });
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
          mi.empresa_id,
          mi.almacen_id,
          mi.producto_id,
          mi.fabricante_id,
          SUM(
            CASE 
              WHEN mi.tipo_movimiento IN ('entrada','saldo_inicial') THEN mi.cantidad
              WHEN mi.tipo_movimiento = 'salida' THEN -mi.cantidad
            END
          ) AS stock
        FROM movimientos_inventario mi
        INNER JOIN productos p ON p.id = mi.producto_id
        WHERE 
          mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
          AND mi.fecha_validacion_logistica < ?
          AND p.categoria_id NOT IN (18, 33) -- 🔥 CLAVE
        GROUP BY mi.empresa_id, mi.almacen_id, mi.producto_id, mi.fabricante_id
      ) t
    `, [inicio]);

    res.json({ stock_inicial: Number(rows[0]?.total || 0) });

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


exports.getValorInventarioMensual = async (req, res) => {
  try {

    const { categoria } = req.query;

    let categoriaFilter = "";
    let params = [];

    // 🔥 EXCLUSIÓN FIJA SIEMPRE
    categoriaFilter += " AND p.categoria_id NOT IN (18, 33) ";

    if (categoria) {
      categoriaFilter += " AND p.categoria_id = ? ";
      params.push(Number(categoria));
    }

    const [rows] = await pool.query(`
      WITH base AS (
        SELECT 
          DATE_FORMAT(mi.fecha_validacion_logistica, '%Y-%m') AS mes,
          mi.producto_id,
          mi.empresa_id,
          mi.almacen_id,
          IFNULL(mi.fabricante_id,0) fabricante_id,
          mi.stock_resultante AS stock,
          mi.costo_promedio_resultante AS costo,

          ROW_NUMBER() OVER (
            PARTITION BY 
              DATE_FORMAT(mi.fecha_validacion_logistica, '%Y-%m'),
              mi.producto_id,
              mi.empresa_id,
              mi.almacen_id,
              IFNULL(mi.fabricante_id,0)
            ORDER BY mi.fecha_validacion_logistica DESC, mi.id DESC
          ) rn

        FROM movimientos_inventario mi
        INNER JOIN productos p ON p.id = mi.producto_id
        WHERE 
          mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
          ${categoriaFilter}
          AND p.eliminado = 0
          AND p.activo = 1
      )

      SELECT 
        mes,
        ROUND(SUM(stock * costo), 2) AS valor_inventario
      FROM base
      WHERE rn = 1
      GROUP BY mes
      ORDER BY mes ASC
    `, params);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error valor inventario mensual" });
  }
};



exports.getValorInventarioMes = async (req, res) => {
  try {

    const { mes } = req.query;

    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "mes inválido YYYY-MM" });
    }

    const [rows] = await pool.query(`
      SELECT 
        ROUND(SUM(stock * costo), 2) AS valor_inventario
      FROM (
        SELECT 
          mi.producto_id,
          mi.empresa_id,
          mi.almacen_id,
          IFNULL(mi.fabricante_id,0) fabricante_id,

          mi.stock_resultante AS stock,
          mi.costo_promedio_resultante AS costo,

          ROW_NUMBER() OVER (
            PARTITION BY 
              mi.producto_id,
              mi.empresa_id,
              mi.almacen_id,
              IFNULL(mi.fabricante_id,0)
            ORDER BY mi.fecha_validacion_logistica DESC, mi.id DESC
          ) rn

        FROM movimientos_inventario mi
        INNER JOIN productos p ON p.id = mi.producto_id
        WHERE 
          mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
          AND DATE_FORMAT(mi.fecha_validacion_logistica,'%Y-%m') = ?
          AND p.eliminado = 0
          AND p.activo = 1
          AND p.categoria_id NOT IN (18, 33)   -- 🔥 AQUÍ AGREGADO
      ) t
      WHERE rn = 1
    `, [mes]);

    res.json({
      mes,
      valor_inventario: Number(rows[0]?.valor_inventario || 0)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error valor inventario mes" });
  }
};


exports.getVariacionInventarioMes = async (req, res) => {
  try {

    let inicio, fin;
    ({ inicio, fin } = getFechaFiltro(req));

    // 🔵 valor al inicio del mes
    const [iniRows] = await pool.query(queryValorPorFecha, [inicio]);

    // 🔵 valor al final del mes
    const [finRows] = await pool.query(queryValorPorFecha, [fin]);

    const valorInicial = Number(iniRows[0]?.total || 0);
    const valorFinal = Number(finRows[0]?.total || 0);

    const variacion = valorFinal - valorInicial;

    res.json({
      valor_inicial: valorInicial,
      valor_final: valorFinal,
      variacion,
      interpretacion:
        variacion > 0
          ? "Incremento de inventario"
          : "Reducción de inventario"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Error variación inventario mes",
      detalle: err.message
    });
  }
};



// =====================================================
// RESUMEN ANUAL (12 MESES)
// =====================================================
exports.getResumenAnual = async (req, res) => {
  try {

    const anio = Number(req.query.anio);

    if (!anio || isNaN(anio)) {
      return res.status(400).json({ error: "Año inválido" });
    }

    // 🔥 GENERAR LOS 12 MESES SIEMPRE
    const meses = Array.from({ length: 12 }, (_, i) => {
      const mes = String(i + 1).padStart(2, "0");
      return `${anio}-${mes}`;
    });

    // 🔵 ENTRADAS / SALIDAS AGRUPADAS POR MES
    const [movimientos] = await pool.query(`
      SELECT 
        DATE_FORMAT(mi.fecha_validacion_logistica, '%Y-%m') AS mes,

        SUM(CASE WHEN mi.tipo_movimiento = 'entrada' THEN mi.cantidad ELSE 0 END) entradas,
        SUM(CASE WHEN mi.tipo_movimiento = 'salida' THEN mi.cantidad ELSE 0 END) salidas

      FROM movimientos_inventario mi
      INNER JOIN productos p ON p.id = mi.producto_id

      WHERE 
        mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
        AND YEAR(mi.fecha_validacion_logistica) = ?
        AND p.categoria_id NOT IN (18, 33)
        AND p.eliminado = 0
        AND p.activo = 1

      GROUP BY mes
    `, [anio]);

    // 🔵 VALOR INVENTARIO POR MES (YA LO TIENES CASI HECHO)
    const [valores] = await pool.query(`
      WITH base AS (
        SELECT 
          DATE_FORMAT(mi.fecha_validacion_logistica, '%Y-%m') AS mes,

          mi.producto_id,
          mi.empresa_id,
          mi.almacen_id,
          IFNULL(mi.fabricante_id,0) fabricante_id,

          mi.stock_resultante AS stock,
          mi.costo_promedio_resultante AS costo,

          ROW_NUMBER() OVER (
            PARTITION BY 
              DATE_FORMAT(mi.fecha_validacion_logistica, '%Y-%m'),
              mi.producto_id,
              mi.empresa_id,
              mi.almacen_id,
              IFNULL(mi.fabricante_id,0)
            ORDER BY mi.fecha_validacion_logistica DESC, mi.id DESC
          ) rn

        FROM movimientos_inventario mi
        INNER JOIN productos p ON p.id = mi.producto_id

        WHERE 
          mi.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
          AND YEAR(mi.fecha_validacion_logistica) = ?
          AND p.categoria_id NOT IN (18, 33)
          AND p.eliminado = 0
          AND p.activo = 1
      )

      SELECT 
        mes,
        ROUND(SUM(stock * costo), 2) AS valor
      FROM base
      WHERE rn = 1
      GROUP BY mes
    `, [anio]);

    // 🔥 CONVERTIR A MAPA (rápido lookup)
    const mapMov = {};
    movimientos.forEach(m => {
      mapMov[m.mes] = m;
    });

    const mapVal = {};
    valores.forEach(v => {
      mapVal[v.mes] = v;
    });

    // 🔥 ARMAR RESPUESTA COMPLETA (12 MESES SIEMPRE)
    const resultado = meses.map(mes => ({
      mes,
      entradas: Number(mapMov[mes]?.entradas || 0),
      salidas: Number(mapMov[mes]?.salidas || 0),
      valor: Number(mapVal[mes]?.valor || 0)
    }));

    res.json(resultado);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error resumen anual" });
  }
};