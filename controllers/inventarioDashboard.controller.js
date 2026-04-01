const { initDB } = require("../config/db");

let pool;
(async () => (pool = await initDB()))();


// ======================================
// BASE QUERY
// ======================================

const BASE_QUERY = `

WITH movimientos_lote AS (

    SELECT
        producto_id,
        empresa_id,
        almacen_id,
        fabricante_id,

        MAX(fecha_validacion_logistica) AS ultimo_movimiento_lote,

        MAX(
            CASE
                WHEN tipo_movimiento = 'salida'
                THEN fecha_validacion_logistica
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
            ),4
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
// FILTROS DINAMICOS
// ======================================

function buildFilters(query) {

    const { empresa_id, almacen_id } = query;

    let where = "WHERE 1=1";
    const params = [];

    if (empresa_id) {
        where += " AND lv.empresa_id = ?";
        params.push(empresa_id);
    }

    if (almacen_id) {
        where += " AND lv.almacen_id = ?";
        params.push(almacen_id);
    }

    return { where, params };
}


// ======================================
// KPIS
// ======================================

exports.getKPIs = async (req, res) => {

    try {

        const { where, params } = buildFilters(req.query);

        const query = `

        ${BASE_QUERY}

        SELECT

            COUNT(DISTINCT producto_id) AS productos,

            SUM(
                CASE WHEN stock_lote > 0 THEN 1 ELSE 0 END
            ) AS productos_con_stock,

            ROUND(
                SUM(stock_lote * precio_promedio_lote),
                2
            ) AS valor_inventario,

            SUM(
                CASE
                    WHEN DATEDIFF(
                        CURDATE(),
                        COALESCE(ultima_salida_lote, ultimo_movimiento_lote)
                    ) > 90
                    THEN 1
                    ELSE 0
                END
            ) AS productos_sin_movimiento

        FROM lotes_valorizados lv

        ${where}

        `;

        const [rows] = await pool.query(query, params);

        res.json(rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error KPIs" });
    }
};


// ======================================
// TOP PRODUCTOS VALOR
// ======================================

exports.topProductosValor = async (req, res) => {

    try {

        const { where, params } = buildFilters(req.query);

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

        ${where}

        GROUP BY p.id

        ORDER BY valor_total DESC

        LIMIT 10

        `;

        const [rows] = await pool.query(query, params);

        res.json(rows);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error top productos valor" });
    }
};


// ======================================
// HEATMAP INVENTARIO
// ======================================

exports.heatmapInventario = async (req, res) => {

    try {

        const query = `

        ${BASE_QUERY}

        SELECT

            e.nombre AS empresa,
            a.nombre AS almacen,

            ROUND(
                SUM(stock_lote * precio_promedio_lote),
                2
            ) AS valor

        FROM lotes_valorizados lv

        JOIN empresas e
        ON e.id = lv.empresa_id

        JOIN almacenes a
        ON a.id = lv.almacen_id

        GROUP BY e.id, a.id

        ORDER BY valor DESC

        `;

        const [rows] = await pool.query(query);

        res.json(rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error heatmap inventario"
        });
    }
};


// ======================================
// ROTACION INVENTARIO REAL
// ======================================

exports.rotacionInventario = async (req, res) => {

    try {

        const { where, params } = buildFilters(req.query);

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
            ) AS dias_sin_salida

        FROM lotes_valorizados lv

        JOIN productos p
        ON p.id = lv.producto_id

        ${where}

        GROUP BY p.id

        ORDER BY dias_sin_salida DESC

        LIMIT 20

        `;

        const [rows] = await pool.query(query, params);

        res.json(rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error rotacion inventario"
        });
    }
};


// ======================================
// INVENTARIO POR ALMACEN
// ======================================

exports.inventarioPorAlmacen = async (req, res) => {

    try {

        const { where, params } = buildFilters(req.query);

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

        ${where}

        GROUP BY a.id

        ORDER BY valor_total DESC

        `;

        const [rows] = await pool.query(query, params);

        res.json(rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Error inventario por almacen"
        });
    }
};