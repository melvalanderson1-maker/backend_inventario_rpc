const express = require("express");
const router = express.Router();
const { initDB } = require("../config/db");

// GET matriculas por usuario
router.get("/usuario/:id", async (req, res) => {
  try {
    const db = await initDB();
    const [matriculas] = await db.query(
      `SELECT 
         m.id, 
         c.titulo AS course_title, 
         s.modalidad, 
         s.codigo AS section_code
       FROM matriculas m
       JOIN cursos c ON m.curso_id = c.id
       JOIN secciones s ON m.seccion_id = s.id
       WHERE m.usuario_id = ?`,
      [req.params.id]
    );

    res.json(matriculas);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Error obteniendo matriculas" });
  }
});

module.exports = router;
