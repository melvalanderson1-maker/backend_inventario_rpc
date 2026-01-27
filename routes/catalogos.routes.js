const router = require("express").Router();
const auth = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");
const pool = require("../config/db").initDB;

router.use(auth);
router.use(rolMiddleware("ADMIN_COMPRAS"));

/* EMPRESAS */
router.get("/empresas", async (req, res) => {
  const [rows] = await (await pool()).query(
    "SELECT id, nombre FROM empresas ORDER BY nombre"
  );
  res.json(rows);
});

/* ALMACENES */
router.get("/almacenes", async (req, res) => {
  const [rows] = await (await pool()).query(
    "SELECT id, nombre FROM almacenes ORDER BY nombre"
  );
  res.json(rows);
});

/* MOTIVOS */
router.get("/motivos-movimiento", async (req, res) => {
  const { tipo } = req.query;

  const [rows] = await (await pool()).query(
    "SELECT id, nombre FROM motivos_movimiento WHERE tipo = ?",
    [tipo]
  );

  res.json(rows);
});


router.get("/fabricantes", async (req, res) => {
  const [rows] = await (await pool()).query(
    "SELECT id, nombre FROM fabricantes ORDER BY nombre"
  );
  res.json(rows);
});


module.exports = router;
