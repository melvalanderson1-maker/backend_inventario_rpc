// backend/controllers/matriculas.controller.js
const { initDB } = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// Configuración de correo (usa tus datos SMTP en .env)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const registrarDesdePago = async (req, res) => {
  const { cursoId, correo, dni, nombre, telefono } = req.body;
  const pool = await initDB();

  try {
    // 1️⃣ Buscar usuario por correo
    let [user] = await pool.execute("SELECT * FROM usuarios WHERE correo = ?", [correo]);

    let tempPassword;

    if (user.length === 0) {
      // 2️⃣ Generar contraseña temporal aleatoria
      tempPassword = crypto.randomBytes(4).toString("hex"); // 8 caracteres hex
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      // 3️⃣ Crear usuario
      const [insert] = await pool.execute(
        "INSERT INTO usuarios (nombre, correo, dni, telefono, rol, password) VALUES (?, ?, ?, ?, 'estudiante', ?)",
        [nombre, correo, dni, telefono, hashedPassword]
      );

      user = [{ id: insert.insertId }];
    }

    const userId = user[0].id;

    // 4️⃣ Crear matrícula
    await pool.execute(
      "INSERT INTO matriculas (usuario_id, curso_id, estado) VALUES (?, ?, 'activo')",
      [userId, cursoId]
    );

    // 5️⃣ Registrar pago
    await pool.execute(
      "INSERT INTO pagos (usuario_id, curso_id, estado) VALUES (?, ?, 'aprobado')",
      [userId, cursoId]
    );

    // 6️⃣ Enviar correo solo si es usuario nuevo
    if (tempPassword) {
      await transporter.sendMail({
        from: '"Universidad Quantum" <no-reply@uquantum.com>',
        to: correo,
        subject: "Tu cuenta ha sido creada automáticamente",
        html: `
          <p>Hola ${nombre},</p>
          <p>Tu cuenta fue creada automáticamente al comprar un curso.</p>
          <p><strong>Correo:</strong> ${correo}</p>
          <p><strong>Contraseña temporal:</strong> ${tempPassword}</p>
          <p>Por favor, inicia sesión y cambia tu contraseña desde tu perfil.</p>
        `,
      });
    }

    res.json({ ok: true, userId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error registrando matrícula" });
  }
};

const porUsuario = async (req, res) => {
  const userId = req.params.id;
  const pool = await initDB();
  try {
    const [matriculas] = await pool.execute(
      "SELECT * FROM matriculas WHERE usuario_id = ?",
      [userId]
    );
    res.json(matriculas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo matriculas" });
  }
};

module.exports = { registrarDesdePago, porUsuario };
