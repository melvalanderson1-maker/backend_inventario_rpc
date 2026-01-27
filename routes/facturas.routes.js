const express = require("express");
const router = express.Router();
const { initDB } = require("../config/db");

// GET facturas por usuario (con info de curso y sección y fecha/hora)
router.get("/usuario/:id", async (req, res) => {
  try {
    const db = await initDB();
    const [facturas] = await db.query(
      `SELECT 
         f.id, 
         f.numero_factura, 
         f.monto_total AS total_amount, 
         f.estado AS status,
         f.emitido_en AS fecha_pago,       -- fecha y hora del pago
         c.titulo AS course_title,
         s.codigo AS section_code,
         s.modalidad
       FROM facturas f
       JOIN matriculas m ON f.matricula_id = m.id
       JOIN cursos c ON m.curso_id = c.id
       JOIN secciones s ON m.seccion_id = s.id
       WHERE f.usuario_id = ?`,
      [req.params.id]
    );

    res.json(facturas);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Error obteniendo facturas" });
  }
});

module.exports = router;
