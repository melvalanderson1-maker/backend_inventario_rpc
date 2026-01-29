require("dotenv").config();
const express = require("express");
const cors = require("cors");

// 🔥 PROTECCIÓN ANTI-CRASH
process.on("uncaughtException", err => {
  console.error("🔥 Uncaught Exception:", err);
});
process.on("unhandledRejection", err => {
  console.error("🔥 Unhandled Promise Rejection:", err);
});

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

// 🔥 CORS REAL Y SEGURO
const allowedOrigins = [
  "http://localhost:5173",
  "https://rpcinventario.gruecolimp.com",
  "https://serverapi.gruecolimp.com",
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS bloqueado: " + origin));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

// 🔥 INICIALIZAR DB UNA SOLA VEZ
initDB();

// 🔵 RUTAS
app.use("/pagos", pagosRoutes);
app.use("/auth", authRoutes);
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

// RUTA BASE
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "Backend activo ✅" });
});

// PUERTO
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend escuchando en puerto ${PORT}`));
