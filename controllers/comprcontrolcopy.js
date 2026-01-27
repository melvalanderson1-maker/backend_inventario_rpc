  const { initDB } = require("../config/db");

  const upload = require("../middlewares/upload");
  const { uploadImage } = require("../services/storage.service");

  const { getOrCreate } = require("../utils/getOrCreate");


  let pool;
  (async () => pool = await initDB())();

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
        mi.op_vinculada,          -- 👈 ESTA ES LA CLAVE
        mi.cantidad,
        mi.precio,
        mi.estado,
        mi.created_at AS fecha_creacion,
        mi.fecha_validacion_logistica,

        p.codigo AS codigo_producto,
        e.nombre AS empresa,
        a.nombre AS almacen,
        f.nombre AS fabricante

      FROM movimientos_inventario mi
      INNER JOIN productos p ON p.id = mi.producto_id
      INNER JOIN empresas e ON e.id = mi.empresa_id
      INNER JOIN almacenes a ON a.id = mi.almacen_id
      LEFT JOIN fabricantes f ON f.id = mi.fabricante_id
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
      op_vinculada,         // 👈 NUEVO
      op_vinculada_nueva,  // 👈 NUEVO
      observaciones
    } = req.body;

    const usuarioId = req.user.id;

    let opFinal = null;

    if (op_vinculada) {
      opFinal = op_vinculada;
    }

    if (!op_vinculada && op_vinculada_nueva) {
      opFinal = op_vinculada_nueva;
    }

    // =========================
    // NORMALIZAR IDS (DEFENSIVO)
    // =========================

    // EMPRESA → TEXTO NUEVO SIEMPRE GANA
    if (empresa_nueva && empresa_nueva.trim()) {
      empresa_id = await getOrCreate(conn, "empresas", empresa_nueva.trim());
    }

    // ALMACÉN → TEXTO NUEVO SIEMPRE GANA
    if (almacen_nuevo && almacen_nuevo.trim()) {
      almacen_id = await getOrCreate(conn, "almacenes", almacen_nuevo.trim(), {
        empresa_id
      });
    }

    // FABRICANTE → TEXTO NUEVO SIEMPRE GANA
    if (fabricante_nuevo && fabricante_nuevo.trim()) {
      fabricante_id = await getOrCreate(conn, "fabricantes", fabricante_nuevo.trim());
    }

    // MOTIVO → TEXTO NUEVO SIEMPRE GANA
    if (motivo_nuevo && motivo_nuevo.trim()) {
      const [res] = await conn.query(
        `INSERT INTO motivos_movimiento (nombre, tipo) VALUES (?, 'entrada')`,
        [motivo_nuevo.trim()]
      );
      motivo_id = res.insertId;
    }


    // 🔴 VALIDACIÓN FINAL (YA CON IDs)
    if (!empresa_id || !almacen_id || !cantidad) {
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
        precio,
        op_vinculada,     -- 👈 NUEVO
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
        "entrada",
        Number(cantidad),
        precio ? Number(precio) : null,
        opFinal,                     // 👈 AQUÍ
        motivo_id || null,
        observaciones || null,
        "PENDIENTE_LOGISTICA",
        usuarioId,
        1,
        1
      ]
    );

    // =========================
    // ACTUALIZAR / CREAR STOCK
    // =========================

    const [[stock]] = await conn.query(
      `SELECT id
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (fabricante_id IS NULL AND ? IS NULL)
          OR fabricante_id = ?
        )
      FOR UPDATE`,
      [productoId, empresa_id, almacen_id, fabricante_id, fabricante_id]
    );

    if (!fabricante_id) fabricante_id = null;



    if (stock) {
      // 🔼 SUMAR STOCK
      await conn.query( 
        `UPDATE stock_producto
        SET cantidad = cantidad + ?
        WHERE id = ?`,
        [Number(cantidad), stock.id]
      );
    } else {
      // 🆕 CREAR STOCK
      await conn.query(
        `INSERT INTO stock_producto
        (producto_id, empresa_id, almacen_id, fabricante_id, cantidad)
        VALUES (?,?,?,?,?)`,
        [
          productoId,
          empresa_id,
          almacen_id,
          fabricante_id || null,
          Number(cantidad)
        ]
      );
    }




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

    // =========================
    // NORMALIZAR IDS
    // =========================

    // =========================
    // NORMALIZAR IDS (DEFENSIVO)
    // =========================

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

    // =========================
    // VALIDACIONES
    // =========================

    if (!productoId || !empresa_id || !almacen_id || !cantidad) {
      throw new Error("Datos obligatorios incompletos");
    }

    cantidad = Number(cantidad);
    if (cantidad <= 0) {
      throw new Error("Cantidad inválida");
    }

    // =========================
    // INSERTAR MOVIMIENTO
    // =========================

    await conn.query(
      `INSERT INTO movimientos_inventario (
        producto_id,
        empresa_id,
        almacen_id,
        fabricante_id,
        tipo_movimiento,
        cantidad,
        precio,
        motivo_id,
        observaciones,
        estado,
        usuario_creador_id,
        requiere_logistica,
        requiere_contabilidad
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        productoId,
        empresa_id,
        almacen_id,
        fabricante_id || null,
        "saldo_inicial",
        cantidad,
        precio ? Number(precio) : null,
        motivo_id || null,
        observaciones || null,
        "APROBADO_FINAL",   // 🔥 saldo inicial entra directo
        usuarioId,
        0,
        0
      ]
    );

    // =========================
    // CREAR / ACTUALIZAR STOCK
    // =========================

    const [[stock]] = await conn.query(
      `SELECT id
       FROM stock_producto
       WHERE producto_id = ?
         AND empresa_id = ?
         AND almacen_id = ?
         AND (fabricante_id <=> ?)
       FOR UPDATE`,
      [productoId, empresa_id, almacen_id, fabricante_id || null]
    );

    if (stock) {
      await conn.query(
        `UPDATE stock_producto
         SET cantidad = cantidad + ?
         WHERE id = ?`,
        [cantidad, stock.id]
      );
    } else {
      await conn.query(
        `INSERT INTO stock_producto
         (producto_id, empresa_id, almacen_id, fabricante_id, cantidad)
         VALUES (?,?,?,?,?)`,
        [productoId, empresa_id, almacen_id, fabricante_id || null, cantidad]
      );
    }

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
      precio,              // 👈 NUEVO
      motivo_id,
      motivo_nuevo,
      op_vinculada,
      op_vinculada_nueva,
      observaciones
    } = req.body;


    const usuarioId = req.user.id;

    // =========================
    // NORMALIZAR IDS
    // =========================

    let opFinal = null;
    if (op_vinculada) opFinal = op_vinculada;
    if (!op_vinculada && op_vinculada_nueva) opFinal = op_vinculada_nueva;

    // =========================
    // NORMALIZAR IDS (DEFENSIVO)
    // =========================

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
        VALUES (?, 'salida')`,
        [motivo_nuevo.trim()]
      );
      motivo_id = resMotivo.insertId;
    }


    // =========================
    // VALIDACIONES
    // =========================

    if (!productoId || !empresa_id || !almacen_id || !cantidad) {
      throw new Error("Datos obligatorios incompletos");
    }

    cantidad = Number(cantidad);
    if (cantidad <= 0) {
      throw new Error("Cantidad inválida");
    }

    // =========================
    // VALIDAR STOCK (🔥 FIX REAL PARA VARIANTES)
    // =========================

    const [[stockRow]] = await conn.query(
      `SELECT id, cantidad
      FROM stock_producto
      WHERE producto_id = ?
        AND empresa_id = ?
        AND almacen_id = ?
        AND (
          (fabricante_id IS NULL AND ? IS NULL)
          OR fabricante_id = ?
        )
      FOR UPDATE`,
      [productoId, empresa_id, almacen_id, fabricante_id, fabricante_id]
    );


    if (!stockRow || stockRow.cantidad < cantidad) {
      throw new Error(
        `Stock insuficiente. Disponible: ${stockRow ? stockRow.cantidad : 0} unidades.
         Intentas retirar: ${cantidad} unidades.`
      );
    }

    if (precio !== undefined && precio !== null) {
      precio = Number(precio);
      if (isNaN(precio) || precio < 0) {
        throw new Error("Precio inválido");
      }
    } else {
      precio = null;
    }


    // =========================
    // INSERTAR MOVIMIENTO
    // =========================

    await conn.query(
      `INSERT INTO movimientos_inventario (
        producto_id,
        empresa_id,
        almacen_id,
        fabricante_id,
        tipo_movimiento,
        cantidad,
        precio,
        op_vinculada,
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
        fabricante_id,
        "salida",
        cantidad,
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



    // =========================
    // DESCONTAR STOCK
    // =========================

    await conn.query(
      `UPDATE stock_producto
       SET cantidad = cantidad - ?
       WHERE id = ?`,
      [cantidad, stockRow.id]
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
}



  };


  
