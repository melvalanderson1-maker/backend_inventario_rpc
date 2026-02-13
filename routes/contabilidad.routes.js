const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/contabilidad.controller");

const auth = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

// ✅ primero auth
router.use(auth);
// =====================
// Productos
// =====================
router.get("/productos", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.listarProductos);
router.get("/productos/:id", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.obtenerProducto);
router.get("/historial", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.listarHistorial);
router.get("/categorias", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.listarCategorias);

// =====================
// Movimientos
// =====================
router.get("/pendientes", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.listarPendientes);






// =====================
// Cambios de almacén 🔥
// =====================
router.post(
  "/cambios-almacen",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.crearCambioAlmacen
);

router.get(
  "/cambios-almacen/pendientes",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarCambiosAlmacenPendientes
);

router.post(
  "/cambios-almacen/:id/validar",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.validarCambioAlmacen
);

router.post(
  "/cambios-almacen/:id/rechazar",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.rechazarCambioAlmacen
);


router.post(
  "/cambios-almacen/:id/validar-con-edicion",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.validarCambioAlmacenConEdicion
);

// =====================
// Selects 🔥
// =====================
router.get(
  "/empresas",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarEmpresasContabilidad
);

router.get(
  "/almacenes",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarAlmacenes
);

router.get(
  "/fabricantes",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarFabricantes
);



// 🔓 SOLO LECTURA
router.get("/movimientos/:id/ultima-observacion", ctrl.getUltimaObservacionContabilidad);

// =====================
// Otros
// =====================
router.get("/movimientos", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.listarMovimientosPorProducto);
router.get("/historial", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.listarHistorial);
router.get("/stock-empresa", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.stockPorEmpresa);
router.get("/motivos-rechazo", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.listarMotivosRechazo);

router.get(
  "/stock/completo",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.stockCompleto
);

// ✅ NUEVAS RUTAS CORRECTAS


router.get(
  "/almacenes-por-empresa",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarAlmacenesPorEmpresa
);

router.get(
  "/fabricantes-por-almacen",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarFabricantesPorAlmacen
);


router.get(
  "/almacenes-para-movimiento",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarAlmacenesParaMovimiento
);

router.get(
  "/validar-stock-disponible",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.validarStockDisponible
);

router.get(
  "/almacenes-por-producto",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarAlmacenesPorProducto
);



//CONTABILIDAD
// ✅ VALIDAR / RECHAZAR
router.post("/movimientos/:movimientoId/validar", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.validarMovimiento);

router.post(
  "/movimientos/:movimientoId/rechazar",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.rechazarMovimientoContabilidad
);



//MENU MOVIMINETOS PARA TABLAS GENERALES

router.get(
  "/movimientos/todos",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.listarMovimientosTodosContabilidad
);

// Ruta para listar todos los cambios de almacén
router.get(
  "/cambios-almacen/todos",
  rolMiddleware("ADMIN_CONTABILIDAD"), // Solo usuarios con este rol
  ctrl.listarCambiosAlmacenTodosContabilidad
);





// ✅ DETALLE DE MOVIMIENTO
router.get("/movimientos/:id/detalle", rolMiddleware("ADMIN_CONTABILIDAD"), ctrl.detalleMovimiento);


router.post(
  "/movimientos/:id/guardar-general",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.guardarGeneralContabilidad
);


router.post(
  "/movimientos/:id/guardar-cantidad-real",
  rolMiddleware("ADMIN_CONTABILIDAD"),
  ctrl.guardarCantidadReal
);


router.post(
  "/movimientos/:id/subir-evidencia",
  upload.array("imagenes"),
  ctrl.subirEvidenciaContabilidad
);


module.exports = router;
