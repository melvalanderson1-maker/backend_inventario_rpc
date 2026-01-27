const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const authMiddleware = require("../middlewares/authMiddleware");

router.post("/login", authController.login);
router.post("/crear-usuario-por-compra", authController.crearUsuarioPorCompra);
router.get("/me", authMiddleware, authController.perfil);

// POST logout
router.post("/logout", (req, res) => {
  // Si estás usando cookies de sesión, puedes limpiar la cookie:
  res.clearCookie("token"); // o el nombre de tu cookie
  res.json({ ok: true, message: "Logout exitoso" });
});

module.exports = router;
