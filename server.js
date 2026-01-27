// backend/server.js
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

console.log("TOKEN MP:", process.env.MP_ACCESS_TOKEN);
console.log("FRONT_URL usando:", process.env.FRONT_URL);


// CORS
const allowedOrigins = [
  "https://rpcinventario.gruecolimp.com",
  "http://localhost:5173"
];

app.use(cors({
  origin: function(origin, callback) {
    // Permite requests sin origin (Postman, navegador de localhost)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.log("❌ CORS bloqueado para:", origin);
      return callback(new Error("Not allowed by CORS"), false);
    }
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

// Manejar preflight requests correctamente
app.options("*", cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));




app.use(bodyParser.json());

// Conexión BD
(async () => {
  try {
    const pool = await initDB();
    await pool.getConnection();
    console.log("✅ Conectado a MySQL → Base:", process.env.DB_NAME);
  } catch (err) {
    console.error("❌ Error conectando a MySQL:", err.message);
  }
})();

// 🔵 RUTAS API
app.use("/pagos", pagosRoutes);          // ESTE PRIMERO SIEMPRE
app.use("/auth", authRoutes);


app.use("/secciones", seccionesRoutes);

app.use("/facturas", facturasRoutes);
app.use("/matriculas", matriculasRoutes);



// ⚠ REGISTRAR RUTAS DE USUARIOS AQUÍ
app.use("/usuarios", require("./routes/usuarios.routes"));

app.use("/admin", require("./routes/admin.routes"));

// ⚠ IZIPAY DEBE IR DESPUÉS PARA NO ROMPER /pagos/yape/iniciar
app.use("/pagos/izipay", izipayRoutes);

app.use("/estudiantes", require("./routes/estudiantes.routes"));

app.use("/secretaria", require("./routes/secretaria.routes"));



// registrar rutas docentes (colócalo junto a las otras `app.use(...)`)
app.use("/docentes", require("./routes/docentes.routes"));


app.use("/api/logistica", require("./routes/logistica.routes"));
app.use("/api/contabilidad", require("./routes/contabilidad.routes"));






app.use("/api/compras", require("./routes/compras.routes"));

app.use("/api/categorias", require("./routes/categorias.routes"));
app.use("/api/atributos", require("./routes/atributos.routes"));




app.use("/api/compras", comprasRoutes);
app.use("/api", catalogosRoutes);





// RUTA BASE
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "Backend Universidad Quantum activo" });
});

// Puerto
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend escuchando en puerto ${PORT}`));
