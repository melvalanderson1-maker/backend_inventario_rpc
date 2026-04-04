const { initDB } = require("../config/db");

let pool;
(async () => pool = await initDB())();


// =====================================
// BASE QUERY (TU CONSULTA SQL)
// =====================================

const BASE_QUERY = `

WITH movimientos_lote AS (

SELECT
producto_id,
empresa_id,
almacen_id,
fabricante_id,

MAX(CONVERT_TZ(fecha_validacion_logistica,'+00:00','-05:00')) ultimo_movimiento_lote,

MAX(
CASE WHEN tipo_movimiento='salida'
THEN CONVERT_TZ(fecha_validacion_logistica,'+00:00','-05:00')
END
) ultima_salida_lote,

SUM(
CASE WHEN tipo_movimiento IN ('entrada','saldo_inicial')
THEN cantidad ELSE 0 END
) total_entradas,

SUM(
CASE WHEN tipo_movimiento IN ('entrada','saldo_inicial')
THEN cantidad*precio ELSE 0 END
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
COALESCE(ml.total_costo / NULLIF(ml.total_entradas,0),0)
,4) precio_promedio_lote

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
OVER(PARTITION BY lv.producto_id)
,2) valor_total_producto

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


// =====================================
// KPIs
// =====================================

exports.getKPIs = async (req,res)=>{

try{

const [rows] = await pool.query(`

SELECT
COUNT(DISTINCT codigo_producto) productos,
SUM(valor_total_producto) valor,
COUNT(CASE WHEN estado_rotacion='🔴 INVENTARIO INMOVILIZADO' THEN 1 END) inmovilizado

FROM (${BASE_QUERY}) t

`);

res.json(rows[0]);

}catch(err){

console.error(err);
res.status(500).json({error:"Error KPIs"});

}

};


// =====================================
// TOP PRODUCTOS POR VALOR
// =====================================

exports.getTopProductosValor = async (req,res)=>{

try{

const [rows] = await pool.query(`

SELECT
codigo_producto,
producto,
MAX(stock_total_producto) stock_total_producto,
MAX(valor_total_producto) valor_total_producto

FROM (${BASE_QUERY}) t

GROUP BY codigo_producto,producto

ORDER BY valor_total_producto DESC

LIMIT 10

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error top productos"});

}

};


// =====================================
// ROTACION
// =====================================

exports.getRotacion = async (req,res)=>{

try{

const [rows] = await pool.query(`

SELECT
estado_rotacion estado,
COUNT(*) total

FROM (${BASE_QUERY}) t

GROUP BY estado_rotacion

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error rotacion"});

}

};


// =====================================
// HEATMAP
// =====================================

exports.getHeatmap = async (req,res)=>{

try{

const [rows] = await pool.query(`

SELECT
empresa,
almacen,
SUM(valor_lote) valor

FROM (${BASE_QUERY}) t

GROUP BY empresa,almacen

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error heatmap"});

}

};


// =====================================
// TABLA COMPLETA INVENTARIO
// =====================================

exports.getInventario = async (req,res)=>{

try{

const [rows] = await pool.query(`

SELECT *
FROM (${BASE_QUERY}) t
ORDER BY valor_total_producto DESC

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error inventario"});

}

};


// =====================================
// DETALLE POR EMPRESA / ALMACEN
// =====================================

exports.getLotesByEmpresaAlmacen = async (req,res)=>{

try{

const { empresa, almacen } = req.query;

const [rows] = await pool.query(`

SELECT *
FROM (${BASE_QUERY}) t
WHERE empresa=? AND almacen=?
ORDER BY valor_lote DESC

`,[empresa,almacen]);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error detalle almacen"});

}

};


// =====================================
// PRODUCTOS POR STOCK (MAYOR / MENOR)
// =====================================

exports.getProductosStock = async (req,res)=>{

try{

const {
tipo = "mayor",
limit = 10
} = req.query;

const order = tipo === "menor" ? "ASC" : "DESC";

const [rows] = await pool.query(`

SELECT
codigo_producto,
producto,
MAX(stock_total_producto) stock_total_producto,
MAX(valor_total_producto) valor_total_producto

FROM (${BASE_QUERY}) t

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



// =====================================
// VALOR INVENTARIO POR EMPRESA
// =====================================

exports.getValorPorEmpresa = async (req,res)=>{

try{

const [rows] = await pool.query(`

SELECT
empresa,
ROUND(SUM(valor_lote),2) valor_inventario

FROM (${BASE_QUERY}) t

GROUP BY empresa
ORDER BY valor_inventario DESC

`);

res.json(rows);

}catch(err){

console.error(err);
res.status(500).json({error:"Error valor por empresa"});

}

};