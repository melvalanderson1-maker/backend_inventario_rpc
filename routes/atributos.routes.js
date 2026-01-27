const router = require("express").Router();
const { initDB } = require("../config/db");

let pool;
(async () => pool = await initDB())();

/**
 * GET /api/atributos?categoria=ID
 * Retorna los atributos asociados a una categoría
 */
router.get("/", async (req, res) => {
  try {
    const { categoria } = req.query;

    if (!categoria) {
      return res.status(400).json({
        error: "La categoría es obligatoria"
      });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        id,
        nombre,
        tipo,
        unidad,
        obligatorio
      FROM atributos
      WHERE categoria_id = ?
      ORDER BY nombre
      `,
      [categoria]
    );

    res.json(rows);
  } catch (error) {
    console.error("Error obteniendo atributos:", error);
    res.status(500).json({
      error: "Error obteniendo atributos"
    });
  }
});

module.exports = router;
