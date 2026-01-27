const express = require("express");
const router = express.Router();
const {
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  obtenerUsuario
} = require("../controllers/usuarios.controller");

const authMiddleware = require("../middlewares/authMiddleware");

const { rolMiddleware } = require("../middlewares/rolMiddleware");

// proteger: solo ADMIN/SECRETARIA / etc según necesites
router.use(authMiddleware, rolMiddleware("SECRETARIA","ADMIN"));

router.get("/", listarUsuarios);
router.get("/:id", obtenerUsuario);
router.post("/", crearUsuario);
router.put("/:id", actualizarUsuario);
router.delete("/:id", eliminarUsuario);

module.exports = router;
