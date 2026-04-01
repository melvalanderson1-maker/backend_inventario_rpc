const router = require("express").Router();

const controller = require("../controllers/inventarioDashboard.controller");

const authMiddleware = require("../middlewares/authMiddleware");

const { rolMiddleware } = require("../middlewares/rolMiddleware");


// 🔐 AUTH
router.use(authMiddleware);


// 🔐 ROLES
router.use(
  rolMiddleware([
    "ADMIN_COMPRAS",
    "ADMIN_VENTAS"
  ])
);


// =============================
// DASHBOARD
// =============================

router.get(
  "/kpis",
  controller.getKPIs
);


router.get(
  "/top-productos-valor",
  controller.topProductosValor
);


router.get(
  "/inventario-almacen",
  controller.inventarioPorAlmacen
);


router.get(
  "/rotacion",
  controller.rotacionInventario
);


router.get(
  "/heatmap",
  controller.heatmapInventario
);


module.exports = router;