const express = require("express");
const router = express.Router();
const docentesController = require("../controllers/docentes.controller");
const authMiddleware = require("../middlewares/authMiddleware");

// ❌ (opcional) elimina si no lo usas
// router.get("/", docentesController.listarDocentes);

// ✅ SECCIONES DEL DOCENTE (JWT)
router.get(
  "/mis-secciones",
  authMiddleware,
  docentesController.listarSeccionesDocente
);

// Sesiones de una sección
router.get(
  "/secciones/:id/sesiones",
  authMiddleware, // 🔐 NECESARIO
  docentesController.listarSesionesSeccion
);


router.get(
  "/sesiones/:id/alumnos",
  authMiddleware,
  docentesController.listarAlumnosSesion
);

router.post(
  "/sesiones/:id/asistencia",
  authMiddleware,
  docentesController.registrarAsistencia
);

router.get(
  "/secciones/:id/alumnos",
  authMiddleware,
  docentesController.listarAlumnosSeccion
);

router.get(
  "/sesiones/:id/info",
  authMiddleware,
  docentesController.obtenerInfoSesion
);


router.post(
  "/secciones/:id/notas",
  authMiddleware,
  docentesController.registrarNotas
);


module.exports = router;
