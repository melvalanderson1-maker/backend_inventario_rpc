const { initDB } = require("../config/db");

let pool;
(async () => pool = await initDB())();

/* =====================================================
BASE QUERY
===================================================== */

const BASE_QUERY = `

WITH movimientos_ordenados AS (

SELECT

producto_id,
empresa_id,
almacen_id,
fabricante_id,

tipo_movimiento,
cantidad,
precio,

CONVERT_TZ(fecha_validacion_logistica,'+00:00','-05:00') fecha,

ROW_NUMBER() OVER(
PARTITION BY producto_id,empresa_id,almacen_id,fabricante_id
ORDER BY fecha_validacion_logistica
) rn

FROM movimientos_inventario

WHERE estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')

),

movimientos_calculados AS (

SELECT

*,

CASE
WHEN tipo_movimiento IN ('entrada','saldo_inicial')
THEN cantidad
WHEN tipo_movimiento='salida'
THEN -cantidad
END cantidad_mov

FROM movimientos_ordenados

),

kardex_stock AS (

SELECT

*,

SUM(cantidad_mov) OVER(
PARTITION BY producto_id,empresa_id,almacen_id,fabricante_id
ORDER BY fecha,rn
) stock_acumulado

FROM movimientos_calculados

),

kardex_valor AS (

SELECT

*,

CASE
WHEN tipo_movimiento IN ('entrada','saldo_inicial')
THEN cantidad * precio
ELSE 0
END valor_entrada

FROM kardex_stock

),

kardex_valorizado AS (

SELECT

*,

SUM(valor_entrada) OVER(
PARTITION BY producto_id,empresa_id,almacen_id,fabricante_id
ORDER BY fecha,rn
) valor_acumulado

FROM kardex_valor

),

precio_promedio AS (

SELECT

*,

CASE
WHEN stock_acumulado > 0
THEN valor_acumulado / stock_acumulado
ELSE 0
END costo_promedio

FROM kardex_valorizado

),

stock_actual AS (

SELECT *

FROM (

SELECT
*,

ROW_NUMBER() OVER(
PARTITION BY producto_id,empresa_id,almacen_id,fabricante_id
ORDER BY fecha DESC,rn DESC
) r

FROM precio_promedio

) x

WHERE r = 1

)

SELECT

p.codigo codigo_producto,
p.descripcion producto,
p.categoria_id,
c.nombre categoria,

e.nombre empresa,
a.nombre almacen,
f.nombre fabricante,

sa.stock_acumulado stock_lote,
sa.costo_promedio precio_promedio_lote,

ROUND(sa.stock_acumulado * sa.costo_promedio,2) valor_lote,

sa.fecha ultimo_movimiento_lote,

DATEDIFF(CURDATE(),sa.fecha) dias_sin_movimiento,

CASE
WHEN DATEDIFF(CURDATE(),sa.fecha) > 90
THEN '🔴 INVENTARIO INMOVILIZADO'
WHEN DATEDIFF(CURDATE(),sa.fecha) > 30
THEN '🟡 ROTACION LENTA'
ELSE '🟢 ROTACION NORMAL'
END estado_rotacion,

SUM(sa.stock_acumulado) OVER(PARTITION BY sa.producto_id) stock_total_producto,

ROUND(
SUM(sa.stock_acumulado * sa.costo_promedio)
OVER(PARTITION BY sa.producto_id)
,2) valor_total_producto

FROM stock_actual sa

JOIN productos p ON p.id = sa.producto_id
JOIN empresas e ON e.id = sa.empresa_id
JOIN almacenes a ON a.id = sa.almacen_id
LEFT JOIN fabricantes f ON f.id = sa.fabricante_id
JOIN categorias c ON c.id = p.categoria_id

WHERE sa.stock_acumulado > 0
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