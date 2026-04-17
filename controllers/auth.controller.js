const { initDB } = require("../config/db");
const bcrypt = require("bcryptjs");

const jwt = require("jsonwebtoken");

// LOGIN REAL
const { v4: uuidv4 } = require("uuid");

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const db = await initDB();

    const [rows] = await db.query(`
      SELECT u.id, u.nombre, u.email, u.password, r.nombre AS rol
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
      WHERE u.email = ?
    `, [email]);

    if (rows.length === 0) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const usuario = rows[0];

    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    // 🔥 NUEVO: generar session token
    const sessionToken = uuidv4();

    // 🔥 guardar en DB (mata sesiones anteriores)
    await db.query(
      "UPDATE usuarios SET session_token = ? WHERE id = ?",
      [sessionToken, usuario.id]
    );

    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: "1h" } // 🔥 cámbialo a 1 hora
    );

    res.json({
      token,
      sessionToken, // 🔥 importante
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol
      }
    });

  } catch (e) {
    res.status(500).json({ message: "Error en login" });
  }
};


// CREAR USUARIO DESPUÉS DE COMPRA (puede ser el mismo que ya hiciste)
exports.crearUsuarioPorCompra = async (req, res) => {
  // puedes reutilizar tu lógica de pagoYapeSimulado
  // luego devolver el token generado
  return res.json({ ok: true, userId: 999, token: "TOKEN_DEMO" });
};

// PERFIL REAL (requiere middleware JWT)
exports.perfil = async (req, res) => {
  try {
    const db = await initDB();

    const [rows] = await db.query(`
      SELECT 
        u.id,
        u.nombre,
        u.email,
        r.nombre AS rol
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
      WHERE u.id = ?
    `, [req.user.id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    res.json(rows[0]);

  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Error obteniendo perfil" });
  }
};

