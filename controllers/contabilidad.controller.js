const { initDB } = require("../config/db");

const { uploadImage } = require("../services/storage.service"); // tu función cloud




let pool;
(async () => (pool = await initDB()))();


/* =====================================================
   🔧 FUNCIÓN LOCAL PARA CÓDIGO BASE (DENTRO DEL CONTROLLER)
   ===================================================== */
function obtenerCodigoBaseRobusto(codigo) {
  if (!codigo) return "";

  // guiones
  if (codigo.includes("-")) {
    const partes = codigo.split("-");
    if (partes.length > 1) {
      return partes.slice(0, -1).join("-");
    }
  }

  // números + sufijo (.A .R .V)
  const punto = codigo.match(/^(\d+)\.[A-Z]{1,2}$/);
  if (punto) return punto[1];

  // colores / variantes
  const match = codigo.match(
    /^([A-ZÑ0-9]{3,})(AZ|RO|VE|AN|AM|BL|NG|VD|RS|GR|MO|C|R|V|E)$/
  );

  if (match) return match[1];

  return codigo;
}

module.exports = {
  // =====================================================
  // 📦 LISTAR PRODUCTOS
  // =====================================================

  
  listarProductos: async (req, res) => {
    try {
      const search = req.query.search || "";

      const [rows] = await pool.query(
        `
        SELECT
          p.id,
          p.codigo,
          p.codigo_modelo,
          p.descripcion,
          p.modelo,
          p.marca,
          p.es_catalogo,
          p.categoria_id,
          c.nombre AS categoria_nombre,
          p.created_at,

          CASE
            WHEN p.es_catalogo = 1 THEN (
              SELECT COALESCE(SUM(spv.cantidad), 0)
              FROM productos pv
              LEFT JOIN stock_producto spv ON spv.producto_id = pv.id
              WHERE pv.producto_padre_id = p.id
            )
            ELSE COALESCE(SUM(sp.cantidad), 0)
          END AS stock_total,

          (
            SELECT JSON_ARRAYAGG(
              JSON_OBJECT(
                'id', v2.id,
                'codigo_modelo', v2.codigo_modelo,
                'stock', COALESCE((
                  SELECT SUM(sp2.cantidad)
                  FROM stock_producto sp2
                  WHERE sp2.producto_id = v2.id
                ),0)
              )
            )
            FROM productos v2
            WHERE v2.producto_padre_id = p.id
          ) AS variantes,

          JSON_OBJECT(
            'storage_provider', img.storage_provider,
            'storage_key', img.storage_key
          ) AS imagen

        FROM productos p
        LEFT JOIN stock_producto sp ON sp.producto_id = p.id
        LEFT JOIN categorias c ON c.id = p.categoria_id
        LEFT JOIN (
          SELECT i1.*
          FROM imagenes i1
          INNER JOIN (
            SELECT producto_id, MIN(id) AS min_id
            FROM imagenes
            WHERE tipo = 'producto'
            GROUP BY producto_id
          ) i2 ON i1.id = i2.min_id
        ) img ON img.producto_id = p.id

        WHERE p.activo = 1
          AND p.producto_padre_id IS NULL
          AND (
            p.codigo LIKE ?
            OR p.codigo_modelo LIKE ?
            OR p.descripcion LIKE ?
            OR EXISTS (
              SELECT 1
              FROM productos vx
              WHERE vx.producto_padre_id = p.id
                AND vx.codigo_modelo LIKE ?
            )
          )

        GROUP BY p.id, img.storage_provider, img.storage_key, c.nombre
        ORDER BY p.created_at DESC
      `,
        [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`]
      );

      res.json({ productos: rows });
    } catch (error) {
      console.error("❌ listarProductos logística:", error);
      res.status(500).json({ error: "Error listando productos logística" });
    }
  },

  // =====================================================
  // 📂 LISTAR CATEGORÍAS
  // =====================================================
  listarCategorias: async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT id, nombre
        FROM categorias
        ORDER BY nombre
      `);

      res.json({ categorias: rows });
    } catch (error) {
      console.error("❌ listarCategorias logística:", error);
      res.status(500).json({ error: "Error listando categorías" });
    }
  },

  // =====================================================
  // 📦 OBTENER PRODUCTO + VARIANTES + STOCK
  // =====================================================
  obtenerProducto: async (req, res) => {
    try {
      const productoId = req.params.id;

      const [[producto]] = await pool.query(
        `
        SELECT 
          p.*,
          c.nombre AS categoria_nombre,
          COALESCE(SUM(sp.cantidad),0) AS stock_total
        FROM productos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
        LEFT JOIN stock_producto sp ON sp.producto_id = p.id
        WHERE p.id = ?
        GROUP BY p.id, c.nombre
      `,
        [productoId]
      );

      if (!producto) {
        return res.json({ producto: null });
      }

      const [[imagen]] = await pool.query(
        `
        SELECT storage_provider, storage_key
        FROM imagenes
        WHERE producto_id = ? AND tipo='producto'
        ORDER BY id ASC
        LIMIT 1
      `,
        [productoId]
      );

      const [variantes] = await pool.query(
        `
        SELECT v.*,
          COALESCE(SUM(sp.cantidad),0) AS stock_total
        FROM productos v
        LEFT JOIN stock_producto sp ON sp.producto_id = v.id
        WHERE v.producto_padre_id = ?
        GROUP BY v.id
      `,
        [productoId]
      );

      for (const v of variantes) {
        const [[img]] = await pool.query(
          `
          SELECT storage_provider, storage_key
          FROM imagenes
          WHERE producto_id = ? AND tipo='producto'
          ORDER BY id ASC
          LIMIT 1
        `,
          [v.id]
        );

        v.imagen = img || null;
      }

      res.json({
        producto: {
          ...producto,
          imagen: imagen || null,
          variantes,
        },
      });
    } catch (error) {
      console.error("❌ obtenerProducto logística:", error);
      res.status(500).json({ error: "Error obteniendo producto" });
    }
  },

  // =====================================================
  // 📋 BANDEJA GLOBAL DE PENDIENTES LOGÍSTICA
  // =====================================================
listarPendientes: async (req, res) => {
  try {
    const [rows] = await pool.query(`
    SELECT
        mi.id,
        mi.producto_id,
        mi.empresa_id,
        mi.fabricante_id,
        mi.almacen_id,
        mi.tipo_movimiento,
        mi.cantidad,
        mi.cantidad_solicitada,
        mi.precio,
        mi.estado,
        mi.created_at AS fecha_creacion,
        mi.numero_orden,
        mi.op_vinculada,
        mi.observaciones AS observaciones_compras,

        (
          SELECT vm.observaciones
          FROM validaciones_movimiento vm
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS observaciones_logistica,

        p.codigo AS codigo_producto,
        p.codigo_modelo,
        p.descripcion AS producto,
        COALESCE(e.nombre, 'SIN EMPRESA') AS empresa,
        COALESCE(a.nombre, 'SIN ALMACÉN') AS almacen,
        COALESCE(f.nombre, 'SIN FABRICANTE') AS fabricante,
        u.nombre AS usuario_creador

    FROM movimientos_inventario mi
    INNER JOIN productos p ON p.id = mi.producto_id
    LEFT JOIN empresas e ON e.id = mi.empresa_id
    LEFT JOIN almacenes a ON a.id = mi.almacen_id
    LEFT JOIN fabricantes f ON f.id = mi.fabricante_id
    INNER JOIN usuarios u ON u.id = mi.usuario_creador_id
    WHERE mi.estado = 'PENDIENTE_LOGISTICA'
    ORDER BY mi.created_at ASC

    `);

    console.log("🧪 BACKEND MOVIMIENTO SAMPLE:", rows[0]);
    res.json(rows);
  } catch (error) {
    console.error("❌ listarPendientes logística:", error);
    res.status(500).json({ error: "Error listando pendientes logística" });
  }
},


listarAlmacenesParaMovimiento: async (req, res) => {
  try {
    const {
      productoId,
      empresaId,
      fabricanteId,
      tipoMovimiento,
      almacenSolicitadoId,
    } = req.query;

    const tipo = (tipoMovimiento || "").toUpperCase();

    console.log("📦 listarAlmacenesParaMovimiento →", {
      productoId,
      empresaId,
      fabricanteId,
      tipoMovimiento: tipo,
      almacenSolicitadoId,
    });

    // ------------------------------------
    // 📤 SALIDA → SOLO almacén solicitado
    // ------------------------------------
    if (tipo === "SALIDA") {
      if (!almacenSolicitadoId) {
        return res.json({ almacenes: [], preseleccion: null });
      }

      const [[row]] = await pool.query(
        `
        SELECT id, nombre
        FROM almacenes
        WHERE id = ?
        `,
        [almacenSolicitadoId]
      );

      return res.json({
        almacenes: row ? [row] : [],
        preseleccion: row ? String(row.id) : null,
      });
    }

    // ------------------------------------
    // 📥 ENTRADA / SALDO / AJUSTE
    // ------------------------------------
    if (["ENTRADA", "SALDO_INICIAL", "AJUSTE"].includes(tipo)) {
      // 🔥 Traer almacenes de la empresa
      const [rows] = await pool.query(
        `
        SELECT id, nombre
        FROM almacenes
        WHERE empresa_id = ?
        ORDER BY nombre
        `,
        [empresaId]
      );

      let almacenes = rows || [];

      // 🔥 SI EL ALMACÉN SOLICITADO NO EXISTE EN ESA LISTA → AGREGARLO
      if (almacenSolicitadoId) {
        const existe = almacenes.some(
          (a) => String(a.id) === String(almacenSolicitadoId)
        );

        if (!existe) {
          const [[solicitado]] = await pool.query(
            `
            SELECT id, nombre
            FROM almacenes
            WHERE id = ?
            `,
            [almacenSolicitadoId]
          );

          if (solicitado) {
            almacenes = [solicitado, ...almacenes];
          }
        }
      }

      return res.json({
        almacenes,
        preseleccion: almacenSolicitadoId
          ? String(almacenSolicitadoId)
          : null,
      });
    }

    console.log("⚠️ Tipo desconocido:", tipo);
    res.json({ almacenes: [], preseleccion: null });
  } catch (error) {
    console.error("❌ listarAlmacenesParaMovimiento:", error);
    res.status(500).json({ error: "Error cargando almacenes" });
  }
},





  // =====================================================
  // 📝 ÚLTIMA OBSERVACIÓN DE LOGÍSTICA
  // =====================================================
getUltimaObservacionContabilidad: async (req, res) => {
  try {
    const { id } = req.params;

    const [[row]] = await pool.query(
      `
      SELECT observaciones
      FROM validaciones_movimiento
      WHERE movimiento_id = ?
        AND rol = 'LOGISTICA'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [id]
    );

    res.json({ observaciones: row?.observaciones || "" });
  } catch (error) {
    console.error("❌ getUltimaObservacionLogistica:", error);
    res.status(500).json({ error: "Error obteniendo observación logística" });
  }
},


validarMovimiento: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { movimientoId } = req.params;
    const usuarioId = req.user.id;
    const { almacen_id, almacen_nuevo } = req.body;

    // ===================================================
    // 🔒 BLOQUEAR MOVIMIENTO
    // ===================================================
    const [[mov]] = await conn.query(
      `SELECT * FROM movimientos_inventario WHERE id = ? FOR UPDATE`,
      [movimientoId]
    );

    if (!mov) throw new Error("Movimiento no encontrado");
    if (mov.estado !== "VALIDADO_LOGISTICA") {
      throw new Error("Este movimiento ya fue procesado");
    }

    // ===================================================
    // 🔐 VALIDAR QUE YA TENGA CANTIDAD REAL
    // ===================================================
    if (!mov.cantidad_real || mov.cantidad_real <= 0) {
      throw new Error("Debe guardar cantidad real antes de validar");
    }

    if (!mov.observaciones_contabilidad?.trim()) {
      throw new Error("Debe ingresar observaciones contables antes de validar");
    }

    // ===================================================
    // 📦 DETERMINAR ALMACÉN FINAL
    // ===================================================
    let almacenFinal = almacen_id || mov.almacen_id || null;

    if (almacen_nuevo) {
      const [r] = await conn.query(
        `INSERT INTO almacenes (nombre, empresa_id, fabricante_id) VALUES (?, ?, ?)`,
        [almacen_nuevo.trim(), mov.empresa_id, mov.fabricante_id || null]
      );
      almacenFinal = r.insertId;
    }

    // ===================================================
    // ✅ ACTUALIZAR SOLO CAMPOS DE CONTABILIDAD
    // (NO TOCAMOS op_vinculada, numero_orden, observaciones)
    // ===================================================
    await conn.query(
      `UPDATE movimientos_inventario
       SET estado = 'APROBADO_FINAL',
           usuario_contabilidad_id = ?,
           fecha_validacion_contabilidad = NOW(),
           almacen_id = ?
       WHERE id = ?`,
      [usuarioId, almacenFinal, movimientoId]
    );

    // ===================================================
    // 📝 REGISTRAR AUDITORÍA
    // ===================================================
    await conn.query(
      `INSERT INTO validaciones_movimiento
       (movimiento_id, rol, usuario_id, accion, observaciones, created_at)
       VALUES (?, 'CONTABILIDAD', ?, 'VALIDADO', 'Validado por contabilidad', NOW())`,
      [movimientoId, usuarioId]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("❌ validarMovimiento:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
},


rechazarMovimientoContabilidad: async (req, res) => {
  try {
    console.log("🧪 BODY:", req.body);

    const { movimientoId } = req.params;
    const { observaciones } = req.body;
    const usuarioId = req.user.id;

    if (!observaciones?.trim()) {
      return res.status(400).json({ error: "Debe ingresar observaciones del rechazo" });
    }

    if (!mov.cantidad_real || mov.cantidad_real <= 0) {
      return res.status(400).json({ error: "Debe guardar cantidad real antes de rechazar" });
    }

    const [result] = await pool.query(
      `
      UPDATE movimientos_inventario
      SET
        estado = 'RECHAZADO_CONTABILIDAD',
        usuario_contabilidad_id = ?,
        fecha_validacion_contabilidad = NOW(),
        motivo_contabilidad = ?
      WHERE id = ?
      `,
      [usuarioId, observaciones.trim(), movimientoId]
    );

    console.log("🧪 affectedRows:", result.affectedRows);

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    await pool.query(
      `
      INSERT INTO validaciones_movimiento
      (movimiento_id, rol, usuario_id, accion, observaciones)
      VALUES (?, 'CONTABILIDAD', ?, 'RECHAZADO', ?)
      `,
      [movimientoId, usuarioId, observaciones.trim()]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("❌ rechazarMovimientoContabilidad:", error);
    res.status(500).json({ error: "Error rechazando movimiento" });
  }
},






listarAlmacenesPorProducto: async (req, res) => {
  try {
    const { productoId, empresaId, fabricanteId, almacenSolicitadoId } = req.query;

    const [rows] = await pool.query(
      `
      SELECT DISTINCT
        a.id,
        a.nombre
      FROM almacenes a
      WHERE a.empresa_id = ?
        AND (
          a.id = ?
          OR EXISTS (
            SELECT 1
            FROM stock_producto sp
            WHERE sp.almacen_id = a.id
              AND sp.producto_id = ?
              AND sp.empresa_id = ?
              AND (
                (? IS NULL AND sp.fabricante_id IS NULL)
                OR sp.fabricante_id = ?
              )
              AND sp.cantidad > 0
          )
        )
      ORDER BY a.nombre
      `,
      [
        empresaId,
        almacenSolicitadoId || 0,
        productoId,
        empresaId,
        fabricanteId,
        fabricanteId,
      ]
    );

    res.json(rows);
  } catch (error) {
    console.error("❌ listarAlmacenesPorProducto:", error);
    res.status(500).json({ error: "Error cargando almacenes" });
  }
},



//LISTAR TODO COMPLETO PARA  CONTABILIDAD
// =====================================================
// 📋 LISTAR TODOS LOS MOVIMIENTOS (GLOBAL)
// =====================================================
listarMovimientosTodosContabilidad: async (req, res) => {
  try {
    const { estados } = req.query;
    const estadosArr = estados ? estados.split(",") : [];

    let sql = `
      SELECT
        mi.id,
        mi.producto_id,
        mi.empresa_id,
        mi.fabricante_id,
        mi.almacen_id,
        mi.tipo_movimiento,
        mi.op_vinculada,
        mi.cantidad,
        mi.cantidad_solicitada,
        mi.precio,
        mi.estado,
        mi.created_at AS fecha_creacion,
        mi.fecha_validacion_logistica,

        p.codigo AS producto_codigo,
        p.codigo_modelo,
        p.descripcion AS producto_descripcion,
        e.nombre AS empresa,
        a.nombre AS almacen,
        f.nombre AS fabricante,

        mi.observaciones AS observaciones_compras,

        (
          SELECT CONCAT(IFNULL(mrm.nombre, ''), ' - ', IFNULL(vm.observaciones, ''))
          FROM validaciones_movimiento vm
          LEFT JOIN motivos_rechazo_movimiento mrm
            ON mrm.id = mi.motivo_id
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS motivo_rechazo,
        (
          SELECT u.nombre
          FROM validaciones_movimiento vm
          INNER JOIN usuarios u ON u.id = vm.usuario_id
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS usuario_logistica

      FROM movimientos_inventario mi
      INNER JOIN productos p ON p.id = mi.producto_id
      INNER JOIN empresas e ON e.id = mi.empresa_id
      LEFT JOIN almacenes a ON a.id = mi.almacen_id
      LEFT JOIN fabricantes f ON f.id = mi.fabricante_id
      WHERE 1 = 1
    `;

    const params = [];

    if (estadosArr.length) {
      sql += ` AND mi.estado IN (${estadosArr.map(() => "?").join(",")})`;
      params.push(...estadosArr);
    }

    sql += " ORDER BY mi.created_at DESC";

    const [rows] = await pool.query(sql, params);
    console.log("🧪 MOVIMIENTOS GLOBAL SAMPLE:", rows[0]);
    res.json(rows);
  } catch (error) {
    console.error("❌ listarMovimientosTodos:", error);
    res.status(500).json({ error: "Error obteniendo movimientos" });
  }
},


// ✅ Listar todos los cambios de almacén
  listarCambiosAlmacenTodosContabilidad: async (req, res) => {
    try {
      const { estados } = req.query; // opcional: puedes enviar "PENDIENTE_SALIDA,PENDIENTE_INGRESO,VALIDADO_LOGISTICA"
      const estadosArray = estados ? estados.split(",") : ["PENDIENTE_SALIDA", "PENDIENTE_INGRESO"];

      const [rows] = await pool.query(
        `
        SELECT 
          ca.*,
          p.codigo AS codigo_producto,
          p.codigo_modelo,
          p.descripcion AS producto,
          eo.nombre AS empresa_origen,
          ao.nombre AS almacen_origen,
          ed.nombre AS empresa_destino,
          ad.nombre AS almacen_destino,
          f.nombre AS fabricante_origen,
          fd.nombre AS fabricante_destino,
          COALESCE(s_origen.cantidad, 0) AS cantidad_disponible,
          u.nombre AS usuario_logistica
        FROM cambios_almacen ca
        INNER JOIN productos p ON p.id = ca.producto_id
        INNER JOIN empresas eo ON eo.id = ca.empresa_origen_id
        INNER JOIN almacenes ao ON ao.id = ca.almacen_origen_id
        LEFT JOIN empresas ed ON ed.id = ca.empresa_id
        LEFT JOIN almacenes ad ON ad.id = ca.almacen_destino_id
        LEFT JOIN fabricantes f ON f.id = ca.fabricante_origen_id
        LEFT JOIN fabricantes fd ON fd.id = ca.fabricante_id
        LEFT JOIN stock_producto s_origen 
          ON s_origen.producto_id = ca.producto_id
          AND s_origen.empresa_id = ca.empresa_origen_id
          AND s_origen.almacen_id = ca.almacen_origen_id
          AND s_origen.fabricante_id = ca.fabricante_origen_id
        INNER JOIN usuarios u ON u.id = ca.usuario_logistica_id
        WHERE ca.estado IN (?)
        ORDER BY ca.created_at ASC
      `,
        [estadosArray]
      );

      res.json(rows);
    } catch (error) {
      console.error("❌ listarCambiosAlmacenTodos:", error);
      res.status(500).json({ error: "Error listando todos los cambios de almacén" });
    }
  },


  // =====================================================
  // 🔎 VALIDAR EXISTENCIA DE ENTRADA
  // =====================================================
validarStockDisponible: async (req, res) => {
  try {
    const { productoId, empresaId, almacenId, fabricanteId } = req.query;

    const [[row]] = await pool.query(
      `
      SELECT cantidad
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (? IS NULL AND fabricante_id IS NULL)
          OR fabricante_id = ?
        )
      `,
      [productoId, empresaId, almacenId, fabricanteId, fabricanteId]
    );

    res.json({ cantidad: row?.cantidad || 0 });
  } catch (error) {
    console.error("❌ validarStockDisponible:", error);
    res.status(500).json({ error: "Error validando stock" });
  }
},


  // =====================================================
  // 📋 LISTAR MOTIVOS DE RECHAZO
  // =====================================================
  listarMotivosRechazo: async (req, res) => {
    const [rows] = await pool.query(`
    SELECT id, nombre, mensaje_default
    FROM motivos_rechazo_movimiento
    WHERE activo = 1
    ORDER BY nombre
  `);

    res.json(rows);
  },

  // =====================================================
  // ❌ RECHAZAR MOVIMIENTO
  // =====================================================
rechazarMovimiento: async (req, res) => {
  try {
    const { movimientoId } = req.params;
    const { observaciones, motivoId } = req.body; // <-- aquí
    const usuarioId = req.user.id;

    if (!observaciones || !observaciones.trim()) {
      return res.status(400).json({ error: "Debe ingresar el motivo del rechazo" });
    }

    if (!motivoId) {
      return res.status(400).json({ error: "Debe seleccionar un motivo de rechazo" });
    }

    const [result] = await pool.query(
      `
      UPDATE movimientos_inventario
      SET
        estado = 'RECHAZADO_LOGISTICA',
        usuario_logistica_id = ?,
        fecha_validacion_logistica = NOW(),
        observaciones = CONCAT(IFNULL(observaciones,''), '\n', ?),
        motivo_id = ?
      WHERE id = ?
        AND estado = 'PENDIENTE_LOGISTICA'
    `,
      [usuarioId, observaciones, motivoId, movimientoId]
    );

    if (!result.affectedRows) {
      return res.status(400).json({ error: "Movimiento no válido para rechazar" });
    }

    await pool.query(
      `
      INSERT INTO validaciones_movimiento
      (movimiento_id, rol, usuario_id, accion, observaciones)
      VALUES (?, 'LOGISTICA', ?, 'RECHAZADO', ?)
    `,
      [movimientoId, usuarioId, observaciones]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("❌ rechazarMovimiento:", error);
    res.status(500).json({ error: "Error rechazando movimiento" });
  }
},


  // =====================================================
  // 📜 MOVIMIENTOS POR PRODUCTO
  // =====================================================
listarMovimientosPorProducto: async (req, res) => {
  try {
    const { productoId, estados } = req.query;

    const estadosArr = estados ? estados.split(",") : [];

    let sql = `
      SELECT
        mi.id,
        mi.producto_id,
        mi.empresa_id,
        mi.fabricante_id,
        mi.almacen_id,
        mi.tipo_movimiento,
        mi.op_vinculada,
        mi.cantidad,
        mi.cantidad_solicitada,
        mi.precio,
        mi.estado,
        mi.created_at AS fecha_creacion,
        mi.fecha_validacion_logistica,
        mi.cantidad_real,                      -- 🔥 AGREGADO
        mi.observaciones_contabilidad,         -- 🔥 AGREGADO

        p.codigo AS codigo_producto,
        p.codigo_modelo,
        p.descripcion AS producto,
        e.nombre AS empresa,
        a.nombre AS almacen,
        f.nombre AS fabricante,

        mi.observaciones AS observaciones_compras,

        (
          SELECT CONCAT(IFNULL(mrm.nombre, ''), ' - ', IFNULL(vm.observaciones, ''))
          FROM validaciones_movimiento vm
          LEFT JOIN motivos_rechazo_movimiento mrm
            ON mrm.id = mi.motivo_id
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS motivo_rechazo,
        (
          SELECT u.nombre
          FROM validaciones_movimiento vm
          INNER JOIN usuarios u ON u.id = vm.usuario_id
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS usuario_logistica,

        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'url', i.ruta
            )
          )
          FROM imagenes i
          WHERE i.movimiento_id = mi.id
            AND i.tipo = 'almacen'
        ) AS imagenes



      FROM movimientos_inventario mi
      INNER JOIN productos p ON p.id = mi.producto_id
      INNER JOIN empresas e ON e.id = mi.empresa_id
      LEFT JOIN almacenes a ON a.id = mi.almacen_id
      LEFT JOIN fabricantes f ON f.id = mi.fabricante_id
      WHERE mi.producto_id = ?
    `;

    const params = [productoId];

    if (estadosArr.length) {
      sql += ` AND mi.estado IN (${estadosArr.map(() => "?").join(",")})`;
      params.push(...estadosArr);
    }

    sql += " ORDER BY mi.created_at DESC";

    const [rows] = await pool.query(sql, params);
    console.log("🧪 MOVIMIENTOS POR PRODUCTO SAMPLE:", rows[0]);
    res.json(rows);
  } catch (error) {
    console.error("❌ listarMovimientosPorProducto logística:", error);
    res.status(500).json({ error: "Error obteniendo movimientos" });
  }
},



  // =====================================================
  // 📦 STOCK POR EMPRESA / ALMACÉN
  // =====================================================
 stockPorEmpresa: async (req, res) => {
  const { productoId } = req.query;

  const [rows] = await pool.query(
    `
    SELECT
      sp.producto_id,
      sp.empresa_id,
      e.nombre AS empresa,
      sp.almacen_id,
      a.nombre AS almacen,
      sp.fabricante_id,
      f.nombre AS fabricante,
      sp.cantidad,
      sp.updated_at
    FROM stock_producto sp
    INNER JOIN empresas e ON e.id = sp.empresa_id
    INNER JOIN almacenes a ON a.id = sp.almacen_id
    LEFT JOIN fabricantes f ON f.id = sp.fabricante_id
    WHERE sp.producto_id = ?
    `,
    [productoId]
  );

  res.json(rows);
},




  // =====================================================
  // 📦 STOCK COMPLETO AGRUPADO (SIMPLES + VARIANTES)
  // =====================================================
// =====================================================
// 📦 STOCK COMPLETO AGRUPADO (ROBUSTO)
// =====================================================
stockCompleto: async (req, res) => {
  try {
    const sql = `
      SELECT
        p.id AS producto_id,
        p.codigo,
        p.codigo_modelo,
        p.producto_padre_id,
        padre.codigo AS codigo_padre,
        c.nombre AS categoria,

        e.nombre AS empresa,
        a.nombre AS almacen,
        f.nombre AS fabricante,

        sp.cantidad AS stock,
        p.created_at
      FROM stock_producto sp
      INNER JOIN productos p ON p.id = sp.producto_id
      LEFT JOIN productos padre ON padre.id = p.producto_padre_id
      LEFT JOIN categorias c ON c.id = p.categoria_id
      INNER JOIN empresas e ON e.id = sp.empresa_id
      INNER JOIN almacenes a ON a.id = sp.almacen_id
      LEFT JOIN fabricantes f ON f.id = sp.fabricante_id
      WHERE sp.cantidad <> 0
      ORDER BY p.created_at DESC
    `;

    const [rows] = await pool.query(sql);

    // 1️⃣ construir mapa de prefijos
    const prefijos = {};

    rows.forEach(r => {
      const base = obtenerCodigoBaseRobusto(r.codigo);
      if (!prefijos[base]) prefijos[base] = [];
      prefijos[base].push(r.codigo);
    });

    // 2️⃣ solo prefijos con MÁS DE 1 producto son grupo
    const gruposValidos = new Set(
      Object.keys(prefijos).filter(k => prefijos[k].length > 1)
    );

    const agrupado = {};

    rows.forEach(r => {
      let codigoBase = "";
      let codigoProducto = r.codigo;

      if (r.producto_padre_id) {
        codigoBase = r.codigo_padre;
        codigoProducto = r.codigo_modelo;
      } else {
        const posibleBase = obtenerCodigoBaseRobusto(r.codigo);
        if (gruposValidos.has(posibleBase)) {
          codigoBase = posibleBase;
        }
      }

      const key = codigoBase || `UNICO-${r.producto_id}`;

      if (!agrupado[key]) {
        agrupado[key] = {
          codigo_base: codigoBase,
          stock_total: 0,
          productos: []
        };
      }

      const stock = Number(r.stock);

      agrupado[key].productos.push({
        producto_id: r.producto_id,
        codigo_producto: codigoProducto,
        empresa: r.empresa,
        almacen: r.almacen,
        fabricante: r.fabricante || "SIN FABRICANTE",
        categoria: r.categoria || "-",
        stock
      });

      agrupado[key].stock_total += stock;
    });

    res.json(Object.values(agrupado));
  } catch (error) {
    console.error("❌ stockCompleto:", error);
    res.status(500).json({ error: "Error obteniendo stock completo" });
  }
},
  // =====================================================
  // 📜 HISTORIAL POR PRODUCTO
  // =====================================================
  listarHistorial: async (req, res) => {
    try {
      const { productoId } = req.query;

      if (!productoId) return res.json([]);

      const [rows] = await pool.query(
        `
      SELECT
        mi.id,
        mi.tipo_movimiento,
        mi.cantidad,
        mi.precio,
        mi.estado,
        mi.created_at AS fecha_creacion,
        mi.fecha_validacion_logistica AS fecha_validacion_logistica,
        mi.op_vinculada,

        p.codigo AS codigo_producto,
        p.codigo_modelo,
        p.descripcion AS producto,
        e.nombre AS empresa,
        a.nombre AS almacen,
        f.nombre AS fabricante

      FROM movimientos_inventario mi
      INNER JOIN productos p ON p.id = mi.producto_id
      INNER JOIN empresas e ON e.id = mi.empresa_id
      INNER JOIN almacenes a ON a.id = mi.almacen_id
      LEFT JOIN fabricantes f ON f.id = mi.fabricante_id
      WHERE mi.producto_id = ?
        AND mi.estado IN (
          'VALIDADO_LOGISTICA',
          'PENDIENTE_CONTABILIDAD',
          'RECHAZADO_LOGISTICA',
          'APROBADO_FINAL'
        )
      ORDER BY mi.created_at DESC
    `,
        [productoId]
      );

      res.json(rows);
    } catch (error) {
      console.error("❌ listarHistorial logística:", error);
      res.status(500).json({ error: "Error listando historial logística" });
    }
  },
  





  // =====================================================
// 🔁 CREAR CAMBIO DE ALMACÉN (NO TOCA STOCK)
// =====================================================

// =====================================================
// 🏬 ALMACENES POR EMPRESA
// =====================================================
listarAlmacenesPorEmpresa: async (req, res) => {
  try {
    const { empresa_id } = req.query;
    if (!empresa_id)
      return res.status(400).json({ error: "empresa_id requerido" });

    const [rows] = await pool.query(
      `
      SELECT id, nombre
      FROM almacenes
      WHERE empresa_id = ?
      ORDER BY nombre ASC
      `,
      [empresa_id]
    );

    res.json(rows);
  } catch (error) {
    console.error("❌ listarAlmacenesPorEmpresa:", error);
    res.status(500).json({ error: "Error listando almacenes" });
  }
},

// =====================================================
// 🏭 FABRICANTES POR ALMACÉN
// =====================================================
listarFabricantesPorAlmacen: async (req, res) => {
  try {
    const { empresa_id, almacen_id } = req.query;
    if (!empresa_id || !almacen_id)
      return res
        .status(400)
        .json({ error: "empresa_id y almacen_id requeridos" });

    const [rows] = await pool.query(
      `
        SELECT DISTINCT f.id, f.nombre
        FROM fabricantes f
        LEFT JOIN stock_producto sp
          ON sp.fabricante_id = f.id
        AND sp.empresa_id = ?
        AND sp.almacen_id = ?
        ORDER BY f.nombre ASC

      `,
      [empresa_id, almacen_id]
    );

    res.json(rows);
  } catch (error) {
    console.error("❌ listarFabricantesPorAlmacen:", error);
    res.status(500).json({ error: "Error listando fabricantes" });
  }
},

// =====================================================
  // 🔁 CREAR CAMBIO DE ALMACÉN (NO MUEVE STOCK)
  // =====================================================
 // =====================================================
// 🔁 CREAR CAMBIO DE ALMACÉN (NO MUEVE STOCK)
// =====================================================
crearCambioAlmacen: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      producto_id,
      empresa_id, // empresa ORIGEN
      fabricante_id, // fabricante ORIGEN
      almacen_origen_id,
      empresa_destino_id,
      empresa_destino_nuevo,
      almacen_destino_id,
      almacen_destino_nuevo,
      fabricante_destino_id,
      fabricante_destino_nuevo,
      cantidad,
      observaciones,
    } = req.body;

    const usuarioId = req.user.id;

    const productoId = Number(producto_id);
    const empresaOrigenId = Number(empresa_id);
    const almacenOrigenId = Number(almacen_origen_id);
    const fabricanteOrigenId = fabricante_id ? Number(fabricante_id) : null;
    const cant = Number(cantidad);

    if (!productoId || !empresaOrigenId || !almacenOrigenId || !cant) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    if (!Number.isInteger(cant) || cant <= 0) {
      return res.status(400).json({ error: "Cantidad inválida" });
    }

    await conn.beginTransaction();

    console.log("🧪 BUSCANDO STOCK ORIGEN:", {
      productoId,
      empresaOrigenId,
      almacenOrigenId,
      fabricanteOrigenId,
    });

    const [[stock]] = await conn.query(
      `
      SELECT id, cantidad
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (? IS NULL AND fabricante_id IS NULL)
          OR fabricante_id = ?
        )
      FOR UPDATE
      `,
      [
        productoId,
        empresaOrigenId,
        almacenOrigenId,
        fabricanteOrigenId,
        fabricanteOrigenId,
      ]
    );

    if (!stock) throw new Error("No existe stock en almacén origen");
    if (cant > stock.cantidad)
      throw new Error(`Stock insuficiente. Disponible: ${stock.cantidad}`);

    // =========================
    // 🏢 EMPRESA DESTINO
    // =========================
    let empresaDestinoFinal = empresa_destino_id
      ? Number(empresa_destino_id)
      : null;

    if (!empresaDestinoFinal && empresa_destino_nuevo?.trim()) {
      const [r] = await conn.query(
        `INSERT INTO empresas (nombre) VALUES (?)`,
        [empresa_destino_nuevo.trim()]
      );
      empresaDestinoFinal = r.insertId;
    }

    if (!empresaDestinoFinal) empresaDestinoFinal = empresaOrigenId;

    // =========================
    // 🏬 ALMACÉN DESTINO
    // =========================
    let almacenDestinoFinal = almacen_destino_id
      ? Number(almacen_destino_id)
      : null;

    if (!almacenDestinoFinal && almacen_destino_nuevo?.trim()) {
      const [r] = await conn.query(
        `INSERT INTO almacenes (nombre, empresa_id) VALUES (?, ?)`,
        [almacen_destino_nuevo.trim(), empresaDestinoFinal]
      );
      almacenDestinoFinal = r.insertId;
    }

    if (!almacenDestinoFinal)
      throw new Error("Debe seleccionar o crear almacén destino");

    // =========================
    // 🏭 FABRICANTE DESTINO
    // =========================
    let fabricanteDestinoFinal = fabricante_destino_id
      ? Number(fabricante_destino_id)
      : null;

    if (!fabricanteDestinoFinal && fabricante_destino_nuevo?.trim()) {
      const [r] = await conn.query(
        `INSERT INTO fabricantes (nombre) VALUES (?)`,
        [fabricante_destino_nuevo.trim()]
      );
      fabricanteDestinoFinal = r.insertId;
    }

    if (!fabricanteDestinoFinal) fabricanteDestinoFinal = fabricanteOrigenId;

    // =========================
    // 📝 INSERT REAL
    // =========================
    const [rCambio] = await conn.query(
      `
      INSERT INTO cambios_almacen (
        producto_id,
        empresa_origen_id,
        fabricante_origen_id,
        empresa_id,
        fabricante_id,
        almacen_origen_id,
        almacen_destino_id,
        cantidad,
        estado,
        usuario_logistica_id,
        observaciones
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE_SALIDA', ?, ?)
      `,
      [
        productoId,
        empresaOrigenId,
        fabricanteOrigenId,
        empresaDestinoFinal,
        fabricanteDestinoFinal,
        almacenOrigenId,
        almacenDestinoFinal,
        cant,
        usuarioId,
        observaciones || null,
      ]
    );

    await conn.commit();
    res.json({ ok: true, cambioId: rCambio.insertId });
  } catch (error) {
    await conn.rollback();
    console.error("❌ crearCambioAlmacen:", error);
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
},



// =====================================================
// ✅ VALIDAR CAMBIO DE ALMACÉN CON EDICIÓN (🔥 MUEVE STOCK)
// =====================================================
validarCambioAlmacenConEdicion: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const usuarioId = req.user.id;
    const {
      empresa_destino_id,
      almacen_destino_id,
      fabricante_destino_id,
      cantidad,
      observaciones,
    } = req.body;

    // 🔹 convertir a Number
    const cant = Number(cantidad);
    const almacenDestinoId = Number(almacen_destino_id);

    if (!almacenDestinoId || !cant) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }
    if (!Number.isInteger(cant) || cant <= 0) {
      return res.status(400).json({ error: "Cantidad inválida" });
    }

    await conn.beginTransaction();

    const [[cambio]] = await conn.query(
      `SELECT * FROM cambios_almacen WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!cambio) throw new Error("Cambio no encontrado");
    if (cambio.estado !== "PENDIENTE_SALIDA") throw new Error("Este cambio ya fue procesado");

    const {
      producto_id,
      empresa_origen_id,
      fabricante_origen_id,
      almacen_origen_id,
    } = cambio;

    // usar valores por defecto si no se envió
    const empresaDestinoId = empresa_destino_id
      ? Number(empresa_destino_id)
      : cambio.empresa_destino_id
      ? Number(cambio.empresa_destino_id)
      : empresa_origen_id;

    const fabricanteDestinoId = fabricante_destino_id
      ? Number(fabricante_destino_id)
      : cambio.fabricante_destino_id
      ? Number(cambio.fabricante_destino_id)
      : fabricante_origen_id || null;

    // 🔒 STOCK ORIGEN
    const [[stockOrigen]] = await conn.query(
      `
      SELECT id, cantidad
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (? IS NULL AND fabricante_id IS NULL)
          OR fabricante_id = ?
        )
      FOR UPDATE
      `,
      [producto_id, empresa_origen_id, almacen_origen_id, fabricante_origen_id, fabricante_origen_id]
    );
    if (!stockOrigen) throw new Error("No existe stock en almacén origen");
    if (cant > stockOrigen.cantidad) throw new Error(`Stock insuficiente. Disponible: ${stockOrigen.cantidad}`);

    // 🔒 STOCK DESTINO
    const [[stockDestino]] = await conn.query(
      `
      SELECT id, cantidad
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (? IS NULL AND fabricante_id IS NULL)
          OR fabricante_id = ?
        )
      FOR UPDATE
      `,
      [producto_id, empresaDestinoId, almacenDestinoId, fabricanteDestinoId, fabricanteDestinoId]
    );

    // 📤 RESTAR ORIGEN
    await conn.query(`UPDATE stock_producto SET cantidad = cantidad - ? WHERE id = ?`, [cant, stockOrigen.id]);

    // 📥 SUMAR DESTINO
    if (stockDestino) {
      await conn.query(`UPDATE stock_producto SET cantidad = cantidad + ? WHERE id = ?`, [cant, stockDestino.id]);
    } else {
      await conn.query(
        `INSERT INTO stock_producto (producto_id, empresa_id, almacen_id, fabricante_id, cantidad)
         VALUES (?, ?, ?, ?, ?)`,
        [producto_id, empresaDestinoId, almacenDestinoId, fabricanteDestinoId, cant]
      );
    }

    // ✅ ACTUALIZAR CAMBIO
    await conn.query(
      `UPDATE cambios_almacen
       SET empresa_id = ?, fabricante_id = ?, almacen_destino_id = ?, cantidad = ?, estado = 'COMPLETADO', fecha_salida = NOW(), fecha_ingreso = NOW(), observaciones = ?
       WHERE id = ?`,
      [empresaDestinoId, fabricanteDestinoId, almacenDestinoId, cant, observaciones || null, id]
    );

    // 📝 AUDITORÍA
    await conn.query(
      `INSERT INTO validaciones_cambios_almacen (cambio_id, usuario_id, accion, observaciones)
       VALUES (?, ?, 'VALIDADO', ?)`,
      [id, usuarioId, observaciones || null]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("❌ validarCambioAlmacenConEdicion:", error);
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
},


  // =====================================================
  // 📋 LISTAR CAMBIOS DE ALMACÉN PENDIENTES
listarCambiosAlmacenPendientes: async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        ca.*,
        p.codigo AS codigo_producto,
        p.codigo_modelo,
        p.descripcion AS producto,
        eo.nombre AS empresa_origen,
        ao.nombre AS almacen_origen,
        ed.nombre AS empresa_destino,
        ad.nombre AS almacen_destino,
        f.nombre AS fabricante_origen,
        fd.nombre AS fabricante_destino,
        
        -- ✅ Stock disponible en ORIGEN
        COALESCE(s_origen.cantidad, 0) AS cantidad_disponible,

        u.nombre AS usuario_logistica

      FROM cambios_almacen ca
      INNER JOIN productos p ON p.id = ca.producto_id
      INNER JOIN empresas eo ON eo.id = ca.empresa_origen_id
      INNER JOIN almacenes ao ON ao.id = ca.almacen_origen_id
      LEFT JOIN empresas ed ON ed.id = ca.empresa_id
      LEFT JOIN almacenes ad ON ad.id = ca.almacen_destino_id
      LEFT JOIN fabricantes f ON f.id = ca.fabricante_origen_id
      LEFT JOIN fabricantes fd ON fd.id = ca.fabricante_id

      -- ✅ JOIN con stock ORIGEN
      LEFT JOIN stock_producto s_origen
        ON s_origen.producto_id = ca.producto_id
        AND s_origen.empresa_id = ca.empresa_origen_id
        AND s_origen.almacen_id = ca.almacen_origen_id
        AND s_origen.fabricante_id = ca.fabricante_origen_id

      INNER JOIN usuarios u ON u.id = ca.usuario_logistica_id
      WHERE ca.estado IN ('PENDIENTE_SALIDA','PENDIENTE_INGRESO')
      ORDER BY ca.created_at ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error("❌ listarCambiosAlmacenPendientes:", error);
    res.status(500).json({ error: "Error listando cambios de almacén" });
  }
},



  // =====================================================
  // ✅ VALIDAR CAMBIO DE ALMACÉN (🔥 MUEVE STOCK)
  // =====================================================
validarCambioAlmacen: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const usuarioId = req.user.id;

    await conn.beginTransaction();

    const [[cambio]] = await conn.query(
      `SELECT * FROM cambios_almacen WHERE id = ? FOR UPDATE`,
      [id]
    );

    if (!cambio) throw new Error("Cambio no encontrado");
    if (cambio.estado !== "PENDIENTE_SALIDA")
      throw new Error("Este cambio ya fue procesado");

    const {
      producto_id,
      empresa_origen_id,
      fabricante_origen_id,
      almacen_origen_id,
      empresa_id, // DESTINO
      fabricante_id, // DESTINO
      almacen_destino_id,
      cantidad,
    } = cambio;

    console.log("🧪 VALIDANDO CAMBIO:", cambio);

    // 🔒 STOCK ORIGEN
    const [[stockOrigen]] = await conn.query(
      `
      SELECT id, cantidad
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (? IS NULL AND fabricante_id IS NULL)
          OR fabricante_id = ?
        )
      FOR UPDATE
      `,
      [
        producto_id,
        empresa_origen_id,
        almacen_origen_id,
        fabricante_origen_id,
        fabricante_origen_id,
      ]
    );

    console.log("🧪 STOCK ORIGEN:", stockOrigen);

    if (!stockOrigen)
      throw new Error("No existe stock en almacén origen");
    if (cantidad > stockOrigen.cantidad)
      throw new Error(`Stock insuficiente. Disponible: ${stockOrigen.cantidad}`);

    // 🔒 STOCK DESTINO
    const [[stockDestino]] = await conn.query(
      `
      SELECT id, cantidad
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (? IS NULL AND fabricante_id IS NULL)
          OR fabricante_id = ?
        )
      FOR UPDATE
      `,
      [
        producto_id,
        empresa_id,
        almacen_destino_id,
        fabricante_id,
        fabricante_id,
      ]
    );

    console.log("🧪 STOCK DESTINO:", stockDestino);

    // 📤 RESTAR ORIGEN
    await conn.query(
      `UPDATE stock_producto SET cantidad = cantidad - ? WHERE id = ?`,
      [cantidad, stockOrigen.id]
    );

    // 📥 SUMAR DESTINO
    if (stockDestino) {
      await conn.query(
        `UPDATE stock_producto SET cantidad = cantidad + ? WHERE id = ?`,
        [cantidad, stockDestino.id]
      );
    } else {
      await conn.query(
        `
        INSERT INTO stock_producto
        (producto_id, empresa_id, almacen_id, fabricante_id, cantidad)
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          producto_id,
          empresa_id,
          almacen_destino_id,
          fabricante_id,
          cantidad,
        ]
      );
    }

    // ✅ MARCAR CAMBIO
    await conn.query(
      `
      UPDATE cambios_almacen
      SET estado = 'COMPLETADO',
          fecha_salida = NOW(),
          fecha_ingreso = NOW()
      WHERE id = ?
      `,
      [id]
    );

    // 📝 AUDITORÍA
    await conn.query(
      `
      INSERT INTO validaciones_cambios_almacen
      (cambio_id, usuario_id, accion)
      VALUES (?, ?, 'VALIDADO')
      `,
      [id, usuarioId]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("❌ validarCambioAlmacen:", error);
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
},





  // =====================================================
  // ❌ RECHAZAR CAMBIO DE ALMACÉN
  // =====================================================
  rechazarCambioAlmacen: async (req, res) => {
    try {
      const { id } = req.params;
      const { observaciones } = req.body;
      const usuarioId = req.user.id;

      if (!observaciones?.trim()) {
        return res.status(400).json({ error: "Debe indicar motivo de rechazo" });
      }

      const [r] = await pool.query(
        `
        UPDATE cambios_almacen
        SET estado = 'RECHAZADO'
        WHERE id = ?
          AND estado = 'PENDIENTE_SALIDA'
        `,
        [id]
      );

      if (!r.affectedRows) {
        return res
          .status(400)
          .json({ error: "Cambio no válido para rechazar" });
      }

      await pool.query(
        `
        INSERT INTO validaciones_cambios_almacen
        (cambio_id, usuario_id, accion, observaciones)
        VALUES (?, ?, 'RECHAZADO', ?)
        `,
        [id, usuarioId, observaciones]
      );

      res.json({ ok: true });
    } catch (error) {
      console.error("❌ rechazarCambioAlmacen:", error);
      res.status(500).json({ error: "Error rechazando cambio de almacén" });
    }
  },

  // =====================================================
  // 🏢 LISTAR EMPRESAS
  // =====================================================
  listarEmpresasContabilidad: async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, nombre FROM empresas ORDER BY nombre ASC`
      );
      res.json(rows);
    } catch (error) {
      console.error("❌ listarEmpresasLogistica:", error);
      res.status(500).json({ error: "Error listando empresas" });
    }
  },

  // =====================================================
  // 🏬 LISTAR ALMACENES (LIBRE, SIN EMPRESA)
  // =====================================================
  listarAlmacenes: async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, nombre FROM almacenes ORDER BY nombre ASC`
      );
      res.json(rows);
    } catch (error) {
      console.error("❌ listarAlmacenes:", error);
      res.status(500).json({ error: "Error listando almacenes" });
    }
  },

  // =====================================================
  // 🏭 LISTAR FABRICANTES
  // =====================================================
  listarFabricantes: async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, nombre FROM fabricantes WHERE activo = 1 ORDER BY nombre ASC`
      );
      res.json(rows);
    } catch (error) {
      console.error("❌ listarFabricantes:", error);
      res.status(500).json({ error: "Error listando fabricantes" });
    }
  },









  //CONTABILIDAD
  // =====================================================
// ✅ VALIDAR MOVIMIENTO (CORE ERP)
//// =====================================================
// ✅ LISTAR PENDIENTES CONTABILIDAD
// =====================================================
listarPendientes: async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.*, 
             p.descripcion AS producto,
             e.nombre AS empresa,
             a.nombre AS almacen
      FROM movimientos_inventario m
      LEFT JOIN productos p ON p.id = m.producto_id
      LEFT JOIN empresas e ON e.id = m.empresa_id
      LEFT JOIN almacenes a ON a.id = m.almacen_id
      WHERE m.estado = 'VALIDADO_LOGISTICA'
      ORDER BY m.created_at DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("❌ listarPendientes:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
},

// =====================================================
// ✅ LISTAR RECHAZADOS CONTABILIDAD
// =====================================================
listarRechazadosContabilidad: async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.*, 
             p.descripcion AS producto,
             e.nombre AS empresa,
             a.nombre AS almacen
      FROM movimientos_inventario m
      LEFT JOIN productos p ON p.id = m.producto_id
      LEFT JOIN empresas e ON e.id = m.empresa_id
      LEFT JOIN almacenes a ON a.id = m.almacen_id
      WHERE m.estado = 'RECHAZADO_CONTABILIDAD'
      ORDER BY m.fecha_validacion_contabilidad DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("❌ listarRechazadosContabilidad:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
},

// =====================================================
// ✅ LISTAR APROBADOS FINAL
// =====================================================
listarAprobadosFinal: async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.*, 
             p.descripcion AS producto,
             e.nombre AS empresa,
             a.nombre AS almacen
      FROM movimientos_inventario m
      LEFT JOIN productos p ON p.id = m.producto_id
      LEFT JOIN empresas e ON e.id = m.empresa_id
      LEFT JOIN almacenes a ON a.id = m.almacen_id
      WHERE m.estado = 'APROBADO_FINAL'
      ORDER BY m.fecha_validacion_contabilidad DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("❌ listarAprobadosFinal:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
},



// =====================================================
// ❌ RECHAZAR MOVIMIENTO
// =====================================================
rechazarMovimiento: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { movimientoId } = req.params;
    const { motivo } = req.body;
    const usuarioId = req.user.id;

    const [[mov]] = await conn.query(
      `SELECT * FROM movimientos_inventario WHERE id=? FOR UPDATE`,
      [movimientoId]
    );
    if (!mov) throw new Error("Movimiento no encontrado");
    if (mov.estado !== "VALIDADO_LOGISTICA") {
      throw new Error("Este movimiento ya fue procesado");
    }

    await conn.query(
      `UPDATE movimientos_inventario
       SET estado='RECHAZADO_CONTABILIDAD',
           usuario_contabilidad_id=?,
           fecha_validacion_contabilidad=NOW()
       WHERE id=?`,
      [usuarioId, movimientoId]
    );

    await conn.query(
      `INSERT INTO validaciones_movimiento
       (movimiento_id, rol, usuario_id, accion, observaciones, created_at)
       VALUES (?, 'CONTABILIDAD', ?, 'RECHAZADO', ?, NOW())`,
      [movimientoId, usuarioId, motivo || "Rechazado por contabilidad"]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("❌ rechazarMovimiento:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
},

// =====================================================
// ✅ EIVDENICA Y IMAGEN DE CONTABILIDAD IMÁGENES)
// =====================================================

subirEvidenciaContabilidad: async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, error: "No se enviaron imágenes" });
    }

    const imagenesInsertadas = [];

    for (const file of req.files) {
      // Subir usando buffer si usas memoryStorage
      const data = file.buffer || file.path;
      if (!data) throw new Error("Archivo inválido");

      const result = await cloudinary.uploader.upload(data, {
        folder: "evidencias_contabilidad",
        resource_type: "image",
      });

      // Insertar con public_id real
      await pool.query(
        `INSERT INTO imagenes (movimiento_id, producto_id, ruta, tipo, storage_key, storage_provider)
         VALUES (?, NULL, ?, 'contabilidad', ?, 'cloudinary')`,
        [req.params.id, result.secure_url, result.public_id]
      );

      imagenesInsertadas.push({
        ruta: storagePath,
        url: resolveImageUrl({
          storage_provider: 'cloudinary',
          storage_key: storagePath
        })
      });

    }

    res.json({ ok: true, imagenes: imagenesInsertadas });
  } catch (err) {
    console.error("subirEvidenciaContabilidad:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
},



// =====================================================
// ✅ DETALLE MOVIMIENTO (CON AUDITORÍA Y IMÁGENES)
// =====================================================
detalleMovimiento: async (req, res) => {
  try {
    const { id } = req.params;

    const [movs] = await pool.query(
      `SELECT 
         m.*,
         u.nombre AS usuario_creador,
         uc.nombre AS usuario_contabilidad,   -- 🔥 AQUI
         p.descripcion AS producto,
         e.nombre AS empresa,
         a.nombre AS almacen,
         f.nombre AS fabricante,
        -- 🔥 NUEVO: imagen de evidencia del movimiento
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'url', i.ruta
            )
          )
          FROM imagenes i
          WHERE i.movimiento_id = m.id
            AND i.tipo = 'almacen'
        ) AS imagenes,

        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'url', i.ruta
            )
          )
          FROM imagenes i
          WHERE i.movimiento_id = m.id
            AND i.tipo = 'contabilidad'
        ) AS imagenes_contabilidad



       FROM movimientos_inventario m
       LEFT JOIN usuarios uc ON uc.id = m.usuario_contabilidad_id
       LEFT JOIN usuarios u ON u.id = m.usuario_creador_id
       LEFT JOIN productos p ON p.id = m.producto_id
       LEFT JOIN empresas e ON e.id = m.empresa_id
       LEFT JOIN almacenes a ON a.id = m.almacen_id
       LEFT JOIN fabricantes f ON f.id = m.fabricante_id
       WHERE m.id = ?`,
      [id]
    );

    if (!movs[0]) {
      return res.status(404).json({ ok: false, msg: "Movimiento no encontrado" });
    }

    const movimiento = movs[0];

    const [validaciones] = await pool.query(
      `SELECT 
         v.*, 
         u.nombre AS usuario
       FROM validaciones_movimiento v
       LEFT JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.movimiento_id = ?
       ORDER BY v.created_at ASC`,
      [id]
    );

    const logistica = validaciones.find(v => v.rol === "LOGISTICA") || {};
    

    res.json({
      ...movimiento,
      usuario_logistica: logistica.usuario || null,
      observacion_logistica: logistica.observaciones || null,

      // 🔥 YA VIENE DESDE movimientos_inventario
      observacion_contabilidad: movimiento.observaciones_contabilidad || null,
      motivo_contabilidad: movimiento.motivo_contabilidad || null,

      validaciones,
    });
  } catch (error) {
    console.error("❌ detalleMovimiento:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
},



// =====================================================
// 💾 GUARDAR CANTIDAD REAL
// =====================================================
guardarCantidadReal: async (req, res) => {
  try {
    const { id } = req.params;
    const { cantidad_real } = req.body;
    const usuarioId = req.user?.id;

    if (!cantidad_real || cantidad_real <= 0)
      return res.status(400).json({ ok: false, msg: "Cantidad real obligatoria" });

    if (!usuarioId)
      return res.status(401).json({ ok: false, msg: "Usuario no autenticado" });

    const [movs] = await pool.query(`SELECT * FROM movimientos_inventario WHERE id = ?`, [id]);
    if (!movs[0])
      return res.status(404).json({ ok: false, msg: "Movimiento no encontrado" });

    await pool.query(
      `UPDATE movimientos_inventario SET cantidad_real = ?, updated_at = NOW() WHERE id = ?`,
      [cantidad_real, id]
    );

    await pool.query(
      `INSERT INTO validaciones_movimiento
       (movimiento_id, rol, usuario_id, accion, observaciones, created_at)
       VALUES (?, 'CONTABILIDAD', ?, 'VALIDADO', ?, NOW())`,
      [id, usuarioId, `Cantidad real actualizada: ${cantidad_real}`]
    );

    res.json({ ok: true, msg: "Cantidad real guardada y auditada correctamente" });
  } catch (error) {
    console.error("❌ guardarCantidadReal:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
},

guardarGeneralMovimiento: async (req, res) => {
  const conn = await pool.getConnection();
  console.log("REQ.USER COMPLETO:", req.user);
  console.log("USUARIO ID:", req.user?.id);

  try {
    await conn.beginTransaction();

    const { movimientoId } = req.params;
    const usuarioId = req.user.id;
    const { cantidad_real, observaciones_contabilidad } = req.body;

    if (!cantidad_real || Number(cantidad_real) <= 0) {
      throw new Error("Cantidad real inválida");
    }

    if (!observaciones_contabilidad?.trim()) {
      throw new Error("Observaciones obligatorias");
    }

    // 🔒 Bloquear movimiento
    const [[mov]] = await conn.query(
      `SELECT * FROM movimientos_inventario WHERE id = ? FOR UPDATE`,
      [movimientoId]
    );

    if (!mov) throw new Error("Movimiento no encontrado");

    // ===================================================
    // 🖼 SUBIR IMÁGENES CONTABILIDAD
    // ===================================================
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploaded = await uploadImage(
          file.buffer,
          `movimientos-contabilidad/${movimientoId}-${Date.now()}`
        );

        await conn.query(
          `
          INSERT INTO imagenes
          (movimiento_id, tipo, ruta, storage_key, storage_provider)
          VALUES (?, 'contabilidad', ?, ?, ?)
          `,
          [
            movimientoId,
            uploaded.url,
            uploaded.storage_key,
            uploaded.storage_provider,
          ]
        );
      }
    }

    // ===================================================
    // 📝 Guardar datos contables
    // ===================================================
    await conn.query(
      `
      UPDATE movimientos_inventario
      SET
        cantidad_real = ?,
        observaciones_contabilidad = ?,
        usuario_contabilidad_id = ?        -- 🔥 AQUI

      WHERE id = ?
      `,
      [
        cantidad_real,
        observaciones_contabilidad.trim(),
        usuarioId,        // 🔥 AQUI
        movimientoId
      ]
    );

    await conn.commit();

    // 🔥 Devolver imágenes actualizadas
    const [imagenes] = await conn.query(
      `
      SELECT JSON_ARRAYAGG(
        JSON_OBJECT(
          'url', ruta
        )
      ) AS imagenes
      FROM imagenes
      WHERE movimiento_id = ?
        AND tipo = 'contabilidad'
      `,
      [movimientoId]
    );

    res.json({
      ok: true,
      imagenes: imagenes[0].imagenes
        ? JSON.parse(imagenes[0].imagenes)
        : [],
    });

  } catch (error) {
    await conn.rollback();
    console.error("❌ guardarGeneralMovimiento:", error);
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
},

};
