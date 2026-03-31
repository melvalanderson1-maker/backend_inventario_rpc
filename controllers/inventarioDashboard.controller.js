const db = require("../db");

/* ===============================
KPIs
================================ */
exports.getKPIs = async (req, res) => {

try {

const [productos] = await db.query(`
SELECT COUNT(*) total
FROM productos
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
SELECT COUNT(*) total
FROM (
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
console.error(error);
res.status(500).json({error:"Error KPIs"});
}

};


/* ===============================
TOP PRODUCTOS POR VALOR
================================ */

exports.topProductosValor = async (req,res)=>{

try{

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

}catch(e){

res.status(500).json(e)

}

}


/* ===============================
TOP STOCK
================================ */

exports.topProductosStock = async (req,res)=>{

try{

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

}catch(e){

res.status(500).json(e)

}

}


/* ===============================
STOCK BAJO
================================ */

exports.productosStockBajo = async (req,res)=>{

try{

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

}catch(e){

res.status(500).json(e)

}

}


/* ===============================
INVENTARIO POR ALMACEN
================================ */

exports.inventarioPorAlmacen = async (req,res)=>{

try{

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

}catch(e){

res.status(500).json(e)

}

}


/* ===============================
ROTACION INVENTARIO
================================ */

exports.rotacionInventario = async (req,res)=>{

try{

const [rows] = await db.query(`

SELECT
estado_rotacion,
COUNT(*) cantidad
FROM inventario_resumen
GROUP BY estado_rotacion

`);

res.json(rows);

}catch(e){

res.status(500).json(e)

}

}


/* ===============================
PRODUCTOS SIN MOVIMIENTO
================================ */

exports.productosSinMovimiento = async (req,res)=>{

try{

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

}catch(e){

res.status(500).json(e)

}

}



exports.detalleLotesProducto = async (req,res)=>{

const {id} = req.params;

try{

const [rows] = await db.query(`

WITH movimientos_lote AS (

SELECT
producto_id,
empresa_id,
almacen_id,
fabricante_id,

MAX(fecha_validacion_logistica) ultimo_movimiento_lote,

MAX(
CASE WHEN tipo_movimiento='salida'
THEN fecha_validacion_logistica
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
THEN cantidad * precio
ELSE 0
END
) total_costo

FROM movimientos_inventario

WHERE estado IN ('VALIDADO_LOGISTICA','APROBADO_FINAL')

GROUP BY
producto_id,
empresa_id,
almacen_id,
fabricante_id
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
COALESCE(
ml.total_costo / NULLIF(ml.total_entradas,0),
0
),4
) precio_promedio_lote

FROM stock_producto sp

LEFT JOIN movimientos_lote ml
ON ml.producto_id = sp.producto_id
AND ml.empresa_id = sp.empresa_id
AND ml.almacen_id = sp.almacen_id
AND (
(ml.fabricante_id IS NULL AND sp.fabricante_id IS NULL)
OR ml.fabricante_id = sp.fabricante_id
)

)

SELECT *

FROM lotes_valorizados

WHERE producto_id = ?

AND stock_lote > 0

`,[id]);

res.json(rows)

}catch(e){

res.status(500).json(e)

}

}