const pool = require("../config/db");

// ===============================
// BASE QUERY (LOTE VALORIZADO)
// ===============================

const BASE_QUERY = `
WITH movimientos_lote AS (

    SELECT
        producto_id,
        empresa_id,
        almacen_id,
        fabricante_id,

        MAX(
            CONVERT_TZ(
                fecha_validacion_logistica,
                '+00:00',
                '-05:00'
            )
        ) AS ultimo_movimiento_lote,

        MAX(
            CASE 
                WHEN tipo_movimiento = 'salida'
                THEN CONVERT_TZ(
                    fecha_validacion_logistica,
                    '+00:00',
                    '-05:00'
                )
            END
        ) AS ultima_salida_lote,

        SUM(
            CASE 
                WHEN tipo_movimiento IN ('entrada','saldo_inicial')
                THEN cantidad
                ELSE 0
            END
        ) AS total_entradas,

        SUM(
            CASE 
                WHEN tipo_movimiento IN ('entrada','saldo_inicial')
                THEN cantidad * precio
                ELSE 0
            END
        ) AS total_costo

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

        sp.cantidad AS stock_lote,

        ml.ultimo_movimiento_lote,
        ml.ultima_salida_lote,

        ROUND(
            COALESCE(
                ml.total_costo / NULLIF(ml.total_entradas,0),
                0
            ),
            4
        ) AS precio_promedio_lote

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
`;

// ===============================
// KPIS
// ===============================

exports.getKPIs = async (req, res) => {

    try {

        const [rows] = await pool.query(`
        ${BASE_QUERY}

        SELECT

            COUNT(DISTINCT producto_id) AS total_productos,

            SUM(stock_lote) AS stock_total,

            ROUND(
                SUM(stock_lote * precio_promedio_lote),
                2
            ) AS valor_inventario

        FROM lotes_valorizados
        WHERE stock_lote > 0
        `);

        res.json(rows[0]);

    } catch (error) {

        console.error("❌ KPIs ERROR:", error);

        res.status(500).json({
            error: "Error obteniendo KPIs"
        });

    }

};

// ===============================
// TOP PRODUCTOS POR VALOR
// ===============================

exports.topProductosValor = async (req, res) => {

    try {

        const [rows] = await pool.query(`
        ${BASE_QUERY}

        SELECT

            p.descripcion AS producto,

            ROUND(
                SUM(stock_lote * precio_promedio_lote),
                2
            ) AS valor_total

        FROM lotes_valorizados lv

        JOIN productos p
            ON p.id = lv.producto_id

        WHERE stock_lote > 0

        GROUP BY lv.producto_id

        ORDER BY valor_total DESC

        LIMIT 10
        `);

        res.json(rows);

    } catch (error) {

        console.error("❌ TOP VALOR ERROR:", error);

        res.status(500).json({
            error: "Error top productos valor"
        });

    }

};

// ===============================
// TOP PRODUCTOS POR STOCK
// ===============================

exports.topProductosStock = async (req, res) => {

    try {

        const [rows] = await pool.query(`

        SELECT

            p.descripcion AS producto,

            SUM(sp.cantidad) AS stock_total

        FROM stock_producto sp

        JOIN productos p
            ON p.id = sp.producto_id

        GROUP BY p.id

        ORDER BY stock_total DESC

        LIMIT 10

        `);

        res.json(rows);

    } catch (error) {

        console.error("❌ TOP STOCK ERROR:", error);

        res.status(500).json({
            error: "Error top stock"
        });

    }

};

// ===============================
// STOCK BAJO
// ===============================

exports.productosStockBajo = async (req, res) => {

    try {

        const [rows] = await pool.query(`

        SELECT

            p.descripcion,

            SUM(sp.cantidad) AS stock_total

        FROM stock_producto sp

        JOIN productos p
            ON p.id = sp.producto_id

        GROUP BY p.id

        HAVING stock_total < 10

        ORDER BY stock_total ASC

        `);

        res.json(rows);

    } catch (error) {

        console.error("❌ STOCK BAJO ERROR:", error);

        res.status(500).json({
            error: "Error stock bajo"
        });

    }

};

// ===============================
// INVENTARIO POR ALMACEN
// ===============================

exports.inventarioPorAlmacen = async (req, res) => {

    try {

        const [rows] = await pool.query(`

        SELECT

            a.nombre AS almacen,

            SUM(sp.cantidad) AS stock_total

        FROM stock_producto sp

        JOIN almacenes a
            ON a.id = sp.almacen_id

        GROUP BY a.id

        ORDER BY stock_total DESC

        `);

        res.json(rows);

    } catch (error) {

        console.error("❌ INVENTARIO ALMACEN ERROR:", error);

        res.status(500).json({
            error: "Error inventario almacen"
        });

    }

};

// ===============================
// ROTACION INVENTARIO
// ===============================

exports.rotacionInventario = async (req, res) => {

    try {

        const [rows] = await pool.query(`
        ${BASE_QUERY}

        SELECT

            p.descripcion,

            MAX(ultimo_movimiento_lote) AS ultimo_movimiento,

            DATEDIFF(
                CURDATE(),
                MAX(ultimo_movimiento_lote)
            ) AS dias_sin_movimiento

        FROM lotes_valorizados lv

        JOIN productos p
            ON p.id = lv.producto_id

        GROUP BY lv.producto_id

        ORDER BY dias_sin_movimiento DESC
        `);

        res.json(rows);

    } catch (error) {

        console.error("❌ ROTACION ERROR:", error);

        res.status(500).json({
            error: "Error rotación inventario"
        });

    }

};

// ===============================
// PRODUCTOS SIN MOVIMIENTO
// ===============================

exports.productosSinMovimiento = async (req, res) => {

    try {

        const [rows] = await pool.query(`
        ${BASE_QUERY}

        SELECT

            p.descripcion,

            MAX(ultimo_movimiento_lote) AS ultimo_movimiento,

            DATEDIFF(
                CURDATE(),
                MAX(ultimo_movimiento_lote)
            ) AS dias

        FROM lotes_valorizados lv

        JOIN productos p
            ON p.id = lv.producto_id

        GROUP BY lv.producto_id

        HAVING dias > 60

        ORDER BY dias DESC
        `);

        res.json(rows);

    } catch (error) {

        console.error("❌ SIN MOVIMIENTO ERROR:", error);

        res.status(500).json({
            error: "Error productos sin movimiento"
        });

    }

};

// ===============================
// DETALLE LOTES
// ===============================

exports.detalleLotesProducto = async (req, res) => {

    try {

        const { id } = req.params;

        const [rows] = await pool.query(`
        ${BASE_QUERY}

        SELECT

            p.descripcion AS producto,
            e.nombre AS empresa,
            a.nombre AS almacen,
            f.nombre AS fabricante,

            stock_lote,
            precio_promedio_lote,

            ROUND(
                stock_lote * precio_promedio_lote,
                2
            ) AS valor_lote

        FROM lotes_valorizados lv

        JOIN productos p
            ON p.id = lv.producto_id

        JOIN empresas e
            ON e.id = lv.empresa_id

        JOIN almacenes a
            ON a.id = lv.almacen_id

        LEFT JOIN fabricantes f
            ON f.id = lv.fabricante_id

        WHERE lv.producto_id = ?
        `,[id]);

        res.json(rows);

    } catch (error) {

        console.error("❌ DETALLE LOTES ERROR:", error);

        res.status(500).json({
            error: "Error detalle lotes"
        });

    }

};