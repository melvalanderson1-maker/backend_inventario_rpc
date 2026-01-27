const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/logistica.controller");
const upload = require("../middlewares/upload");

const auth = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

router.use(auth);

// =====================
// Productos
// =====================
router.get("/productos", rolMiddleware("ADMIN_LOGISTICA"), ctrl.listarProductos);
router.get("/productos/:id", rolMiddleware("ADMIN_LOGISTICA"), ctrl.obtenerProducto);
router.get("/categorias", rolMiddleware("ADMIN_LOGISTICA"), ctrl.listarCategorias);

// =====================
// Movimientos
// =====================
router.get("/pendientes", rolMiddleware("ADMIN_LOGISTICA"), ctrl.listarPendientes);

router.post(
  "/movimientos/:movimientoId/validar",
  rolMiddleware("ADMIN_LOGISTICA"),
  upload.single("imagen"),
  ctrl.validarMovimiento
);

router.post(
  "/movimientos/:movimientoId/rechazar",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.rechazarMovimiento
);


// =====================
// Cambios de almacén 🔥
// =====================
router.post(
  "/cambios-almacen",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.crearCambioAlmacen
);

router.get(
  "/cambios-almacen/pendientes",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarCambiosAlmacenPendientes
);

router.post(
  "/cambios-almacen/:id/validar",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.validarCambioAlmacen
);

router.post(
  "/cambios-almacen/:id/rechazar",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.rechazarCambioAlmacen
);


router.post(
  "/cambios-almacen/:id/validar-con-edicion",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.validarCambioAlmacenConEdicion
);

// =====================
// Selects 🔥
// =====================
router.get(
  "/empresas",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarEmpresasLogistica
);

router.get(
  "/almacenes",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarAlmacenes
);

router.get(
  "/fabricantes",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarFabricantes
);



// 🔓 SOLO LECTURA
router.get("/movimientos/:id/ultima-observacion", ctrl.getUltimaObservacionLogistica);

// =====================
// Otros
// =====================
router.get("/movimientos", rolMiddleware("ADMIN_LOGISTICA"), ctrl.listarMovimientosPorProducto);
router.get("/historial", rolMiddleware("ADMIN_LOGISTICA"), ctrl.listarHistorial);
router.get("/stock-empresa", rolMiddleware("ADMIN_LOGISTICA"), ctrl.stockPorEmpresa);
router.get("/motivos-rechazo", rolMiddleware("ADMIN_LOGISTICA"), ctrl.listarMotivosRechazo);

// ✅ NUEVAS RUTAS CORRECTAS


router.get(
  "/almacenes-por-empresa",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarAlmacenesPorEmpresa
);

router.get(
  "/fabricantes-por-almacen",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarFabricantesPorAlmacen
);


router.get(
  "/almacenes-para-movimiento",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarAlmacenesParaMovimiento
);

router.get(
  "/validar-stock-disponible",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.validarStockDisponible
);

router.get(
  "/almacenes-por-producto",
  rolMiddleware("ADMIN_LOGISTICA"),
  ctrl.listarAlmacenesPorProducto
);

module.exports = router;
