// routes/cursos.routes.js
const express = require("express");
const router = express.Router();

const {
  listarCursos,
  obtenerCurso,
  crearCurso
} = require("../controllers/cursos.controller");

// Rutas oficiales
router.get("/", listarCursos);
router.get("/:id", obtenerCurso);
router.post("/", crearCurso);

module.exports = router;
