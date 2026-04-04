const router = require("express").Router();

const controller = require("../controllers/inventarioDashboard.controller");

const authMiddleware = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");


// =============================
// 🔐 AUTH
// =============================
router.use(authMiddleware);


// =============================
// 🔐 ROLES
// =============================
router.use(
  rolMiddleware([
    "ADMIN_COMPRAS",
    "ADMIN_VENTAS"
  ])
);


// =============================
// DASHBOARD INVENTARIO
// =============================

// KPIs
router.get(
  "/kpis",
  controller.getKPIs
);

// TOP PRODUCTOS
router.get(
  "/top-productos-valor",
  controller.getTopProductosValor
);

// ROTACION
router.get(
  "/rotacion",
  controller.getRotacion
);

// HEATMAP
router.get(
  "/heatmap",
  controller.getHeatmap
);

// TABLA COMPLETA INVENTARIO
router.get(
  "/inventario",
  controller.getInventario
);

// DETALLE POR EMPRESA / ALMACEN
router.get(
  "/inventario-almacen",
  controller.getLotesByEmpresaAlmacen
);

// PRODUCTOS POR STOCK
router.get(
  "/productos-stock",
  controller.getProductosStock
);

module.exports = router;