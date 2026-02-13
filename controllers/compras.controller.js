  const { initDB } = require("../config/db");

  const upload = require("../middlewares/upload");
  const { uploadImage } = require("../services/storage.service");

  const { getOrCreate } = require("../utils/getOrCreate");



  

  let pool;
  (async () => pool = await initDB())();






  const actualizarStock = async (conn, {
  producto_id,
  empresa_id,
  almacen_id,
  fabricante_id,
  cantidad,
  tipo // "entrada" | "salida"
}) => {
  const delta = tipo === "salida" ? -Number(cantidad) : Number(cantidad);

  const [[row]] = await conn.query(
    `
    SELECT id, cantidad
    FROM stock_producto
    WHERE producto_id = ?
      AND empresa_id = ?
      AND almacen_id = ?
      AND (
        (fabricante_id IS NULL AND ? IS NULL)
        OR fabricante_id = ?
      )
    LIMIT 1
    `,
    [producto_id, empresa_id, almacen_id, fabricante_id, fabricante_id]
  );

  if (row) {
    const nuevaCantidad = Number(row.cantidad) + delta;

    if (nuevaCantidad < 0) {
      throw new Error("Stock insuficiente");
    }

    await conn.query(
      `
      UPDATE stock_producto
      SET cantidad = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [nuevaCantidad, row.id]
    );
  } else {
    if (delta < 0) {
      throw new Error("No existe stock para realizar salida");
    }

    await conn.query(
      `
      INSERT INTO stock_producto
      (producto_id, empresa_id, almacen_id, fabricante_id, cantidad)
      VALUES (?,?,?,?,?)
      `,
      [producto_id, empresa_id, almacen_id, fabricante_id || null, delta]
    );
  }
};

  const transporter = require("../config/transporter");



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

    

listarProductos: async (req, res) => {
  const search = req.query.search || "";

  const [rows] = await pool.query(`
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

      -- ✅ STOCK TOTAL:
      -- Si es simple → su propio stock
      -- Si es catálogo → suma stock de sus variantes
      CASE
        WHEN p.es_catalogo = 1 THEN (
          SELECT COALESCE(SUM(spv.cantidad), 0)
          FROM productos pv
          LEFT JOIN stock_producto spv ON spv.producto_id = pv.id
          WHERE pv.producto_padre_id = p.id
        )
        ELSE COALESCE(SUM(sp.cantidad), 0)
      END AS stock_total,

      -- ✅ VARIANTES DETALLADAS
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

    LEFT JOIN stock_producto sp
      ON sp.producto_id = p.id

    LEFT JOIN categorias c
      ON c.id = p.categoria_id

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
      AND p.eliminado = 0  
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
  `, [
    `%${search}%`,
    `%${search}%`,
    `%${search}%`,
    `%${search}%`
  ]);

  res.json({ productos: rows });
},



listarCategorias: async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, nombre
    FROM categorias
    ORDER BY nombre
  `);

  res.json({ categorias: rows });
},



  obtenerProducto: async (req, res) => {
    const productoId = req.params.id;

  // PRODUCTO PADRE
  const [[producto]] = await pool.query(`
    SELECT 
      p.*,
      c.nombre AS categoria_nombre,
      COALESCE(SUM(sp.cantidad),0) AS stock_total
    FROM productos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN stock_producto sp ON sp.producto_id = p.id
    WHERE p.id = ?
    GROUP BY p.id, c.nombre
  `, [productoId]);


    if (!producto) {
      return res.json({ producto: null });
    }

    // IMAGEN PRODUCTO
    const [[imagen]] = await pool.query(`
      SELECT storage_provider, storage_key
      FROM imagenes
      WHERE producto_id = ? AND tipo='producto'
      ORDER BY id ASC
      LIMIT 1
    `, [productoId]);

    // VARIANTES
    const [variantes] = await pool.query(`
      SELECT v.*,
        COALESCE(SUM(sp.cantidad),0) AS stock_total
      FROM productos v
      LEFT JOIN stock_producto sp ON sp.producto_id = v.id
      WHERE v.producto_padre_id = ?
      GROUP BY v.id
    `, [productoId]);

    // IMAGEN VARIANTE
    for (const v of variantes) {
      const [[img]] = await pool.query(`
        SELECT storage_provider, storage_key
        FROM imagenes
        WHERE producto_id = ? AND tipo='producto'
        ORDER BY id ASC
        LIMIT 1
      `, [v.id]);

      v.imagen = img || null;
    }

    res.json({
      producto: {
        ...producto,
        imagen: imagen || null,
        variantes
      }
    });
  },


crearProducto: async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const { tipo } = req.body;

    // =========================
    // PARSEO FORM DATA
    // =========================
    const productoData = JSON.parse(req.body.producto);

    const [[existeCodigoProducto]] = await conn.query(
      `SELECT id FROM productos WHERE codigo = ? LIMIT 1`,
      [productoData.codigo]
    );

    const [[existeCodigoComoVariante]] = await conn.query(
      `SELECT id FROM productos WHERE codigo_modelo = ? LIMIT 1`,
      [productoData.codigo]
    );

    if (existeCodigoProducto || existeCodigoComoVariante) {
      throw new Error("El código ya existe como producto o variante");
    }


    const atributosData = JSON.parse(req.body.atributos || "{}");
    const variantesData = JSON.parse(req.body.variantes || "[]");

    // =========================
    // VALIDAR CODIGOS DE VARIANTES
    // =========================

    // 1️⃣ Que no se repitan dentro del mismo formulario
    const codigosLocales = new Set();
    for (const v of variantesData) {
      const codigo = v.codigo_modelo.trim();

      const [[existeComoVariante]] = await conn.query(
        `SELECT id FROM productos WHERE codigo_modelo = ? LIMIT 1`,
        [codigo]
      );

      const [[existeComoProducto]] = await conn.query(
        `SELECT id FROM productos WHERE codigo = ? LIMIT 1`,
        [codigo]
      );

      if (existeComoVariante || existeComoProducto) {
        throw new Error(`El código de variante ya existe: ${codigo}`);
      }
    }



    const usuarioId = req.user.id;

    // =========================
    // NORMALIZAR MODELO / MARCA
    // =========================
    let modeloFinal = null;
    let marcaFinal = null;

    // MODELO
    if (productoData.modelo_nuevo && productoData.modelo_nuevo.trim()) {
      const modeloId = await getOrCreate(conn, "modelos", productoData.modelo_nuevo.trim());
      const [[row]] = await conn.query(`SELECT nombre FROM modelos WHERE id = ?`, [modeloId]);
      modeloFinal = row.nombre;
    } else if (productoData.modelo_id) {
      const [[row]] = await conn.query(`SELECT nombre FROM modelos WHERE id = ?`, [productoData.modelo_id]);
      modeloFinal = row ? row.nombre : null;
    }

    // MARCA
    if (productoData.marca_nuevo && productoData.marca_nuevo.trim()) {
      const marcaId = await getOrCreate(conn, "marcas", productoData.marca_nuevo.trim());
      const [[row]] = await conn.query(`SELECT nombre FROM marcas WHERE id = ?`, [marcaId]);
      marcaFinal = row.nombre;
    } else if (productoData.marca_id) {
      const [[row]] = await conn.query(`SELECT nombre FROM marcas WHERE id = ?`, [productoData.marca_id]);
      marcaFinal = row ? row.nombre : null;
    }

    // =========================
    // INSERT PRODUCTO PADRE
    // =========================
    const [padre] = await conn.query(
      `INSERT INTO productos
       (codigo, descripcion, categoria_id, es_catalogo, modelo, marca)
       VALUES (?,?,?,?,?,?)`,
      [
        productoData.codigo || null,
        productoData.descripcion,
        productoData.categoria_id,
        tipo === "variantes" ? 1 : 0,
        modeloFinal,
        marcaFinal
      ]
    );

    const productoPadreId = padre.insertId;

    // =========================
    // IMAGEN PRODUCTO PADRE
    // =========================
    const imagenProducto = req.files?.find(f => f.fieldname === "imagen_producto");

    if (imagenProducto) {
      const basePath = `productos/categoria_${productoData.categoria_id}/producto_${productoPadreId}`;
      const imagePath =
        tipo === "simple"
          ? `${basePath}/codigo/principal`
          : `${basePath}/base/principal`;

      await uploadImage(imagenProducto.buffer, imagePath);

      await conn.query(
        `INSERT INTO imagenes
         (producto_id, tipo, ruta, storage_provider, storage_key)
         VALUES (?,?,?,?,?)`,
        [productoPadreId, "producto", imagePath, "cloudinary", imagePath]
      );
    }

    // =========================
    // ATRIBUTOS PADRE
    // =========================
    for (const attrId in atributosData) {
      await conn.query(
        `INSERT INTO producto_atributos
         (producto_id, atributo_id, valor)
         VALUES (?,?,?)`,
        [productoPadreId, attrId, atributosData[attrId]]
      );
    }

    // =========================
    // VARIANTES
    // =========================
    if (tipo === "variantes") {
      for (let i = 0; i < variantesData.length; i++) {
        const v = variantesData[i];

        const codigo = v.codigo_modelo.trim();

        const [[existeComoVariante]] = await conn.query(
          `SELECT id FROM productos WHERE codigo_modelo = ? LIMIT 1`,
          [codigo]
        );

        const [[existeComoProducto]] = await conn.query(
          `SELECT id FROM productos WHERE codigo = ? LIMIT 1`,
          [codigo]
        );

        if (existeComoVariante || existeComoProducto) {
          throw new Error(`El código de variante ya existe: ${codigo}`);
        }



        const [varRes] = await conn.query(
          `INSERT INTO productos
           (producto_padre_id, codigo_modelo, descripcion, categoria_id, modelo, marca)
           VALUES (?,?,?,?,?,?)`,
          [
            productoPadreId,
            v.codigo_modelo,
            productoData.descripcion,
            productoData.categoria_id,
            modeloFinal,
            marcaFinal
          ]
        );

        const varianteId = varRes.insertId;

        // =========================
        // IMAGEN VARIANTE
        // =========================
        const file = req.files?.find(f => f.fieldname === `imagen_variante_${i}`);

        if (file) {
          const path = `productos/categoria_${productoData.categoria_id}/producto_${productoPadreId}/variantes/${varianteId}`;

          await uploadImage(file.buffer, path);

          await conn.query(
            `INSERT INTO imagenes
             (producto_id, tipo, ruta, storage_provider, storage_key)
             VALUES (?,?,?,?,?)`,
            [varianteId, "producto", path, "cloudinary", path]
          );
        }

        // =========================
        // ATRIBUTOS VARIANTE
        // =========================
        for (const attrId in v.atributos) {
          await conn.query(
            `INSERT INTO producto_atributos
             (producto_id, atributo_id, valor)
             VALUES (?,?,?)`,
            [varianteId, attrId, v.atributos[attrId]]
          );
        }
      }
    }

    await conn.commit();
    res.json({ ok: true, productoId: productoPadreId });

  } catch (e) {
    await conn.rollback();
    console.error("❌ crearProducto:", e);
    res.status(500).json({ error: "Error creando producto" });
  } finally {
    conn.release();
  }
},

  existeCodigoProducto: async (req, res) => {
    const { codigo } = req.params;

    const [[rowProducto]] = await pool.query(
      `SELECT id FROM productos WHERE codigo = ? LIMIT 1`,
      [codigo]
    );

    const [[rowVariante]] = await pool.query(
      `SELECT id FROM productos WHERE codigo_modelo = ? LIMIT 1`,
      [codigo]
    );

    res.json({ existe: !!rowProducto || !!rowVariante });
  },



  existeCodigoVariante: async (req, res) => {
    const { codigo } = req.params;

    const [[rowVariante]] = await pool.query(
      `SELECT id FROM productos WHERE codigo_modelo = ? LIMIT 1`,
      [codigo]
    );

    const [[rowProducto]] = await pool.query(
      `SELECT id FROM productos WHERE codigo = ? LIMIT 1`,
      [codigo]
    );

    res.json({ existe: !!rowVariante || !!rowProducto });
  },


    

listarMovimientos: async (req, res) => {
  try {
    const { productoId, estados } = req.query;

    if (!productoId) {
      return res.status(400).json({ error: "productoId requerido" });
    }

    const estadosArr = estados ? estados.split(",") : [];

    let sql = `
      SELECT
        mi.id,
        mi.tipo_movimiento,
        mi.op_vinculada,
        mi.cantidad,
        mi.precio,
        mi.estado,
        mi.created_at AS fecha_creacion,
        mi.fecha_validacion_logistica,

        p.codigo AS codigo_producto,
        e.nombre AS empresa,
        a.nombre AS almacen,
        f.nombre AS fabricante,

        mi.observaciones AS observaciones_compras,

        -- ✅ Observaciones de logística (original)
        (
          SELECT vm.observaciones
          FROM validaciones_movimiento vm
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS observaciones_logistica,

        -- ✅ Último motivo de rechazo + usuario que lo hizo
        vm_rechazo.observaciones AS motivo_rechazo,
        CONCAT(u.nombre, ' ', u.apellido_paterno, ' ', u.apellido_materno) AS usuario_logistica,

        -- 🔥 NUEVO: imagen de evidencia del movimiento
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

      -- Última validación de logística (para motivo + usuario)
      LEFT JOIN (
        SELECT vm1.movimiento_id, vm1.observaciones, vm1.usuario_id
        FROM validaciones_movimiento vm1
        WHERE vm1.rol = 'LOGISTICA'
          AND vm1.created_at = (
            SELECT MAX(vm2.created_at)
            FROM validaciones_movimiento vm2
            WHERE vm2.movimiento_id = vm1.movimiento_id
              AND vm2.rol = 'LOGISTICA'
          )
      ) vm_rechazo ON vm_rechazo.movimiento_id = mi.id

      LEFT JOIN usuarios u ON u.id = vm_rechazo.usuario_id

      WHERE mi.producto_id = ?
    `;

    const params = [productoId];

    if (estadosArr.length > 0) {
      sql += ` AND mi.estado IN (${estadosArr.map(() => "?").join(",")})`;
      params.push(...estadosArr);
    }

    sql += " ORDER BY mi.created_at DESC";

    const [rows] = await pool.query(sql, params);
    res.json(rows);

  } catch (error) {
    console.error("❌ Error listarMovimientos:", error);
    res.status(500).json({ error: "Error obteniendo movimientos" });
  }
},






listarMovimientosPorProducto: async (req, res) => {
  try {
    const { productoId, estados } = req.query;

    if (!productoId) {
      return res.status(400).json({ error: "productoId requerido" });
    }

    const estadosArr = estados ? estados.split(",") : [];

    const sql = `
      SELECT
        mi.id,
        mi.tipo_movimiento,
        mi.op_vinculada,
        mi.cantidad,
        mi.precio,
        mi.estado,
        mi.created_at AS fecha_creacion,
        mi.fecha_validacion_logistica,

        p.codigo AS codigo_producto,
        e.nombre AS empresa,
        a.nombre AS almacen,
        f.nombre AS fabricante,

        -- ✅ Usuario que rechazó
        (
          SELECT u.nombre
          FROM validaciones_movimiento vm
          INNER JOIN usuarios u ON u.id = vm.usuario_id
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
            AND vm.accion = 'RECHAZAR'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS usuario_rechazo,

        -- ✅ Motivo del rechazo
        (
          SELECT vm.observaciones
          FROM validaciones_movimiento vm
          WHERE vm.movimiento_id = mi.id
            AND vm.rol = 'LOGISTICA'
            AND vm.accion = 'RECHAZAR'
          ORDER BY vm.created_at DESC
          LIMIT 1
        ) AS motivo_rechazo

      FROM movimientos_inventario mi
      INNER JOIN productos p ON p.id = mi.producto_id
      INNER JOIN empresas e ON e.id = mi.empresa_id
      LEFT JOIN almacenes a ON a.id = mi.almacen_id
      LEFT JOIN fabricantes f ON f.id = mi.fabricante_id
      WHERE mi.producto_id = ?
      ${estadosArr.length ? `AND mi.estado IN (${estadosArr.map(() => "?").join(",")})` : ""}
      ORDER BY mi.created_at DESC
    `;

    const params = [productoId, ...estadosArr];

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error("❌ listarMovimientosPorProducto:", error);
    res.status(500).json({ error: "Error obteniendo movimientos" });
  }
},





editarMovimientoCompras: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    let {
      empresa_id,
      empresa_nueva,
      almacen_id,
      almacen_nuevo,
      fabricante_id,
      fabricante_nuevo,
      motivo_id,
      motivo_nuevo,
      op_vinculada,
      op_vinculada_nueva,
      cantidad,
      precio,
      observaciones
    } = req.body;

    const usuarioId = req.user.id;

    const [[mov]] = await conn.query(
      `SELECT *
       FROM movimientos_inventario
       WHERE id = ?`,
      [id]
    );

    if (!mov) throw new Error("Movimiento no encontrado");
    if (mov.estado !== "RECHAZADO_LOGISTICA")
      throw new Error("Solo se pueden editar movimientos rechazados");

    // =========================
    // NORMALIZACIÓN
    // =========================
    let opFinal = null;
    if (op_vinculada) opFinal = op_vinculada;
    if (!op_vinculada && op_vinculada_nueva)
      opFinal = op_vinculada_nueva;

    if (empresa_nueva && empresa_nueva.trim()) {
      empresa_id = await getOrCreate(conn, "empresas", empresa_nueva.trim());
    }
    if (almacen_nuevo && almacen_nuevo.trim()) {
      almacen_id = await getOrCreate(conn, "almacenes", almacen_nuevo.trim(), {
        empresa_id
      });
    }
    if (fabricante_nuevo && fabricante_nuevo.trim()) {
      fabricante_id = await getOrCreate(conn, "fabricantes", fabricante_nuevo.trim());
    }
    if (motivo_nuevo && motivo_nuevo.trim()) {
      const [resMotivo] = await conn.query(
        `INSERT INTO motivos_movimiento (nombre, tipo)
         VALUES (?, ?)`,
        [motivo_nuevo.trim(), mov.tipo_movimiento]
      );
      motivo_id = resMotivo.insertId;
    }

    cantidad = Number(cantidad);
    if (!cantidad || cantidad <= 0)
      throw new Error("Cantidad inválida");

    if (precio !== undefined && precio !== null) {
      precio = Number(precio);
      if (isNaN(precio) || precio < 0)
        throw new Error("Precio inválido");
    } else {
      precio = null;
    }

    // =========================
    // VALIDACIÓN EXTRA SI ES SALIDA
    // =========================
    if (mov.tipo_movimiento === "salida") {
      const [[stock]] = await conn.query(
        `SELECT cantidad
         FROM stock_producto
         WHERE producto_id = ?
           AND empresa_id = ?
           AND almacen_id = ?
           AND (
             (fabricante_id IS NULL AND ? IS NULL) OR
             fabricante_id = ?
           )
         LIMIT 1`,
        [
          mov.producto_id,
          empresa_id,
          almacen_id,
          fabricante_id || null,
          fabricante_id || null
        ]
      );

      if (!stock)
        throw new Error(
          "No existe stock para esta combinación empresa/almacén/fabricante"
        );

      if (cantidad > stock.cantidad)
        throw new Error(
          `Cantidad solicitada (${cantidad}) supera stock disponible (${stock.cantidad})`
        );
    }

    // =========================
    // 🔥 UPDATE REAL DEL MISMO REGISTRO
    // =========================
    await conn.query(
      `UPDATE movimientos_inventario
       SET empresa_id = ?,
           almacen_id = ?,
           fabricante_id = ?,
           cantidad = ?,
           cantidad_solicitada = ?, -- 👈 NUEVO
           precio = ?,
           motivo_id = ?,
           op_vinculada = ?,
           observaciones = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        empresa_id,
        almacen_id,
        fabricante_id || null,
        cantidad,
        cantidad, // 👈 NUEVO
        precio,
        motivo_id || null,
        opFinal,
        observaciones || null,
        id
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ editarMovimientoCompras:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},




reenviarMovimientoCompras: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    const [[mov]] = await conn.query(
      `SELECT estado FROM movimientos_inventario WHERE id = ?`,
      [id]
    );

    if (!mov) throw new Error("Movimiento no encontrado");
    if (mov.estado !== "RECHAZADO_LOGISTICA")
      throw new Error("Solo se pueden reenviar movimientos rechazados");

    await conn.query(
      `UPDATE movimientos_inventario
       SET estado = 'PENDIENTE_LOGISTICA',
           usuario_logistica_id = NULL,
           fecha_validacion_logistica = NULL,
           updated_at = NOW()
       WHERE id = ?`,
      [id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ reenviarMovimientoCompras:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},







listarMotivosMovimiento: async (req, res) => {
  const { tipo } = req.query; // entrada | salida

  const [rows] = await pool.query(`
    SELECT id, nombre
    FROM motivos_movimiento
    WHERE activo = 1
      AND (
        tipo = ?
        OR tipo = 'ambos'
        OR tipo_movimiento = ?
      )
    ORDER BY nombre
  `, [tipo, tipo]);

  res.json(rows);
},

stockPorEmpresa: async (req, res) => {
  const { productoId } = req.query;

  const [rows] = await pool.query(`
    SELECT
      e.nombre AS empresa,
      a.nombre AS almacen,
      f.nombre AS fabricante,
      sp.cantidad,
      sp.updated_at
    FROM stock_producto sp
    INNER JOIN empresas e ON e.id = sp.empresa_id
    INNER JOIN almacenes a ON a.id = sp.almacen_id
    LEFT JOIN fabricantes f ON f.id = sp.fabricante_id
    WHERE sp.producto_id = ?
  `, [productoId]);

  res.json(rows);
},



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

obtenerPrecioPorStock: async (req, res) => {
  try {
    const { productoId, empresa_id, almacen_id, fabricante_id } = req.query;

    if (!productoId || !empresa_id || !almacen_id) {
      return res.json({ precio_actual: null, historicos: [] });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        precio,
        created_at,
        tipo_movimiento,
        op_vinculada
      FROM movimientos_inventario
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (fabricante_id IS NULL AND ? IS NULL)
          OR fabricante_id = ?
        )
        AND tipo_movimiento IN ('entrada','saldo_inicial')
        AND precio IS NOT NULL
        AND estado IN ('PENDIENTE_LOGISTICA','VALIDADO_LOGISTICA','APROBADO_FINAL')
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [productoId, empresa_id, almacen_id, fabricante_id, fabricante_id]
    );

    const precio_actual = rows.length ? rows[0].precio : null;

    res.json({
      precio_actual,
      historicos: rows
    });
  } catch (error) {
    console.error("❌ obtenerPrecioPorStock:", error);
    res.status(500).json({ error: "Error obteniendo precios" });
  }
},



listarOpsExistentes: async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT op_vinculada AS codigo
      FROM movimientos_inventario
      WHERE op_vinculada IS NOT NULL
        AND op_vinculada <> ''
      ORDER BY op_vinculada ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error("❌ listarOpsExistentes:", error);
    res.status(500).json({ error: "Error obteniendo OPs" });
  }
},



listarStockPorProducto: async (req, res) => {
  const { productoId } = req.params;

  const [rows] = await pool.query(`
    SELECT
      sp.empresa_id,
      e.nombre AS empresa,
      sp.almacen_id,
      a.nombre AS almacen,
      sp.fabricante_id,
      f.nombre AS fabricante,
      sp.cantidad
    FROM stock_producto sp
    INNER JOIN empresas e ON e.id = sp.empresa_id
    INNER JOIN almacenes a ON a.id = sp.almacen_id
    LEFT JOIN fabricantes f ON f.id = sp.fabricante_id
    WHERE sp.producto_id = ?
      AND sp.cantidad > 0
    ORDER BY e.nombre, a.nombre, f.nombre
  `, [productoId]);

  res.json(rows);
},



listarModelos: async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, nombre
    FROM modelos
    WHERE activo = 1
    ORDER BY nombre
  `);
  res.json(rows);
},

listarMarcas: async (req, res) => {
  const [rows] = await pool.query(`
    SELECT id, nombre
    FROM marcas
    WHERE activo = 1
    ORDER BY nombre
  `);
  res.json(rows);
},





//LISTAR MOVIMIENTOS GENERALES PARA DASHBOARD Y MODULO DE MOVIMIENTOS



// ✅ Listar todos los cambios de almacén
  listarCambiosAlmacenTodosCompras: async (req, res) => {
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



// 📋 LISTAR TODOS LOS MOVIMIENTOS (GLOBAL)
// =====================================================
listarMovimientosTodosCompras: async (req, res) => {
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





  // =====================================================
  // 📝 ÚLTIMA OBSERVACIÓN DE LOGÍSTICA
  // =====================================================
getUltimaObservacionCompras: async (req, res) => {
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






detalleMovimiento: async (req, res) => {
  try {
    const { id } = req.params;

    const [movs] = await pool.query(
      `SELECT 
         m.*,
         u.nombre AS usuario_creador,
         p.descripcion AS producto,
         e.nombre AS empresa,
         a.nombre AS almacen,
         f.nombre AS fabricante
       FROM movimientos_inventario m
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
    const contabilidad = validaciones.find(v => v.rol === "CONTABILIDAD") || {};

    res.json({
      ...movimiento,
      usuario_logistica: logistica.usuario || null,
      usuario_contabilidad: contabilidad.usuario || null,
      observacion_logistica: logistica.observaciones || null,
      observacion_contabilidad: contabilidad.observaciones || null,
      motivo_contabilidad: movimiento.motivo_contabilidad || null, // 🔥 CLAVE
      validaciones,
    });
  } catch (error) {
    console.error("❌ detalleMovimiento:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
},









//---------------------------------------------------------------------


crearMovimientoEntrada: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let {
      productoId,
      empresa_id,
      empresa_nueva,
      almacen_id,
      almacen_nuevo,
      fabricante_id,
      fabricante_nuevo,
      cantidad,
      precio,
      motivo_id,
      motivo_nuevo,
      op_vinculada,
      op_vinculada_nueva,
      observaciones
    } = req.body;

    const usuarioId = req.user.id;

    let opFinal = null;
    if (op_vinculada) opFinal = op_vinculada;
    if (!op_vinculada && op_vinculada_nueva) opFinal = op_vinculada_nueva;

    if (empresa_nueva && empresa_nueva.trim()) {
      empresa_id = await getOrCreate(conn, "empresas", empresa_nueva.trim());
    }
    if (almacen_nuevo && almacen_nuevo.trim()) {
      almacen_id = await getOrCreate(conn, "almacenes", almacen_nuevo.trim(), {
        empresa_id
      });
    }
    if (fabricante_nuevo && fabricante_nuevo.trim()) {
      fabricante_id = await getOrCreate(conn, "fabricantes", fabricante_nuevo.trim());
    }
    if (motivo_nuevo && motivo_nuevo.trim()) {
      const [resMotivo] = await conn.query(
        `INSERT INTO motivos_movimiento (nombre, tipo) VALUES (?, 'entrada')`,
        [motivo_nuevo.trim()]
      );
      motivo_id = resMotivo.insertId;
    }

    if (!productoId || !empresa_id || !almacen_id || !cantidad) {
      throw new Error("Datos obligatorios incompletos");
    }

    await conn.query(
      `INSERT INTO movimientos_inventario (
        producto_id,
        empresa_id,
        almacen_id,
        fabricante_id,
        tipo_movimiento,
        cantidad,
        cantidad_solicitada,
        precio,
        op_vinculada,
        motivo_id,
        observaciones,
        estado,
        usuario_creador_id,
        requiere_logistica,
        requiere_contabilidad
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        productoId,
        empresa_id,
        almacen_id,
        fabricante_id || null,
        "entrada",
        Number(cantidad),
        Number(cantidad), // 👈 NUEVO
        precio ? Number(precio) : null,
        opFinal,
        motivo_id || null,
        observaciones || null,
        "PENDIENTE_LOGISTICA",
        usuarioId,
        1,
        1
      ]
    );

    await conn.commit();
    res.json({ ok: true });

  } catch (e) {
    await conn.rollback();
    console.error("❌ crearMovimientoEntrada:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},




crearMovimientoSaldoInicial: async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let {
      productoId,
      empresa_id,
      empresa_nueva,
      almacen_id,
      almacen_nuevo,
      fabricante_id,
      fabricante_nuevo,
      cantidad,
      precio,
      motivo_id,
      motivo_nuevo,
      observaciones
    } = req.body;

    const usuarioId = req.user.id;

    if (empresa_nueva && empresa_nueva.trim()) {
      empresa_id = await getOrCreate(conn, "empresas", empresa_nueva.trim());
    }
    if (almacen_nuevo && almacen_nuevo.trim()) {
      almacen_id = await getOrCreate(conn, "almacenes", almacen_nuevo.trim(), {
        empresa_id
      });
    }
    if (fabricante_nuevo && fabricante_nuevo.trim()) {
      fabricante_id = await getOrCreate(conn, "fabricantes", fabricante_nuevo.trim());
    }
    if (motivo_nuevo && motivo_nuevo.trim()) {
      const [resMotivo] = await conn.query(
        `INSERT INTO motivos_movimiento (nombre, tipo) VALUES (?, 'entrada')`,
        [motivo_nuevo.trim()]
      );
      motivo_id = resMotivo.insertId;
    }

    if (!productoId || !empresa_id || !almacen_id || !cantidad) {
      throw new Error("Datos obligatorios incompletos");
    }

    cantidad = Number(cantidad);
    if (cantidad <= 0) throw new Error("Cantidad inválida");

    const [resMov] = await conn.query(
      `INSERT INTO movimientos_inventario (
        producto_id,
        empresa_id,
        almacen_id,
        fabricante_id,
        tipo_movimiento,
        cantidad,
        cantidad_solicitada,
        precio,
        motivo_id,
        observaciones,
        estado,
        usuario_creador_id,
        requiere_logistica,
        requiere_contabilidad
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        productoId,
        empresa_id,
        almacen_id,
        fabricante_id || null,
        "saldo_inicial",
        cantidad,
        cantidad, // 👈 NUEVO
        precio ? Number(precio) : null,
        motivo_id || null,
        observaciones || null,
        "VALIDADO_LOGISTICA",
        usuarioId,
        0,
        0
      ]
    );

    await actualizarStock(conn, {
      producto_id: productoId,
      empresa_id,
      almacen_id,
      fabricante_id,
      cantidad,
      tipo: "entrada"
    });

    await conn.commit();
    res.json({ ok: true });

  } catch (e) {
    await conn.rollback();
    console.error("❌ crearMovimientoSaldoInicial:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},


crearMovimientoSalida: async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let {
      productoId,
      empresa_id,
      empresa_nueva,
      almacen_id,
      almacen_nuevo,
      fabricante_id,
      fabricante_nuevo,
      cantidad,
      precio,
      motivo_id,
      motivo_nuevo,
      op_vinculada,
      op_vinculada_nueva,
      observaciones
    } = req.body;

    const usuarioId = req.user.id;

    let opFinal = null;
    if (op_vinculada) opFinal = op_vinculada;
    if (!op_vinculada && op_vinculada_nueva) opFinal = op_vinculada_nueva;

    if (empresa_nueva && empresa_nueva.trim()) {
      empresa_id = await getOrCreate(conn, "empresas", empresa_nueva.trim());
    }
    if (almacen_nuevo && almacen_nuevo.trim()) {
      almacen_id = await getOrCreate(conn, "almacenes", almacen_nuevo.trim(), {
        empresa_id
      });
    }
    if (fabricante_nuevo && fabricante_nuevo.trim()) {
      fabricante_id = await getOrCreate(conn, "fabricantes", fabricante_nuevo.trim());
    }
    if (motivo_nuevo && motivo_nuevo.trim()) {
      const [resMotivo] = await conn.query(
        `INSERT INTO motivos_movimiento (nombre, tipo) VALUES (?, 'salida')`,
        [motivo_nuevo.trim()]
      );
      motivo_id = resMotivo.insertId;
    }

    if (!productoId || !empresa_id || !almacen_id || !cantidad) {
      throw new Error("Datos obligatorios incompletos");
    }

    cantidad = Number(cantidad);
    if (cantidad <= 0) throw new Error("Cantidad inválida");

    if (precio !== undefined && precio !== null) {
      precio = Number(precio);
      if (isNaN(precio) || precio < 0) throw new Error("Precio inválido");
    } else {
      precio = null;
    }

    await conn.query(
      `INSERT INTO movimientos_inventario (
        producto_id,
        empresa_id,
        almacen_id,
        fabricante_id,
        tipo_movimiento,
        cantidad,
        cantidad_solicitada,
        precio,
        op_vinculada,
        motivo_id,
        observaciones,
        estado,
        usuario_creador_id,
        requiere_logistica,
        requiere_contabilidad
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        productoId,
        empresa_id,
        almacen_id,
        fabricante_id || null,
        "salida",
        cantidad,
        cantidad, // 👈 NUEVO
        precio,
        opFinal,
        motivo_id || null,
        observaciones || null,
        "PENDIENTE_LOGISTICA",
        usuarioId,
        1,
        1
      ]
    );

    await conn.commit();
    res.json({ ok: true });

  } catch (error) {
    await conn.rollback();
    console.error("❌ crearMovimientoSalida:", error);
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
},

getUltimaObservacionLogistica: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    const [[row]] = await conn.query(
      `SELECT observaciones
       FROM validaciones_movimiento
       WHERE movimiento_id = ?
         AND rol = 'LOGISTICA'
       ORDER BY created_at DESC
       LIMIT 1`,
      [id]
    );

    res.json(row || null);
  } catch (e) {
    console.error("❌ getUltimaObservacionLogistica:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},

getMovimientoById: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    const [[mov]] = await conn.query(
      `SELECT *
       FROM movimientos_inventario
       WHERE id = ?`,
      [id]
    );

    if (!mov) throw new Error("Movimiento no encontrado");

    res.json(mov);
  } catch (e) {
    console.error("❌ getMovimientoById:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},


validarMovimientoLogistica: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { accion, observaciones } = req.body;
    const usuarioId = req.user.id;

    const [[mov]] = await conn.query(
      `SELECT estado FROM movimientos_inventario WHERE id = ?`,
      [id]
    );

    if (!mov) throw new Error("Movimiento no encontrado");
    if (mov.estado !== "PENDIENTE_LOGISTICA")
      throw new Error("Movimiento no está pendiente de logística");

    const nuevoEstado =
      accion === "VALIDAR"
        ? "VALIDADO_LOGISTICA"
        : "RECHAZADO_LOGISTICA";

    await conn.beginTransaction();

    await conn.query(
      `UPDATE movimientos_inventario
       SET estado = ?,
           usuario_logistica_id = ?,
           fecha_validacion_logistica = NOW()
       WHERE id = ?`,
      [nuevoEstado, usuarioId, id]
    );

    await conn.query(
      `INSERT INTO validaciones_movimiento
       (movimiento_id, rol, usuario_id, accion, observaciones)
       VALUES (?, 'LOGISTICA', ?, ?, ?)`,
      [id, usuarioId, accion, observaciones || null]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error("❌ validarMovimientoLogistica:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},

rechazarMovimientoLogistica: async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    const usuarioId = req.user.id;

    const [[mov]] = await conn.query(
      `SELECT id, estado FROM movimientos_inventario WHERE id = ?`,
      [id]
    );

    if (!mov) throw new Error("Movimiento no encontrado");
    if (mov.estado !== "PENDIENTE_LOGISTICA")
      throw new Error("Este movimiento ya fue procesado");

    await conn.beginTransaction();

    await conn.query(
      `UPDATE movimientos_inventario
       SET estado = 'RECHAZADO_LOGISTICA',
           usuario_logistica_id = ?,
           fecha_validacion_logistica = NOW()
       WHERE id = ?`,
      [usuarioId, id]
    );

    await conn.query(
      `INSERT INTO validaciones_movimiento
       (movimiento_id, rol, usuario_id, accion, observaciones)
       VALUES (?, 'LOGISTICA', ?, 'RECHAZAR', ?)`,
      [id, usuarioId, motivo || null]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error("❌ rechazarMovimientoLogistica:", e);
    res.status(400).json({ error: e.message });
  } finally {
    conn.release();
  }
},


existeCodigoProductoparaEditar: async (req, res) => {
  try {
    const { codigo } = req.params;

    const [rowsCodigo] = await pool.query(
      `SELECT * FROM productos WHERE codigo = ? LIMIT 1`,
      [codigo]
    );

    const [rowsVariante] = await pool.query(
      `SELECT * FROM productos WHERE codigo_modelo = ? LIMIT 1`,
      [codigo]
    );

    const productoEncontrado = rowsCodigo[0] || rowsVariante[0] || null;

    res.json({ producto: productoEncontrado });
  } catch (err) {
    console.error("❌ Error existeCodigoProductoparaEditar:", err);
    res.status(500).json({ error: "Error al verificar código para edición" });
  }
},

obtenerAtributosProducto: async (req, res) => {
  try {
    const { id: productoId } = req.params; // 🔹 CORRECCIÓN

    if (!productoId) {
      return res.status(400).json({ error: "productoId requerido" });
    }

    // 1️⃣ Obtener los atributos del producto principal o variante
    const [atributosProducto] = await pool.query(
      `
      SELECT 
        pa.id AS producto_atributo_id,
        a.id AS atributo_id,
        a.nombre AS atributo_nombre,
        a.tipo AS atributo_tipo,
        pa.valor
      FROM producto_atributos pa
      INNER JOIN atributos a ON a.id = pa.atributo_id
      WHERE pa.producto_id = ?
      ORDER BY a.nombre ASC
      `,
      [productoId]
    );

    // 2️⃣ Obtener datos básicos del producto
    const [[producto]] = await pool.query(
      `
      SELECT id, codigo, codigo_modelo, descripcion, producto_padre_id
      FROM productos
      WHERE id = ?
      LIMIT 1
      `,
      [productoId]
    );

    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // 3️⃣ Si el producto es variante, obtener atributos del padre que no estén definidos en la variante
    let atributosCompletos = [...atributosProducto];

    if (producto.producto_padre_id) {
      const [atributosPadre] = await pool.query(
        `
        SELECT 
          pa.id AS producto_atributo_id,
          a.id AS atributo_id,
          a.nombre AS atributo_nombre,
          a.tipo AS atributo_tipo,
          pa.valor
        FROM producto_atributos pa
        INNER JOIN atributos a ON a.id = pa.atributo_id
        WHERE pa.producto_id = ?
        ORDER BY a.nombre ASC
        `,
        [producto.producto_padre_id]
      );

      // Solo agregar los atributos del padre que la variante no tenga
      const idsExistentes = new Set(atributosProducto.map(ap => ap.atributo_id));
      atributosPadre.forEach(ap => {
        if (!idsExistentes.has(ap.atributo_id)) {
          atributosCompletos.push(ap);
        }
      });
    }

    res.json({
      producto: {
        id: producto.id,
        codigo: producto.codigo,
        codigo_modelo: producto.codigo_modelo,
        descripcion: producto.descripcion,
      },
      atributos: atributosCompletos
    });

  } catch (error) {
    console.error("❌ obtenerAtributosProducto:", error);
    res.status(500).json({ error: "Error obteniendo atributos del producto" });
  }
},
editarProducto: async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { id } = req.params;
    const { codigo, modelo, marca, descripcion } = req.body;
    const imagen = req.file;

    let atributos = {};
    try {
      atributos =
        typeof req.body.atributos === "string"
          ? JSON.parse(req.body.atributos)
          : req.body.atributos || {};
    } catch {
      atributos = {};
    }

    if (!codigo || !codigo.trim()) {
      return res.status(400).json({ error: "El código es obligatorio" });
    }

    const codigoSafe = codigo.trim().slice(0, 255);
    const modeloSafe = modelo?.trim().slice(0, 255) || "";
    const marcaSafe = marca?.trim().slice(0, 255) || "";
    const descripcionSafe = descripcion?.trim().slice(0, 1000) || "";

    await conn.beginTransaction();

    // 1️⃣ verificar producto
    const [[producto]] = await conn.query(
      "SELECT id FROM productos WHERE id = ?",
      [id]
    );
    if (!producto) {
      await conn.rollback();
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // 2️⃣ código único
    const [codigoExiste] = await conn.query(
      "SELECT id FROM productos WHERE codigo = ? AND id != ?",
      [codigoSafe, id]
    );
    if (codigoExiste.length) {
      await conn.rollback();
      return res.status(400).json({ error: "Código ya existente" });
    }

    // 3️⃣ update producto
    await conn.query(
      `
      UPDATE productos
      SET codigo = ?, modelo = ?, marca = ?, descripcion = ?
      WHERE id = ?
      `,
      [codigoSafe, modeloSafe, marcaSafe, descripcionSafe, id]
    );

    // 4️⃣ imagen (PARALELO)
    if (imagen) {
      const imagePath = `productos/${id}/${Date.now()}`;

      await Promise.all([
        uploadImage(imagen.buffer, imagePath),
        conn.query(
          "DELETE FROM imagenes WHERE producto_id = ? AND tipo = 'producto'",
          [id]
        )
      ]);

      await conn.query(
        `
        INSERT INTO imagenes
        (producto_id, tipo, ruta, storage_provider, storage_key)
        VALUES (?,?,?,?,?)
        `,
        [id, "producto", imagePath, "cloudinary", imagePath]
      );
    }

    // 5️⃣ ATRIBUTOS EN BLOQUE (🔥 LO QUE ACELERA TODO)
    const valores = [];

    for (const attrId in atributos) {
      const atributoIdNum = Number(attrId);
      if (!Number.isInteger(atributoIdNum)) continue;

      const valor = String(atributos[attrId] || "")
        .trim()
        .slice(0, 255);

      valores.push([id, atributoIdNum, valor]);
    }

    if (valores.length > 0) {
      await conn.query(
        `
        INSERT INTO producto_atributos (producto_id, atributo_id, valor)
        VALUES ?
        ON DUPLICATE KEY UPDATE valor = VALUES(valor)
        `,
        [valores]
      );

      await conn.query(
        `
        DELETE FROM producto_atributos
        WHERE producto_id = ?
        AND atributo_id NOT IN (?)
        `,
        [id, valores.map(v => v[1])]
      );
    } else {
      await conn.query(
        "DELETE FROM producto_atributos WHERE producto_id = ?",
        [id]
      );
    }

    await conn.commit();
    res.json({ mensaje: "Producto actualizado correctamente" });

  } catch (error) {
    await conn.rollback();
    console.error("❌ Error editarProducto:", error);
    res.status(500).json({ error: "Error al actualizar producto" });
  } finally {
    conn.release();
  }
},


solicitarEliminacionProducto: async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { id } = req.params;
    const usuarioId = req.user.id;

    // 1️⃣ Obtener correo del usuario autenticado
    const [[usuario]] = await conn.query(
      "SELECT nombre, apellido_paterno, apellido_materno, email FROM usuarios WHERE id = ?",
      [usuarioId]
    );

    if (!usuario || !usuario.email) {
      return res.status(400).json({
        error: "El usuario no tiene correo registrado"
      });
    }

    const emailUsuario = usuario.email;
    const nombreCompleto = `${usuario.nombre || ''} ${usuario.apellido_paterno || ''} ${usuario.apellido_materno || ''}`.trim();

    // 2️⃣ Verificar producto
    const [[producto]] = await conn.query(
      "SELECT id, codigo FROM productos WHERE id = ? AND eliminado = 0",
      [id]
    );

    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }


    // ⏱️ BLOQUEO DE REENVÍO (1 MINUTO)
    const [[ultimo]] = await conn.query(`
      SELECT creado_en
      FROM producto_eliminacion_tokens
      WHERE producto_id = ?
        AND usuario_id = ?
      ORDER BY creado_en DESC
      LIMIT 1
    `, [id, usuarioId]);

    if (ultimo) {
      const diff = (Date.now() - new Date(ultimo.creado_en)) / 1000;
      if (diff < 60) {
        return res.status(429).json({
          error: "Debes esperar 1 minuto para reenviar el código"
        });
      }
    }


    // 🔒 INVALIDAR OTPs ANTERIORES (solo uno válido)
    await conn.query(`
      UPDATE producto_eliminacion_tokens
      SET usado = 1
      WHERE producto_id = ?
        AND usuario_id = ?
        AND usado = 0
    `, [id, usuarioId]);

    // 3️⃣ Generar OTP
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    const expira = new Date(Date.now() + 10 * 60 * 1000);


    // 4️⃣ Guardar token
    await conn.query(
      `
      INSERT INTO producto_eliminacion_tokens
      (producto_id, usuario_id, token, expira_en, creado_en)
      VALUES (?,?,?,?,NOW())
      `,
      [id, usuarioId, token, expira]
    );

    // 5️⃣ Enviar correo
    await transporter.sendMail({
      to: emailUsuario,
      subject: "Confirmación de eliminación de producto – Acción crítica",
      html: `
        <p>Estimado(a) ${nombreCompleto},</p>
        
        <p>Se ha solicitado la eliminación de un producto de nuestro sistema. Esta es una acción <strong>crítica</strong> que podría afectar los registros de inventario y la disponibilidad de este producto en la plataforma.</p>
        
        <p>Para confirmar esta operación, ingrese el siguiente código de verificación:</p>

        <p>Producto a eliminar: <strong>${producto.codigo}</strong></p>
        
        <h2 style="color:red;">${token}</h2>
        
        <p>⚠️ Este código tiene una validez de <strong>10 minutos</strong>. Si no realiza esta acción dentro de este plazo, el código expirará y será necesario generar uno nuevo.</p>
        
        <p>Le recomendamos revisar cuidadosamente la información antes de confirmar la eliminación.</p>

        <p>Atentamente,<br>
        Equipo de Gestión de Productos y TI</p>
      `
    });

    console.log(`📧 OTP enviado a ${emailUsuario}:`, token);

    res.json({
      mensaje: "Código de confirmación enviado",
      expiraEn: expira.toISOString(), // 10 min
      reenviarDisponibleEn: new Date(Date.now() + 60 * 1000).toISOString() // 1 min
    });

  } catch (error) {
    console.error("❌ solicitarEliminacionProducto:", error);
    res.status(500).json({ error: "Error al solicitar eliminación" });
  } finally {
    conn.release();
  }
},

confirmarEliminacionProducto: async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { id } = req.params;
    const { token, tipo } = req.body; 
    // tipo: "inactivar" | "logico" | "fisico"
    const usuarioId = req.user.id;

    await conn.beginTransaction();

    // 1️⃣ validar token
    const [[registro]] = await conn.query(
      `
      SELECT * FROM producto_eliminacion_tokens
      WHERE producto_id = ?
      AND token = ?
      AND usuario_id = ?
      AND usado = 0
      AND expira_en > NOW()
      `,
      [id, token, usuarioId]
    );

    if (!registro) {
      await conn.rollback();
      return res.status(400).json({ error: "Código inválido o expirado" });
    }

    // 2️⃣ verificar movimientos
    const [[movs]] = await conn.query(
      "SELECT COUNT(*) total FROM movimientos_inventario WHERE producto_id = ?",
      [id]
    );

    if (tipo === "fisico" && movs.total > 0) {
      await conn.rollback();
      return res.status(409).json({
        error: "No se puede eliminar físicamente: tiene movimientos"
      });
    }

    // 3️⃣ ejecutar acción
    if (tipo === "inactivar") {
      await conn.query(
        "UPDATE productos SET activo = 0 WHERE id = ?",
        [id]
      );
    }

    if (tipo === "logico") {
      await conn.query(
        `
        UPDATE productos
        SET eliminado = 1,
            eliminado_en = NOW(),
            eliminado_por = ?
        WHERE id = ?
        `,
        [usuarioId, id]
      );
    }

    if (tipo === "fisico") {
      await conn.query("DELETE FROM imagenes WHERE producto_id = ?", [id]);
      await conn.query("DELETE FROM producto_atributos WHERE producto_id = ?", [id]);
      await conn.query("DELETE FROM movimientos_inventario WHERE producto_id = ?", [id]);
      await conn.query("DELETE FROM productos WHERE id = ?", [id]);
    }

    // 4️⃣ marcar token usado
    await conn.query(
      "UPDATE producto_eliminacion_tokens SET usado = 1 WHERE id = ?",
      [registro.id]
    );

    await conn.commit();
    res.json({ mensaje: "Acción ejecutada correctamente" });

  } catch (error) {
    await conn.rollback();
    console.error("❌ confirmarEliminacionProducto:", error);
    res.status(500).json({ error: "Error al eliminar producto" });
  } finally {
    conn.release();
  }
},

  };



  
  
