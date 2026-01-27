require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

// BD
const { initDB } = require("./config/db");

// RUTAS
const pagosRoutes = require("./routes/pagos.routes");
const authRoutes = require("./routes/auth.routes");
const cursosRoutes = require("./routes/cursos.routes");
const matriculasRoutes = require("./routes/matriculas.routes");
const izipayRoutes = require("./routes/izipay.routes");
const seccionesRoutes = require("./routes/secciones.routes");
const facturasRoutes = require("./routes/facturas.routes");
const comprasRoutes = require("./routes/compras.routes");
const catalogosRoutes = require("./routes/catalogos.routes");

const app = express();

// =======================
// LOGS INICIALES
// =======================
console.log("MP_ACCESS_TOKEN:", !!process.env.MP_ACCESS_TOKEN);
console.log("FRONT_URL:", process.env.FRONT_URL);

// =======================
// CORS
// =======================
const allowedOrigins = ["https://rpcinventario.gruecolimp.com"];
app.use(cors({
    origin: function(origin, callback){
        if(!origin) return callback(null, true);
        if(allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("CORS no permitido"), false);
    },
    credentials: true
}));
app.options("*", cors());

// =======================
// BODY PARSER
// =======================
app.use(bodyParser.json());

// =======================
// CONEXIÓN DB (POOL GLOBAL)
// =======================
let dbPool = null;
(async () => {
    try {
        dbPool = await initDB();
        await dbPool.getConnection();
        console.log("✅ Conectado a MySQL → Base:", process.env.DB_NAME);
    } catch (err) {
        console.error("⚠️ No se pudo conectar a MySQL:", err.message);
    }
})();

// =======================
// RUTAS
// =======================
app.use("/pagos", pagosRoutes);
app.use("/auth", authRoutes);
app.use("/cursos", cursosRoutes);
app.use("/secciones", seccionesRoutes);
app.use("/facturas", facturasRoutes);
app.use("/matriculas", matriculasRoutes);
app.use("/usuarios", require("./routes/usuarios.routes"));
app.use("/admin", require("./routes/admin.routes"));
app.use("/pagos/izipay", izipayRoutes);
app.use("/estudiantes", require("./routes/estudiantes.routes"));
app.use("/secretaria", require("./routes/secretaria.routes"));
app.use("/docentes", require("./routes/docentes.routes"));
app.use("/api/logistica", require("./routes/logistica.routes"));
app.use("/api/contabilidad", require("./routes/contabilidad.routes"));
app.use("/api/compras", comprasRoutes);
app.use("/api/categorias", require("./routes/categorias.routes"));
app.use("/api/atributos", require("./routes/atributos.routes"));
app.use("/api", catalogosRoutes);

// =======================
// RUTA BASE
// =======================
app.get("/", (req, res) => {
    res.json({ ok: true, msg: "🚀 Backend RPC INVENTARIOS ACTIVO" });
});

// =======================
// PUERTO HOSTINGER
// =======================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Backend escuchando en puerto ${PORT}`));
