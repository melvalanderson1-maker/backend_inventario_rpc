// backend/controllers/pagos.controller.js
const { initDB } = require("../config/db");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/email");

// =============================================================
// 1️⃣ YAPE SIMULADO — PROCESA EL PAGO COMPLETO
// =============================================================
const pagoYapeSimulado = async (req, res) => {
  console.log("========== YAPE SIMULADO INICIADO ==========");
  console.log("BODY RECIBIDO:", req.body);

  try {
    const { alumno, curso } = req.body;

    // VALIDACIÓN
    if (!alumno || !curso) {
      console.log("❌ ERROR: Faltan datos alumno o curso");
      return res.status(400).json({ error: "Faltan datos alumno o curso" });
    }

    const db = await initDB();

    // BUSCAR USUARIO
    const [usu] = await db.query("SELECT * FROM usuarios WHERE correo = ?", [
      alumno.correo,
    ]);

    let usuarioId;
    let passwordTemporal = null;

    // Crear usuario si no existe
    if (usu.length === 0) {
      console.log("🟢 Usuario NO existe. Creando usuario nuevo...");
      
      // Contraseña temporal en texto plano
      passwordTemporal = crypto.randomBytes(4).toString("hex");
      // Hash con bcrypt
      const hash = await bcrypt.hash(passwordTemporal, 10);

      const [insert] = await db.query(
        `INSERT INTO usuarios
          (nombre, apellido_paterno, apellido_materno, correo, contraseña_hash,
           tipo_documento, numero_documento, telefono, rol)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          alumno.nombre,
          alumno.apellido_paterno,
          alumno.apellido_materno,
          alumno.correo,
          hash, // ✅ guardar hash de bcrypt
          "DNI",
          alumno.dni,
          alumno.telefono,
          "ESTUDIANTE",
        ]
      );

      usuarioId = insert.insertId;
      console.log("🟢 Usuario creado con ID:", usuarioId);
    } else {
      usuarioId = usu[0].id;
      console.log("🟢 Usuario ya existe con ID:", usuarioId);
    }

    // VERIFICAR MATRÍCULA PREVIA
    console.log("🔎 Verificando matrícula previa...");
    const [yaMatriculado] = await db.query(
      `SELECT * FROM matriculas WHERE usuario_id = ? AND curso_id = ?`,
      [usuarioId, curso.id]
    );

    let mensajeMatricula;
    let matriculaId;

    if (yaMatriculado.length > 0) {
      console.log("⚠️ Usuario ya estaba matriculado.");
      matriculaId = yaMatriculado[0].id;
      mensajeMatricula = `Ya estabas matriculado en: ${curso.titulo}`;
    } else {
      // REGISTRAR NUEVA MATRÍCULA
      console.log("🟢 Registrando nueva matrícula...");
      const [mat] = await db.query(
        `INSERT INTO matriculas (usuario_id, curso_id, seccion_id, fecha)
         VALUES (?, ?, ?, NOW())`,
        [usuarioId, curso.id, curso.seccion_id]
      );
      matriculaId = mat.insertId;
      console.log("🟢 Matrícula creada con ID:", matriculaId);

      mensajeMatricula = `Te matriculaste con éxito en: ${curso.titulo}`;
    }

    // SOLO CREAR FACTURA Y PAGO SI ES NUEVA MATRÍCULA
    if (yaMatriculado.length === 0) {
      // FACTURA
      console.log("🟢 Creando factura...");
      const numeroFactura = `FAC-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
      const [fact] = await db.query(
        `INSERT INTO facturas 
          (usuario_id, matricula_id, total, numero_factura, monto_total, moneda, estado)
        VALUES (?, ?, ?, ?, ?, 'PEN', 'PAGADO')`,
        [usuarioId, matriculaId, curso.precio, numeroFactura, curso.precio]
      );

      const facturaId = fact.insertId;
      console.log("🟢 Factura creada con ID:", facturaId);

      // REGISTRAR PAGO
      console.log("🟢 Registrando pago...");
      await db.query(
        `INSERT INTO pagos
          (usuario_id, seccion_id, matricula_id, factura_id,
           monto, moneda, metodo, proveedor, id_pago_proveedor, estado)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          usuarioId,
          curso.seccion_id,
          matriculaId,
          facturaId,
          curso.precio,
          "PEN",
          "YAPE_QR",
          "YAPE_SIMULADO",
          null,
          "COMPLETADO",
        ]
      );

      console.log("🟢 Pago registrado correctamente.");
    }

    // ENVIAR CORREO SOLO SI EL USUARIO ES NUEVO
    if (passwordTemporal) {
      console.log("📧 Enviando correo con contraseña temporal...");
      const html = `
        <h2>Tu matrícula de ${curso.titulo} fue exitosa 🎉</h2>
        <p>Hola ${alumno.nombre},</p>
        <p>Tu cuenta fue creada. Contraseña temporal: <b>${passwordTemporal}</b></p>
        <p>Por favor inicia sesión y cambia tu contraseña.</p>
      `;
      const correoEnviado = await sendMail(alumno.correo, "Tu matrícula fue exitosa 🎓", html);
      if (!correoEnviado) console.warn("⚠️ No se pudo enviar el correo al usuario nuevo");
    }

    // TOKEN JWT
    const token = jwt.sign(
      { id: usuarioId, rol: "ESTUDIANTE" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("🟢 TOKEN generado. Enviando respuesta final.");

    // Redirección según usuario nuevo o existente
    const redirectUrl = passwordTemporal ? "/login" : "/dashboard-estudiante";

    return res.json({
      ok: true,
      authToken: token,
      matriculaMensaje: mensajeMatricula,
      redirect: redirectUrl,
    });

  } catch (e) {
    console.error("💥 ERROR YAPE SIMULADO:", e);
    return res.status(500).json({ error: "Error procesando Yape" });
  }
};

module.exports = { pagoYapeSimulado };
