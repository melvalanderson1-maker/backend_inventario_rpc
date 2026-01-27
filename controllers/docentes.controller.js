// backend/controllers/docentes.controller.js
const { initDB } = require("../config/db");
let pool;

(async () => {
  pool = await initDB();
})();

module.exports = {


// ─────────────────────────────────────────────
// DOCENTE: SUS SECCIONES + CURSOS
// ─────────────────────────────────────────────
listarSeccionesDocente: async (req, res) => {
  try {
    const docenteId = req.user.id;

    const [rows] = await pool.query(
      `
      SELECT 
        s.id AS seccion_id,
        s.codigo AS seccion_codigo,
        s.fecha_inicio,
        s.fecha_fin,
        c.titulo AS curso_titulo
      FROM secciones s
      JOIN cursos c ON s.curso_id = c.id
      WHERE s.docente_id = ?
      ORDER BY s.fecha_inicio DESC
      `,
      [docenteId]
    );

    const secciones = rows.map(r => ({
      ...r,
      fecha_inicio: r.fecha_inicio
        ? r.fecha_inicio.toISOString().slice(0, 10)
        : null,
      fecha_fin: r.fecha_fin
        ? r.fecha_fin.toISOString().slice(0, 10)
        : null,
    }));

    res.json({ ok: true, secciones });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},

  // ─────────────────────────────────────────────
  // DOCENTE: SUS SECCIONES + CURSOS
  // ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// SESIONES DE UNA SECCIÓN (CALENDARIO)
// ─────────────────────────────────────────────
listarSesionesSeccion: async (req, res) => {
  try {
    const seccionId = req.params.id;
    const docenteId = req.user.id; // 🔐 seguridad

    const [rows] = await pool.query(
      `
      SELECT 
        s.id,
        s.titulo,
        s.inicia_en,
        s.termina_en
      FROM sesiones s
      JOIN secciones sec ON s.seccion_id = sec.id
      WHERE s.seccion_id = ?
        AND sec.docente_id = ?
      ORDER BY s.inicia_en ASC
      `,
      [seccionId, docenteId]
    );

    const sesiones = rows.map(s => ({
      ...s,
      inicia_en: s.inicia_en
        ? s.inicia_en.toISOString().slice(0, 19)
        : null,
      termina_en: s.termina_en
        ? s.termina_en.toISOString().slice(0, 19)
        : null,
    }));

    res.json({ ok: true, sesiones });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},



  // LISTAR DOCENTES
listarDocentes: async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, nombre, apellido_paterno, apellido_materno
      FROM usuarios
      WHERE rol = 'DOCENTE'
    `);

    res.json({ ok: true, docentes: rows });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
},

  // ─────────────────────────────────────────────
  // SESIONES DE UNA SECCIÓN (CALENDARIO)
  // ─────────────────────────────────────────────


  // ─────────────────────────────────────────────
  // ALUMNOS DE UNA SESIÓN
  // ─────────────────────────────────────────────
listarAlumnosSesion: async (req, res) => {
  try {
    const sesionId = req.params.id;
    const docenteId = req.user.id;

    // 1️⃣ Validar sesión + sección + docente
    const [[sesion]] = await pool.query(
      `
      SELECT s.seccion_id
      FROM sesiones s
      JOIN secciones sec ON sec.id = s.seccion_id
      WHERE s.id = ?
        AND sec.docente_id = ?
      `,
      [sesionId, docenteId]
    );

    if (!sesion) {
      return res.status(404).json({
        ok: false,
        msg: "Sesión no encontrada o no pertenece al docente",
      });
    }

    // 2️⃣ Listar alumnos matriculados de ESA sección
    const [rows] = await pool.query(
      `
      SELECT 
        u.id,
        u.nombre,
        u.apellido_paterno,
        u.apellido_materno,
        COALESCE(a.estado, 'PRESENTE') AS estado
      FROM matriculas m
      JOIN usuarios u ON u.id = m.usuario_id
      LEFT JOIN asistencias a 
        ON a.usuario_id = u.id 
        AND a.sesion_id = ?
      WHERE m.seccion_id = ?
        AND m.estado = 'ACTIVO'
      ORDER BY u.apellido_paterno
      `,
      [sesionId, sesion.seccion_id]
    );

    res.json({ ok: true, alumnos: rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},


listarAlumnosSeccion: async (req, res) => {
  try {
    const seccionId = req.params.id;

    const [rows] = await pool.query(`
      SELECT 
        u.id,
        u.nombre,
        u.apellido_paterno,
        u.apellido_materno,
        m.nota_final
      FROM matriculas m
      JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.seccion_id = ?
        AND m.estado = 'ACTIVO'
      ORDER BY u.apellido_paterno
    `, [seccionId]);

    res.json({ ok: true, alumnos: rows });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
},


obtenerInfoSesion: async (req, res) => {
  try {
    const sesionId = req.params.id;
    const docenteId = req.user.id;

    const [[info]] = await pool.query(
      `
      SELECT 
        c.titulo AS curso_titulo,
        sec.codigo AS seccion_codigo,
        s.titulo AS sesion_titulo,
        s.inicia_en,
        s.termina_en,
        (
          SELECT COUNT(*) 
          FROM matriculas m 
          WHERE m.seccion_id = sec.id 
            AND m.estado = 'ACTIVO'
        ) AS total_alumnos
      FROM sesiones s
      JOIN secciones sec ON sec.id = s.seccion_id
      JOIN cursos c ON c.id = sec.curso_id
      WHERE s.id = ?
        AND sec.docente_id = ?
      `,
      [sesionId, docenteId]
    );

    if (!info) {
      return res.status(404).json({ ok: false, msg: "Sesión no válida" });
    }

    res.json({
      ok: true,
      info: {
        ...info,
        inicia_en: info.inicia_en?.toISOString(),
        termina_en: info.termina_en?.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
},


registrarNotas: async (req, res) => {
  try {
    const seccionId = req.params.id;
    const { notas } = req.body;

    for (const n of notas) {
      await pool.query(
        `
        UPDATE matriculas
        SET nota_final=?
        WHERE seccion_id=? AND usuario_id=?
        `,
        [n.nota, seccionId, n.usuario_id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
},



  // ─────────────────────────────────────────────
  // REGISTRAR / ACTUALIZAR ASISTENCIA
  // ─────────────────────────────────────────────
  registrarAsistencia: async (req, res) => {
    try {
      const sesionId = req.params.id;
      const { asistencias } = req.body;
      const docenteId = req.user?.id || null;

      for (const a of asistencias) {
        const [existe] = await pool.query(
          `
          SELECT id FROM asistencias
          WHERE sesion_id=? AND usuario_id=?
          `,
          [sesionId, a.usuario_id]
        );

        if (existe.length === 0) {
          await pool.query(
            `
            INSERT INTO asistencias
            (sesion_id, usuario_id, estado, marcado_por)
            VALUES (?, ?, ?, ?)
            `,
            [sesionId, a.usuario_id, a.estado, docenteId]
          );
        } else {
          await pool.query(
            `
            UPDATE asistencias
            SET estado=?, marcado_por=?
            WHERE sesion_id=? AND usuario_id=?
            `,
            [a.estado, docenteId, sesionId, a.usuario_id]
          );
        }
      }

      res.json({ ok: true, msg: "Asistencia registrada correctamente" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, msg: err.message });
    }
  },

};
