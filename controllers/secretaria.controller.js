const { initDB } = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { sendMail } = require("../utils/sendMail");
const { enviarCorreoMatricula } = require("../utils/enviarCorreo");


// Crear alumno manualmente
// Crear alumno manualmente
exports.crearAlumnoManual = async (req, res) => {
  try {
    const { nombre, apellido_paterno, apellido_materno, correo, numero_documento, telefono } = req.body;

    if (!nombre || !apellido_paterno || !correo || !numero_documento) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const dni = numero_documento;
    const db = await initDB();

    const [existing] = await db.query(
      "SELECT id FROM usuarios WHERE correo = ? OR numero_documento = ?",
      [correo, dni]
    );
    if (existing.length > 0) return res.status(400).json({ error: "El alumno ya está registrado" });

    // ⚠️ No generamos contraseña aún
    const [insert] = await db.query(
      `INSERT INTO usuarios
      (nombre, apellido_paterno, apellido_materno, correo,
        tipo_documento, numero_documento, telefono, rol)
      VALUES (?,?,?,?,?,?,?,?)`,
      [nombre, apellido_paterno, apellido_materno, correo, "DNI", numero_documento, telefono || null, "ESTUDIANTE"]
    );

    res.json({ ok: true, usuario_id: insert.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error creando alumno" });
  }
};


// Matricular alumno manual
// Matricular alumno
exports.matricularAlumnoManual = async (req, res) => {
  try {
    const { usuario_id, curso_id, seccion_id, tipo_pago } = req.body; // ← agregamos tipo_pago

    if (!usuario_id || !curso_id) return res.status(400).json({ error: "usuario_id y curso_id son requeridos" });

    const db = await initDB();

    // 🔍 Verificar si ya existe matrícula en curso+sección
    const [matPrev] = await db.query(
      `SELECT id, estado FROM matriculas 
       WHERE usuario_id = ? AND curso_id = ? 
       AND (seccion_id = ? OR seccion_id IS NULL AND ? IS NULL)`,
      [usuario_id, curso_id, seccion_id || null, seccion_id || null]
    );

    if (matPrev.length > 0) {
      const existente = matPrev[0];
      if (existente.estado === "ACTIVO") {
        return res.status(400).json({ error: "El alumno ya se encuentra matriculado en este curso y sección." });
      }
      // Si estaba pendiente, devolvemos id para usarlo en pago
      return res.json({ ok: true, matricula_id: existente.id, mensaje: "Matrícula pendiente existente" });
    }

    // Crear matrícula nueva
    const estado = tipo_pago === "EFECTIVO" || tipo_pago === "PASARELA" ? "PENDIENTE" : "PENDIENTE";
    const [mat] = await db.query(
      `INSERT INTO matriculas (usuario_id, curso_id, seccion_id, fecha, estado, matriculado_por)
       VALUES (?,?,?,?,?,?)`,
      [usuario_id, curso_id, seccion_id || null, new Date(), estado, req.usuario?.id || null]
    );

    res.json({ ok: true, matricula_id: mat.insertId });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al matricular" });
  }
};


// Registrar pago efectivo
// registrarPagoEfectivo
exports.registrarPagoEfectivo = async (req, res) => {
  try {
    const { usuario_id, matricula_id, seccion_id, monto } = req.body;
    if (!usuario_id || !monto) return res.status(400).json({ error: "usuario_id y monto requeridos" });

    const db = await initDB();
    let finalMatriculaId = matricula_id;

    // Verificar matrícula pendiente si no se pasó
    if (!matricula_id) {
      const [matPrev] = await db.query(
        `SELECT id, estado FROM matriculas WHERE usuario_id=? AND seccion_id=? AND estado='PENDIENTE'`,
        [usuario_id, seccion_id || null]
      );
      if (matPrev.length > 0) finalMatriculaId = matPrev[0].id;
      else return res.status(400).json({ error: "No se encontró matrícula pendiente para pagar." });
    }

    // No permitir pagar si ya está ACTIVA
    const [checkActiva] = await db.query(`SELECT estado FROM matriculas WHERE id=?`, [finalMatriculaId]);
    if (checkActiva[0].estado === "ACTIVO") return res.status(400).json({ error: "La matrícula ya está pagada." });

    // Generar factura y pago
    const numeroFactura = `FAC-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
    const [f] = await db.query(
      `INSERT INTO facturas (usuario_id, matricula_id, total, numero_factura, monto_total, moneda, estado)
       VALUES (?,?,?,?,?,'PEN','PAGADO')`,
      [usuario_id, finalMatriculaId, monto, numeroFactura, monto]
    );

    const [p] = await db.query(
      `INSERT INTO pagos (usuario_id, seccion_id, matricula_id, factura_id, monto, moneda, metodo, proveedor, estado)
       VALUES (?,?,?,?,?,'PEN','EFECTIVO','PRESENCIAL','COMPLETADO')`,
      [usuario_id, seccion_id || null, finalMatriculaId, f.insertId, monto]
    );

    // Actualizar matrícula
    await db.query(`UPDATE matriculas SET estado='ACTIVO' WHERE id=?`, [finalMatriculaId]);

    // 🔹 Obtener datos del alumno
    const [alumnoRows] = await db.query(
      "SELECT nombre, apellido_paterno, apellido_materno, correo, contraseña_hash AS password_temp FROM usuarios WHERE id=?",
      [usuario_id]
    );
    const alumno = alumnoRows[0];
    if (!alumno || !alumno.correo) throw new Error("Alumno no tiene correo definido");

    // 🔹 Obtener datos del curso
    const [cursoRows] = await db.query(
      "SELECT titulo FROM cursos WHERE id=(SELECT curso_id FROM matriculas WHERE id=?)",
      [finalMatriculaId]
    );
    const curso = cursoRows[0];

    // 🔹 Obtener datos de la sección (si aplica)
    let seccion = null;
    if (seccion_id) {
      const [seccionRows] = await db.query(
        "SELECT periodo FROM secciones WHERE id=?",
        [seccion_id]
      );
      seccion = seccionRows[0];
    }

    // 🔹 Verificar si ya tiene contraseña
    const tienePassword = Boolean(alumno.password_temp); // password_temp viene de DB

    let nuevaPassTemp = null;

    if (!tienePassword) {
      // Solo generar contraseña si NO tenía
      nuevaPassTemp = crypto.randomBytes(4).toString("hex");
      const hash = await bcrypt.hash(nuevaPassTemp, 10);
      await db.query(`UPDATE usuarios SET contraseña_hash=? WHERE id=?`, [hash, usuario_id]);
    }


    // 🔹 Enviar correo de matrícula usando enviarCorreoMatricula
    // 🔹 Enviar correo de matrícula usando contraseña real
    try {
      await enviarCorreoMatricula(alumno, curso, seccion, nuevaPassTemp);
      console.log("Correo de matrícula enviado a:", alumno.correo);
    } catch (e) {
      console.warn("Error enviando correo de matrícula:", e);
    }


    res.json({ ok: true, factura_id: f.insertId, pago_id: p.insertId, numero_factura: numeroFactura });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error registrando pago efectivo" });
  }
};


// Simulación de pasarela (Yape/Tarjeta) — deberías integrar tu proveedor real
exports.registrarPagoPasarela = async (req, res) => {
  try {
    const { alumno, curso, matricula_id } = req.body;
    // Aquí normalmente crearías una sesión en la pasarela y devolverías el url/qr
    // Lo simulamos:
    const fakeQrPayload = `yape://pay?amount=100&user=${alumno}&curso=${curso}`;
    // Crear registro de pago pendiente en DB
    const db = await initDB();
    const [p] = await db.query(
      `INSERT INTO pagos (usuario_id, seccion_id, matricula_id, factura_id, monto, moneda, metodo, proveedor, qr_payload, estado)
       VALUES (?,?,?,?,?,'PEN','YAPE_QR','YAPE',?, 'PENDIENTE')`,
      [alumno, null, matricula_id || null, null, 100] // monto solo de ejemplo, idealmente usar monto real del curso
    );

    res.json({ ok: true, pago_id: p.insertId, qr_payload: fakeQrPayload, mensaje: "Simulado: escanea QR para pagar" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error registrando pago pasarela" });
  }
};
