const { initDB } = require("../config/db");

let pool;
(async () => (pool = await initDB()))();


// ======================================
// BASE QUERY (LOTE VALORIZADO)
// ======================================

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


// ======================================
// KPIS
// ======================================

exports.getKPIs = async (req, res) => {

    try {

        const query = `
        ${BASE_QUERY}

        SELECT

            COUNT(DISTINCT producto_id) AS productos,

            COUNT(
                CASE WHEN stock_lote > 0 THEN 1 END
            ) AS productos_con_stock,

            ROUND(
                SUM(stock_lote * precio_promedio_lote),
                2
            ) AS valor_inventario,

            COUNT(
                CASE
                    WHEN DATEDIFF(
                        CURDATE(),
                        COALESCE(ultima_salida_lote, ultimo_movimiento_lote)
                    ) > 90
                    THEN 1
                END
            ) AS productos_sin_movimiento

        FROM lotes_valorizados
        WHERE stock_lote > 0
        `;

        const [rows] = await pool.query(query);

        res.json(rows[0]);

    } catch (error) {
        console.error("KPIS ERROR", error);
        res.status(500).json({ error: "Error KPIs" });
    }
};


// ======================================
// TOP PRODUCTOS POR VALOR
// ======================================

exports.topProductosValor = async (req, res) => {

    try {

        const query = `
        ${BASE_QUERY}

        SELECT

            p.codigo,
            p.descripcion,

            SUM(stock_lote) AS stock_total,

            ROUND(
                SUM(stock_lote * precio_promedio_lote),
                2
            ) AS valor_total

        FROM lotes_valorizados lv

        JOIN productos p
        ON p.id = lv.producto_id

        WHERE stock_lote > 0

        GROUP BY p.id

        ORDER BY valor_total DESC

        LIMIT 10
        `;

        const [rows] = await pool.query(query);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error top productos valor" });
    }
};


// ======================================
// TOP PRODUCTOS POR STOCK
// ======================================

exports.topProductosStock = async (req, res) => {

    try {

        const query = `
        ${BASE_QUERY}

        SELECT

            p.codigo,
            p.descripcion,

            SUM(stock_lote) AS stock_total

        FROM lotes_valorizados lv

        JOIN productos p
        ON p.id = lv.producto_id

        GROUP BY p.id

        ORDER BY stock_total DESC

        LIMIT 10
        `;

        const [rows] = await pool.query(query);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error top stock" });
    }
};


// ======================================
// PRODUCTOS STOCK BAJO
// ======================================

exports.productosStockBajo = async (req, res) => {

    try {

        const query = `
        ${BASE_QUERY}

        SELECT

            p.codigo,
            p.descripcion,

            SUM(stock_lote) AS stock_total

        FROM lotes_valorizados lv

        JOIN productos p
        ON p.id = lv.producto_id

        GROUP BY p.id

        HAVING stock_total <= 5

        ORDER BY stock_total ASC
        `;

        const [rows] = await pool.query(query);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error stock bajo" });
    }
};


// ======================================
// INVENTARIO POR ALMACEN
// ======================================

exports.inventarioPorAlmacen = async (req, res) => {

    try {

        const query = `
        ${BASE_QUERY}

        SELECT

            a.nombre AS almacen,

            SUM(stock_lote) AS stock_total,

            ROUND(
                SUM(stock_lote * precio_promedio_lote),
                2
            ) AS valor_total

        FROM lotes_valorizados lv

        JOIN almacenes a
        ON a.id = lv.almacen_id

        GROUP BY a.id

        ORDER BY valor_total DESC
        `;

        const [rows] = await pool.query(query);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error inventario por almacen" });
    }
};


// ======================================
// ROTACION INVENTARIO
// ======================================

exports.rotacionInventario = async (req, res) => {

    try {

        const query = `
        ${BASE_QUERY}

        SELECT

            p.codigo,
            p.descripcion,

            SUM(stock_lote) AS stock_total,

            MAX(
                DATEDIFF(
                    CURDATE(),
                    COALESCE(ultima_salida_lote, ultimo_movimiento_lote)
                )
            ) AS dias_sin_salida

        FROM lotes_valorizados lv

        JOIN productos p
        ON p.id = lv.producto_id

        GROUP BY p.id

        ORDER BY dias_sin_salida DESC

        LIMIT 10
        `;

        const [rows] = await pool.query(query);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error rotacion" });
    }
};


// ======================================
// PRODUCTOS SIN MOVIMIENTO
// ======================================

exports.productosSinMovimiento = async (req, res) => {

    try {

        const query = `
        ${BASE_QUERY}

        SELECT

            p.codigo,
            p.descripcion,

            MAX(
                DATEDIFF(
                    CURDATE(),
                    COALESCE(ultima_salida_lote, ultimo_movimiento_lote)
                )
            ) AS dias_sin_movimiento

        FROM lotes_valorizados lv

        JOIN productos p
        ON p.id = lv.producto_id

        GROUP BY p.id

        HAVING dias_sin_movimiento > 90

        ORDER BY dias_sin_movimiento DESC
        `;

        const [rows] = await pool.query(query);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error productos sin movimiento" });
    }
};


// ======================================
// DETALLE LOTES PRODUCTO
// ======================================

exports.detalleLotesProducto = async (req, res) => {

    try {

        const { id } = req.params;

        const query = `
        ${BASE_QUERY}

        SELECT

            e.nombre AS empresa,
            a.nombre AS almacen,
            f.nombre AS fabricante,

            stock_lote,

            precio_promedio_lote,

            ROUND(
                stock_lote * precio_promedio_lote,
                2
            ) AS valor_lote,

            ultimo_movimiento_lote,
            ultima_salida_lote

        FROM lotes_valorizados lv

        JOIN empresas e
        ON e.id = lv.empresa_id

        JOIN almacenes a
        ON a.id = lv.almacen_id

        LEFT JOIN fabricantes f
        ON f.id = lv.fabricante_id

        WHERE lv.producto_id = ?
        AND stock_lote > 0
        `;

        const [rows] = await pool.query(query, [id]);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error detalle producto" });
    }
};