const router = require("express").Router();
const controller = require("../controllers/inventarioDashboard.controller");
const auth = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

// 🔐 PRIMERO AUTH
router.use(auth);

// 🔥 IGUAL QUE LOGISTICA → AGREGA ROL
router.get("/kpis",
  rolMiddleware("ADMIN_VENTAS", "ADMIN_LOGISTICA"),
  controller.getKPIs
);

router.get("/top-productos-valor", rolMiddleware("ADMIN_VENTAS"), controller.topProductosValor);

router.get("/top-stock", rolMiddleware("ADMIN_VENTAS"), controller.topProductosStock);

router.get("/stock-bajo", rolMiddleware("ADMIN_VENTAS"), controller.productosStockBajo);

router.get("/inventario-almacen", rolMiddleware("ADMIN_VENTAS"), controller.inventarioPorAlmacen);

router.get("/rotacion", rolMiddleware("ADMIN_VENTAS"), controller.rotacionInventario);

router.get("/productos-sin-movimiento", rolMiddleware("ADMIN_VENTAS"), controller.productosSinMovimiento);

router.get("/producto/:id/lotes", rolMiddleware("ADMIN_VENTAS"), controller.detalleLotesProducto);

module.exports = router;