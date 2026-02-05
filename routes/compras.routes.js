const router = require("express").Router();
const controller = require("../controllers/compras.controller");
const auth = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");
const upload = require("../middlewares/upload");

router.use(auth);
router.use(rolMiddleware("ADMIN_COMPRAS"));

router.get("/productos", controller.listarProductos);
router.get("/productos/:id", controller.obtenerProducto);
router.get("/categorias", controller.listarCategorias);

router.get("/productos/:id/atributos", controller.obtenerAtributosProducto);





router.post(
  "/productos",
  upload.any(),       // 👈 AQUÍ SE LEEN LAS IMÁGENES
  controller.crearProducto
);

router.post("/movimientos/entrada", controller.crearMovimientoEntrada);

router.post("/movimientos/salida", controller.crearMovimientoSalida);



router.get("/movimientos", controller.listarMovimientos);

router.get("/stock-empresa", controller.stockPorEmpresa);
router.get("/ops-existentes", controller.listarOpsExistentes);

router.post(
  "/movimientos/saldo-inicial",
  controller.crearMovimientoSaldoInicial
);

router.get("/stock-por-producto/:productoId", controller.listarStockPorProducto);

router.get("/precio-stock", controller.obtenerPrecioPorStock);




router.get("/productos/existe-codigo/:codigo", controller.existeCodigoProducto);
router.get("/productos/existe-codigo-variante/:codigo", controller.existeCodigoVariante);



router.get("/motivos-movimiento", controller.listarMotivosMovimiento);


router.get("/modelos", controller.listarModelos);
router.get("/marcas", controller.listarMarcas);




//ROUTES PARA MODULO MOVIMIENTOS GENERALES
// Ruta para listar todos los cambios de almacén
router.get(
  "/cambios-almacen/todos",
  controller.listarCambiosAlmacenTodosCompras
);


//MENU MOVIMINETOS PARA TABLAS GENERALES

router.get(
  "/movimientos/todos",
  controller.listarMovimientosTodosCompras
);


router.get("/movimientos/:id/ultima-observacion", controller.getUltimaObservacionCompras);

router.get("/movimientos/:id/detalle", controller.detalleMovimiento);




router.put("/movimientos/:id", controller.editarMovimientoCompras);
router.post("/movimientos/:id/reenviar", controller.reenviarMovimientoCompras);

router.get("/movimientos/:id", controller.getMovimientoById);


router.put("/productos/:id", upload.any(), controller.editarProducto);






module.exports = router;
