// controllers/secciones.controller.js
const { initDB } = require("../config/db");

// =========================
// LISTAR TODAS LAS SECCIONES
// =========================
exports.listarSecciones = async (req, res) => {
  try {
    const pool = await initDB();
    const [rows] = await pool.query(
      `SELECT id, curso_id, codigo, periodo, docente_id, capacidad, modalidad, moodle_curso_id, creado_en 
       FROM secciones 
       ORDER BY id DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error("❌ Error listando secciones:", error);
    res.status(500).json({ error: "Error al listar secciones" });
  }
};

// =========================
// OBTENER SECCIÓN POR ID
// =========================
exports.obtenerSeccionPorId = async (req, res) => {
  try {
    const pool = await initDB();
    const [rows] = await pool.query(
      `SELECT * FROM secciones WHERE id = ?`,
      [req.params.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Sección no encontrada" });

    res.json(rows[0]);
  } catch (error) {
    console.error("❌ Error obteniendo sección:", error);
    res.status(500).json({ error: "Error al obtener sección" });
  }
};

// ====================================
// LISTAR SECCIONES POR CURSO (IMPORTANTE)
// ====================================
exports.listarSeccionesPorCurso = async (req, res) => {
  const { cursoId } = req.params;

  try {
    const pool = await initDB();

    // 1️⃣ Obtener secciones del curso
    const [secciones] = await pool.query(
      `SELECT id, codigo, curso_id, periodo, docente_id, capacidad, modalidad 
       FROM secciones WHERE curso_id = ?`,
      [cursoId]
    );

    // 2️⃣ Obtener datos del curso
    const [cursos] = await pool.query(
      `SELECT id, codigo, titulo, descripcion, precio 
       FROM cursos WHERE id = ? LIMIT 1`,
      [cursoId]
    );

    if (cursos.length === 0) {
      return res.status(404).json({ error: "Curso no encontrado" });
    }

    const curso = cursos[0];

    // 3️⃣ Respuesta con curso + secciones
    res.json({ curso, secciones });

  } catch (error) {
    console.error("❌ Error al listar secciones por curso:", error);
    res.status(500).json({ error: "Error al obtener secciones del curso" });
  }
};


exports.crearSeccion = async (req, res) => {
  const db = await initDB();

  const { curso_id, codigo, periodo, docente_id, capacidad, modalidad } = req.body;

  // Validar código único
  const [existe] = await db.query(
    "SELECT id FROM secciones WHERE codigo = ?",
    [codigo]
  );

  if (existe.length > 0) {
    return res.status(400).json({ message: "El código de sección ya existe." });
  }

  await db.query(
    `
    INSERT INTO secciones (curso_id, codigo, periodo, docente_id, capacidad, modalidad)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [curso_id, codigo, periodo, docente_id, capacidad, modalidad]
  );

  res.json({ message: "Sección creada correctamente." });
};
