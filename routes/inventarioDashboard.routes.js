const router = require("express").Router();
const controller = require("../controllers/inventarioDashboard.controller");
const auth = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

// 🔐 Autenticación
router.use(auth);

// 🔐 Solo ADMIN_VENTAS puede acceder a este router
router.use(rolMiddleware(["ADMIN_COMPRAS", "ADMIN_VENTAS"]));

// 🔥 RUTAS DASHBOARD SOLO PARA ADMIN_VENTAS
router.get("/kpis", controller.getKPIs);

router.get("/top-productos-valor", controller.topProductosValor);

router.get("/top-stock", controller.topProductosStock);

router.get("/stock-bajo", controller.productosStockBajo);

router.get("/inventario-almacen", controller.inventarioPorAlmacen);

router.get("/rotacion", controller.rotacionInventario);

router.get("/productos-sin-movimiento", controller.productosSinMovimiento);

router.get("/producto/:id/lotes", controller.detalleLotesProducto);

module.exports = router;