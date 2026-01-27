// controllers/cursos.controller.js
const { initDB } = require("../config/db");

// =====================================================
// LISTAR TODOS LOS CURSOS
// =====================================================
exports.listarCursos = async (req, res) => {
  try {
    const db = await initDB();
    const [rows] = await db.query(`
      SELECT 
        id, titulo, descripcion, precio, duracion_horas, capacidad
      FROM cursos
      WHERE esta_activo = TRUE
      ORDER BY id DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener los cursos." });
  }
};

// =====================================================
// OBTENER CURSO + SECCIONES + MATRICULADOS
// =====================================================
exports.obtenerCurso = async (req, res) => {
  try {
    const db = await initDB();
    const cursoId = req.params.id;

    // === Datos del curso
    const [cursoRows] = await db.query(
      "SELECT * FROM cursos WHERE id = ? LIMIT 1",
      [cursoId]
    );

    if (cursoRows.length === 0)
      return res.status(404).json({ message: "Curso no encontrado" });

    const curso = cursoRows[0];

    // === Secciones
    const [secciones] = await db.query(
      `SELECT 
          id, curso_id, codigo, periodo, docente_id, capacidad, modalidad
       FROM secciones
       WHERE curso_id = ?`,
      [cursoId]
    );

    curso.secciones = secciones; // <-- IMPORTANTE (ANTES LO OLVIDASTE)

    // === Matriculados
    const [matriculados] = await db.query(
      `SELECT 
          m.id, m.seccion_id, m.estado, m.nota_final,
          u.nombre AS nombre,
          u.apellido_paterno AS apellido_paterno,
          u.correo AS correo
      FROM matriculas m
      INNER JOIN secciones s ON s.id = m.seccion_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE s.curso_id = ?`,
      [cursoId]
    );

    curso.matriculados = matriculados.map((m) => ({
      id: m.id,
      seccion_id: m.seccion_id,
      estado: m.estado,
      nota_final: m.nota_final,
      usuario: {
        nombre: m.nombre,
        apellido_paterno: m.apellido_paterno,
        correo: m.correo
      }
    }));

    res.json(curso);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener el curso." });
  }
};

// =====================================================
// CREAR CURSO + SECCIONES
// =====================================================
// =====================================================
// CREAR CURSO + SECCIONES
// =====================================================
exports.crearCurso = async (req, res) => {
  const {
    titulo,
    descripcion,
    precio,
    duracion_horas,
    capacidad,
    secciones = []
  } = req.body;

  if (!titulo || !descripcion || !precio) {
    return res.status(400).json({ message: "Faltan campos obligatorios" });
  }

  try {
    const db = await initDB();

    // Obtener siguiente código CUR-0001
    const [row] = await db.query(`SELECT IFNULL(MAX(id), 0) + 1 AS nextId FROM cursos`);
    const codigo = `CUR-${String(row[0].nextId).padStart(4, "0")}`;

    // VALIDAR DOCENTES
// VALIDAR QUE EL DOCENTE EXISTA EN LA TABLA USUARIOS
// VALIDAR DOCENTES (OBLIGATORIO)
    for (const s of secciones) {
      if (!s.docente_id) {
        return res.status(400).json({
          message: `Debes seleccionar un docente para la sección ${s.codigo}`
        });
      }

      // Verificar que el docente exista y tenga rol DOCENTE
      const [doc] = await db.query(
        "SELECT id FROM usuarios WHERE id = ? AND rol = 'DOCENTE'",
        [s.docente_id]
      );

      if (doc.length === 0) {
        return res.status(400).json({
          message: `El docente con ID ${s.docente_id} no existe o no tiene rol DOCENTE`
        });
      }
    }


    // Insertar curso
    const [result] = await db.query(
      `INSERT INTO cursos 
        (codigo, titulo, descripcion, precio, duracion_horas, capacidad, esta_activo)
      VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [codigo, titulo, descripcion, precio, duracion_horas || 0, capacidad || 0]
    );

    const cursoId = result.insertId;

    // Insertar secciones
    for (const s of secciones) {
      await db.query(
        `INSERT INTO secciones (curso_id, codigo, periodo, docente_id, capacidad, modalidad)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          cursoId,
          s.codigo,
          s.periodo,
          s.docente_id || null,
          s.capacidad || null,
          s.modalidad,
        ]
      );
    }

    res.json({ message: "Curso creado con éxito", id: cursoId });

  } catch (error) {
    console.error("Error en crearCurso:", error);
    res.status(500).json({ message: "Error al crear curso" });
  }
};



