// backend/routes/secciones.routes.js
const express = require("express");
const router = express.Router();

const {
  listarSecciones,
  obtenerSeccionPorId,
  listarSeccionesPorCurso,
  crearSeccion
} = require("../controllers/secciones.controller");


const authMiddleware = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

// ==============================================
// PROTEGER TODAS LAS RUTAS DE SECCIONES
// SOLO SECRETARIA PUEDE ACCEDER
// ==============================================
router.use(authMiddleware, rolMiddleware("SECRETARIA"));


// ===========================
// GET /secciones (todas)
// ===========================
router.get("/", listarSecciones);


// ==============================================
// GET /secciones/curso/:cursoId
// → usado en checkout / matrícula
// ==============================================
router.get("/curso/:cursoId", listarSeccionesPorCurso);

router.post("/", crearSeccion);



// ===========================
// GET /secciones/:id
// ===========================
router.get("/:id", obtenerSeccionPorId);


module.exports = router;
