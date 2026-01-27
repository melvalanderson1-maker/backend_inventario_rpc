const express = require("express");
const router = express.Router();

// Controllers
const adminController = require("../controllers/admin.controller");

// Middlewares
const authMiddleware = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

// ─────────────────────────────────────────────
// 🔐 AUTENTICACIÓN GLOBAL (SOLO LOGIN)
// ─────────────────────────────────────────────
router.use(authMiddleware);

// ─────────────────────────────────────────────
// 👥 USUARIOS
// ADMIN_MAX + LOGÍSTICA
// ─────────────────────────────────────────────
router.get(
  "/usuarios",
  rolMiddleware("ADMIN_MAX", "ADMIN_LOGISTICA"),
  adminController.listarUsuarios
);

router.get(
  "/usuarios/:id",
  rolMiddleware("ADMIN_MAX"),
  adminController.obtenerUsuario
);

router.post(
  "/usuarios",
  rolMiddleware("ADMIN_MAX"),
  adminController.crearUsuario
);

router.put(
  "/usuarios/:id",
  rolMiddleware("ADMIN_MAX"),
  adminController.actualizarUsuario
);

router.delete(
  "/usuarios/:id",
  rolMiddleware("ADMIN_MAX"),
  adminController.eliminarUsuario
);

// ─────────────────────────────────────────────
// 📚 CURSOS
// ADMIN_MAX + LOGÍSTICA
// ─────────────────────────────────────────────
router.get(
  "/cursos",
  rolMiddleware("ADMIN_MAX", "ADMIN_LOGISTICA"),
  adminController.listarCursos
);

router.post(
  "/cursos",
  rolMiddleware("ADMIN_MAX", "ADMIN_LOGISTICA"),
  adminController.crearCurso
);

router.put(
  "/cursos/:id",
  rolMiddleware("ADMIN_MAX", "ADMIN_LOGISTICA"),
  adminController.actualizarCurso
);

router.delete(
  "/cursos/:id",
  rolMiddleware("ADMIN_MAX"),
  adminController.eliminarCurso
);

// ─────────────────────────────────────────────
// 🏫 SECCIONES
// ADMIN_MAX + LOGÍSTICA
// ─────────────────────────────────────────────
router.get(
  "/secciones",
  rolMiddleware("ADMIN_MAX", "ADMIN_LOGISTICA"),
  adminController.listarSecciones
);

router.post(
  "/secciones",
  rolMiddleware("ADMIN_MAX", "ADMIN_LOGISTICA"),
  adminController.crearSeccion
);

router.put(
  "/secciones/:id",
  rolMiddleware("ADMIN_MAX", "ADMIN_LOGISTICA"),
  adminController.actualizarSeccion
);

router.delete(
  "/secciones/:id",
  rolMiddleware("ADMIN_MAX"),
  adminController.eliminarSeccion
);

// ─────────────────────────────────────────────
// 💰 PAGOS
// ADMIN_MAX + CONTABILIDAD
// ─────────────────────────────────────────────
router.get(
  "/pagos",
  rolMiddleware("ADMIN_MAX", "ADMIN_CONTABILIDAD"),
  adminController.listarPagos
);

// ─────────────────────────────────────────────
// 📄 FACTURAS
// ADMIN_MAX + CONTABILIDAD
// ─────────────────────────────────────────────
router.get(
  "/facturas",
  rolMiddleware("ADMIN_MAX", "ADMIN_CONTABILIDAD"),
  adminController.listarFacturas
);

// ─────────────────────────────────────────────
// 📊 AUDITORÍA
// SOLO ADMIN_MAX
// ─────────────────────────────────────────────
router.get(
  "/auditoria",
  rolMiddleware("ADMIN_MAX"),
  adminController.listarAuditoria
);

module.exports = router;
