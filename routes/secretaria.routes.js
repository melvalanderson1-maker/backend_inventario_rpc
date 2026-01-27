const express = require("express");
const router = express.Router();

const {
  crearAlumnoManual,
  matricularAlumnoManual,
  registrarPagoEfectivo,
  registrarPagoPasarela
} = require("../controllers/secretaria.controller");

const authMiddleware = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

// SOLO secretaria puede acceder
router.use(authMiddleware, rolMiddleware("SECRETARIA"));

router.post("/crear-alumno", crearAlumnoManual);
router.post("/matricular", matricularAlumnoManual);
router.post("/pago-efectivo", registrarPagoEfectivo);
router.post("/pago-pasarela", registrarPagoPasarela);

module.exports = router;
