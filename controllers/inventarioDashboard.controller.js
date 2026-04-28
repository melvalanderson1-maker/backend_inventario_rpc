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
  const mes = req.query.mes; // formato: 2026-04

  let inicio, fin;

  if (mes) {
    inicio = `${mes}-01`;

    const date = new Date(mes + "-01");
    date.setMonth(date.getMonth() + 1);
    date.setDate(0); // último día del mes

    fin = date.toISOString().split("T")[0];
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

if(categoria){
query += ` WHERE t.categoria_id = ${Number(categoria)}`;
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
exports.getKPIs = async (req,res)=>{

try{

const filteredQuery = buildFilteredQuery(req);

/* filtro categoria */
const { categoria } = req.query;

let whereProductos = `
WHERE eliminado = 0
AND activo = 1
`;

if(categoria){
whereProductos += ` AND categoria_id = ${categoria}`;
}

const [
valorInventario,
inmovilizado,
productosTotales,
productosConStock
] = await Promise.all([

/* VALOR INVENTARIO */

pool.query(`
SELECT ROUND(SUM(valor_lote),2) total
FROM (${filteredQuery}) t
`),

/* INVENTARIO INMOVILIZADO */

pool.query(`
SELECT COUNT(*) total
FROM (${filteredQuery}) t
WHERE estado_rotacion='🔴 INVENTARIO INMOVILIZADO'
`),

/* TOTAL PRODUCTOS CATALOGO */

pool.query(`
SELECT COUNT(*) total
FROM productos
${whereProductos}
`),

/* PRODUCTOS CON STOCK */

pool.query(`
SELECT COUNT(DISTINCT codigo_producto) total
FROM (${filteredQuery}) t
WHERE stock_lote > 0
`)

]);

res.json({

productos: productosTotales[0][0].total,
productos_con_stock: productosConStock[0][0].total,
valor: valorInventario[0][0].total || 0,
inmovilizado: inmovilizado[0][0].total

});

}catch(err){

console.error(err);
res.status(500).json({error:"Error KPIs"});

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

    let query = `
      SELECT *
      FROM (${buildFilteredQuery(req)}) t
    `;

    // 🔥 FILTRO CLAVE
    if (producto) {
      query += ` WHERE t.codigo_producto = '${producto}'`;
    }

    // 🔥 ORDEN DINÁMICO SEGÚN GRÁFICO
    if (tipo === "stock") {
      query += ` ORDER BY t.stock_total_producto DESC`;
    } else {
      query += ` ORDER BY t.valor_total_producto DESC`;
    }

    query += ` LIMIT ? OFFSET ?`;

    const [rows] = await pool.query(query, [size, offset]);

    // 🔥 COUNT TAMBIÉN FILTRADO
    let countQuery = `
      SELECT COUNT(*) total
      FROM (${buildFilteredQuery(req)}) t
    `;

    if (producto) {
      countQuery += ` WHERE t.codigo_producto = '${producto}'`;
    }

    const [countRows] = await pool.query(countQuery);

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







exports.getEntradasSalidasMes = async (req, res) => {
  try {

    const { inicio, fin } = getFechaFiltro(req);

    const [rows] = await pool.query(`
      SELECT
        p.id producto_id,
        p.codigo,
        p.descripcion producto,

        img.storage_provider,
        img.storage_key,

        COUNT(CASE 
          WHEN m.tipo_movimiento IN ('entrada','saldo_inicial') 
          THEN 1 END) cantidad_entradas,

        COUNT(CASE 
          WHEN m.tipo_movimiento = 'salida' 
          THEN 1 END) cantidad_salidas,

        SUM(CASE 
          WHEN m.tipo_movimiento IN ('entrada','saldo_inicial')
          THEN m.cantidad ELSE 0 END) total_entradas,

        SUM(CASE 
          WHEN m.tipo_movimiento = 'salida'
          THEN m.cantidad ELSE 0 END) total_salidas

      FROM movimientos_inventario m
      JOIN productos p ON p.id = m.producto_id

      ${joinImagenProducto()}

      WHERE 
        m.estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')
        AND DATE(m.fecha_validacion_logistica) BETWEEN ? AND ?

      GROUP BY p.id, p.codigo, p.descripcion, img.storage_provider, img.storage_key

      ORDER BY total_entradas DESC
    `, [inicio, fin]);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error entradas/salidas" });
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