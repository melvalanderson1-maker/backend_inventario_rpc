const { initDB } = require("../config/db");
const bcrypt = require("bcryptjs");

exports.listarUsuarios = async (req, res) => {
  try {
    const db = await initDB();
    const [rows] = await db.query("SELECT id, nombre, apellido_paterno, apellido_materno, correo, rol, estado, numero_documento FROM usuarios");
    res.json(rows);
  } catch (e) {
    console.error(e); res.status(500).json({ error: "Error listando usuarios" });
  }
};

exports.obtenerUsuario = async (req, res) => {
  try {
    const db = await initDB();
    const [rows] = await db.query("SELECT id, nombre, apellido_paterno, apellido_materno, correo, rol, estado, numero_documento FROM usuarios WHERE id = ?", [req.params.id]);
    res.json(rows[0] || {});
  } catch (e) { console.error(e); res.status(500).json({ error: "Error obteniendo usuario" }); }
};

exports.crearUsuario = async (req, res) => {
  try {
    const { nombre, email, rol_id } = req.body;

    if (!nombre || !email || !rol_id) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const db = await initDB();

    const passTemp = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(passTemp, 10);

    const [result] = await db.query(
      `INSERT INTO usuarios (nombre, email, password, rol_id)
       VALUES (?, ?, ?, ?)`,
      [nombre, email, hash, rol_id]
    );

    res.json({
      ok: true,
      id: result.insertId,
      passwordTemporal: passTemp
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error creando usuario" });
  }
};

exports.actualizarUsuario = async (req, res) => {
  try {
    const { nombre, apellido_paterno, apellido_materno, correo, rol, estado } = req.body;
    const db = await initDB();
    await db.query(`UPDATE usuarios SET nombre=?, apellido_paterno=?, apellido_materno=?, correo=?, rol=?, estado=? WHERE id=?`,
      [nombre, apellido_paterno, apellido_materno, correo, rol, estado, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error actualizando usuario" }); }
};

exports.eliminarUsuario = async (req, res) => {
  try {
    const db = await initDB();
    await db.query("DELETE FROM usuarios WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Error eliminando usuario" }); }
};
