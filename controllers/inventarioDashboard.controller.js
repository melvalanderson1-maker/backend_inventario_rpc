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

exports.getTopProductosValor = async (req,res)=>{

try{

const { tipo="mayor", limit=10 } = req.query;
const order = tipo==="menor" ? "ASC" : "DESC";

const filteredQuery = buildFilteredQuery(req);

const [rows] = await pool.query(`

SELECT
codigo_producto,
producto,
MAX(stock_total_producto) stock_total_producto,
MAX(valor_total_producto) valor_total_producto

FROM (${filteredQuery}) t

GROUP BY codigo_producto,producto

ORDER BY valor_total_producto ${order}

LIMIT ?

`,[Number(limit)]);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error top productos"});

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

exports.getInventario = async (req,res)=>{

try{

const filteredQuery = buildFilteredQuery(req);

const [rows] = await pool.query(`

SELECT *
FROM (${filteredQuery}) t
ORDER BY valor_total_producto DESC

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error inventario"});

}

};


/* =====================================================
PRODUCTOS POR STOCK
===================================================== */

exports.getProductosStock = async (req,res)=>{

try{

const { tipo="mayor",limit=10 } = req.query;

const order = tipo==="menor" ? "ASC" : "DESC";

const filteredQuery = buildFilteredQuery(req);

const [rows] = await pool.query(`

SELECT
codigo_producto,
producto,
MAX(stock_total_producto) stock_total_producto,
MAX(valor_total_producto) valor_total_producto

FROM (${filteredQuery}) t

GROUP BY codigo_producto,producto

ORDER BY stock_total_producto ${order}

LIMIT ?

`,[Number(limit)]);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error productos stock"});

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

};/* =====================================================
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

};