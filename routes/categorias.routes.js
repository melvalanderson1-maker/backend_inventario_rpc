const router = require("express").Router();
const { initDB } = require("../config/db");

let pool;
(async () => pool = await initDB())();

// ❌ ELIMINAMOS auth y rol
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nombre FROM categorias ORDER BY nombre"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error obteniendo categorías" });
  }
});

module.exports = router;
