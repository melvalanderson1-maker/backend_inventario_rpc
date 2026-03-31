const router = require("express").Router();
const controller = require("../controllers/inventarioDashboard.controller");
const auth = require("../middlewares/authMiddleware");

router.use(auth);

/* KPIs */
router.get("/kpis", controller.getKPIs);

/* gráficos */
router.get("/top-productos-valor", controller.topProductosValor);
router.get("/top-stock", controller.topProductosStock);
router.get("/stock-bajo", controller.productosStockBajo);
router.get("/inventario-almacen", controller.inventarioPorAlmacen);
router.get("/rotacion", controller.rotacionInventario);

/* tablas */
router.get("/productos-sin-movimiento", controller.productosSinMovimiento);

/* detalle producto */
router.get("/producto/:id/lotes", controller.detalleLotesProducto);

module.exports = router;