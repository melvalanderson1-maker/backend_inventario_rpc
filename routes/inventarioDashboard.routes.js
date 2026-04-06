const router = require("express").Router();

const controller = require("../controllers/inventarioDashboard.controller");

const authMiddleware = require("../middlewares/authMiddleware");
const { rolMiddleware } = require("../middlewares/rolMiddleware");

router.use(authMiddleware);

router.use(
rolMiddleware([
"ADMIN_COMPRAS",
"ADMIN_CONTABILIDAD",
"ADMIN_LOGISTICA",
"ADMIN_VENTAS"
])
);

router.get("/kpis",controller.getKPIs);

router.get("/top-productos-valor",controller.getTopProductosValor);

router.get("/rotacion",controller.getRotacion);

router.get("/inventario",controller.getInventario);

router.get("/productos-stock",controller.getProductosStock);

router.get("/valor-por-empresa",controller.getValorPorEmpresa);

router.get("/categorias-resumen", controller.getCategoriasResumen);


router.get("/abc-inventario",controller.getABCInventario);

router.get("/heatmap-almacenes",controller.getHeatmapAlmacenes);

module.exports = router;