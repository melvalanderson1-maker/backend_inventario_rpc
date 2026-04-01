const router = require("express").Router();

const controller = require("../controllers/inventarioDashboard.controller");

const authMiddleware = require("../middlewares/authMiddleware");

const { rolMiddleware } = require("../middlewares/rolMiddleware");

router.use(authMiddleware);

router.use(
  rolMiddleware([
    "ADMIN_COMPRAS",
    "ADMIN_VENTAS"
  ])
);

router.get("/kpis",controller.getKPIs);

router.get("/top-productos-valor",controller.getTopProductosValor);

router.get("/rotacion",controller.getRotacion);

router.get("/heatmap",controller.getHeatmap);

module.exports = router;