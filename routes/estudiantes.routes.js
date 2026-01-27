const express = require("express");
const router = express.Router();
const { initDB } = require("../config/db");

// Listar estudiantes
router.get("/", async (req, res) => {
  try {
    const db = await initDB();
    const [rows] = await db.query(`
      SELECT id, nombre, apellido_paterno, apellido_materno,
             correo, numero_documento, telefono
      FROM usuarios
      WHERE rol = 'ESTUDIANTE'
      ORDER BY nombre ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error obteniendo estudiantes" });
  }
});

module.exports = router;
