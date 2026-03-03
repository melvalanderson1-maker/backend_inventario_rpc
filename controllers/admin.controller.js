// backend/controllers/admin.controller.js
const { initDB } = require("../config/db");
let pool;
(async () => {
  pool = await initDB();
})();

const bcrypt = require("bcryptjs");


// 🔐 Validador de contraseña segura
const validarPasswordSegura = (password) => {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&      // mayúscula
    /[a-z]/.test(password) &&      // minúscula
    /[0-9]/.test(password) &&      // número
    /[^A-Za-z0-9]/.test(password) // símbolo
  );
};



module.exports = {
  // ─────────────────────────────────────────────
  // USUARIOS
  // ─────────────────────────────────────────────


  
listarUsuarios: async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.id,
        u.nombre,
        u.apellido_paterno,
        u.apellido_materno,
        u.numero_documento,
        u.telefono,
        u.estado,
        u.email AS correo,
        r.nombre AS rol
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
    `);

    res.json({ ok: true, usuarios: rows });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
},



  obtenerUsuario: async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM usuarios WHERE id=?",
        [req.params.id]
      );
      res.json({ ok: true, usuario: rows[0] });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  },



crearUsuario: async (req, res) => {
  try {
    const {
      nombre,
      apellido_paterno,
      apellido_materno,
      numero_documento,
      telefono,
      estado,
      correo,
      contraseña,
      rol
    } = req.body;




    // Validaciones mínimas
    if (!nombre || !apellido_paterno || !correo || !contraseña || !rol) {
      return res.status(400).json({ msg: "Faltan datos obligatorios" });
    }


            // 🔐 VALIDAR DOMINIO DE CORREO (BACKEND)
    const dominiosPermitidos = [
      "gmail.com",
      "outlook.com",
      "hotmail.com",
      "yahoo.com",
      "yahoo.com",
      "multilimpsac.com"
    ];

    if (!correo.includes("@")) {
      return res.status(400).json({ msg: "Correo inválido" });
    }

    const dominio = correo.split("@")[1].toLowerCase();

    if (!dominiosPermitidos.includes(dominio)) {
      return res.status(400).json({
        msg: "Dominio de correo no permitido"
      });
    }


    // Buscar rol
    const [[rolRow]] = await pool.query(
      "SELECT id FROM roles WHERE nombre = ?",
      [rol.trim()]
    );

    if (!rolRow) {
      return res.status(400).json({ msg: "Rol inválido" });
    }

    // 🔐 VALIDAR CONTRASEÑA SEGURA (ANTES DE ENCRIPTAR)
    if (!validarPasswordSegura(contraseña)) {
      return res.status(400).json({
        msg: "La contraseña debe tener mínimo 8 caracteres, mayúscula, minúscula, número y símbolo"
      });
    }


    // Encriptar contraseña
    const hash = await bcrypt.hash(contraseña, 10);



    // 🔎 VALIDAR DUPLICADOS (EMAIL / DOCUMENTO)
    const [existe] = await pool.query(
      `
      SELECT 
        email,
        numero_documento
      FROM usuarios
      WHERE email = ?
        OR (numero_documento IS NOT NULL AND numero_documento = ?)
      `,
      [correo, numero_documento]
    );

    if (existe.length > 0) {
      const errores = [];

      if (existe[0].email === correo) {
        errores.push("El correo ya está registrado");
      }

      if (
        numero_documento &&
        existe[0].numero_documento === numero_documento
      ) {
        errores.push("El número de documento ya está registrado");
      }

      return res.status(409).json({
        ok: false,
        code: "DUPLICADO",
        errores
      });
    }


    // INSERT COMPLETO ✅
    await pool.query(
      `
      INSERT INTO usuarios (
        nombre,
        apellido_paterno,
        apellido_materno,
        numero_documento,
        telefono,
        estado,
        email,
        password,
        rol_id
      ) VALUES (?,?,?,?,?,?,?,?,?)
      `,
      [
        nombre,
        apellido_paterno,
        apellido_materno || null,
        numero_documento || null,
        telefono || null,
        estado || "ACTIVO",
        correo,
        hash,
        rolRow.id
      ]
    );

    res.json({ ok: true, msg: "Usuario creado correctamente" });

  } catch (err) {
    console.error("crearUsuario:", err);
    res.status(500).json({ msg: err.message });
  }
},



actualizarUsuario: async (req, res) => {
  try {
    const {
      contraseña,
      correo,
      rol,
      ...resto
    } = req.body;

    const data = { ...resto };

    // correo → email
    if (correo) data.email = correo;

    // 🔎 VALIDAR CORREO DUPLICADO (EXCEPTO EL MISMO USUARIO)
    if (correo) {
      const [existe] = await pool.query(
        "SELECT id FROM usuarios WHERE email = ? AND id <> ?",
        [correo, req.params.id]
      );

      if (existe.length > 0) {
        return res.status(409).json({
          ok: false,
          code: "DUPLICADO",
          errores: ["El correo ya está registrado por otro usuario"]
        });
      }
    }


    // contraseña → password
    // contraseña → password
    if (contraseña) {
      if (!validarPasswordSegura(contraseña)) {
      return res.status(400).json({
        ok: false,
        msg: "La contraseña debe tener mínimo 8 caracteres, mayúscula, minúscula, número y símbolo"
      });

      }

      data.password = await bcrypt.hash(contraseña, 10);
    }


    // rol string → rol_id
    if (rol) {
      const [[rolRow]] = await pool.query(
        "SELECT id FROM roles WHERE nombre=?",
        [rol.trim()]
      );

      if (!rolRow) {
        return res.status(400).json({ msg: "Rol inválido" });
      }

      data.rol_id = rolRow.id;
    }

    await pool.query(
      "UPDATE usuarios SET ? WHERE id=?",
      [data, req.params.id]
    );

    res.json({ ok: true, msg: "Usuario actualizado" });
  } catch (err) {
    console.error("actualizarUsuario:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},




eliminarUsuario: async (req, res) => {
  try {
    const id = req.params.id;

    // Intentamos eliminar directamente
    await pool.query("DELETE FROM usuarios WHERE id=?", [id]);

    res.json({ ok: true, msg: "Usuario eliminado correctamente" });
  } catch (err) {
    // Si falla por foreign key (código 1451 en MySQL)
    if (err.errno === 1451) {
      try {
        // Marcamos usuario como INACTIVO
        await pool.query("UPDATE usuarios SET estado='INACTIVO' WHERE id=?", [id]);
        res.json({ ok: true, msg: "El usuario no se puede eliminar porque tiene registros asociados, pero ha sido marcado como INACTIVO" });
      } catch (err2) {
        res.status(500).json({ ok: false, msg: err2.message });
      }
    } else {
      res.status(500).json({ ok: false, msg: err.message });
    }
  }
},
  // ─────────────────────────────────────────────
  // DOCENTES, SECRETARIAS, ALUMNOS
  // ─────────────────────────────────────────────
  listarDocentes: async (req, res) => {
    const [rows] = await pool.query(`
      SELECT u.*
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = 'ADMIN_LOGISTICA'
    `);

    res.json({ ok: true, docentes: rows });
  },



  // Listar cursos que dicta un docente
    listarCursosDocente: async (req, res) => {
    try {
        const docenteId = req.params.id;
        const [rows] = await pool.query(
        `SELECT 
            s.id AS seccion_id,
            s.codigo AS seccion_codigo,
            s.periodo,
            s.modalidad,
            s.docente_id,
            c.id AS curso_id,
            c.titulo AS curso_titulo,
            c.codigo AS curso_codigo,
            (SELECT COUNT(*) FROM matriculas m WHERE m.seccion_id = s.id AND m.estado='ACTIVO') AS alumnos_count
        FROM secciones s
        JOIN cursos c ON s.curso_id = c.id
        WHERE s.docente_id = ?`,
        [docenteId]
        );

        res.json({ ok: true, cursos: rows });
    } catch (err) {
        res.status(500).json({ ok: false, msg: err.message });
    }
    },

    // backend/controllers/admin.controller.js
listarAlumnosSeccion: async (req, res) => {
  try {
    const seccionId = req.params.id;
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.apellido_paterno, u.apellido_materno, u.correo, u.numero_documento
       FROM matriculas m
       JOIN usuarios u ON m.usuario_id = u.id
       WHERE m.seccion_id = ? AND m.estado='ACTIVO'`,
      [seccionId]
    );
    res.json({ ok: true, alumnos: rows });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
},


  listarSesiones: async (req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM sesiones WHERE seccion_id=?",
      [req.params.id]
    );
    res.json({ ok: true, sesiones: rows });
  },






  // ─────────────────────────────────────────────
  // SESIONES (Google Calendar Level)
  // ─────────────────────────────────────────────
  crearSesion : async (req, res) => {
    try {
      const {
        seccion_id,
        titulo,
        descripcion,
        inicia_en,
        termina_en,
        tipo_sesion,
        aula,
        enlace_meet
      } = req.body;

      await pool.query("INSERT INTO sesiones SET ?", {
        seccion_id,
        titulo,
        descripcion,
        inicia_en,
        termina_en,
        tipo_sesion,
        aula,
        enlace_meet
      });

      res.json({ ok: true, msg: "Sesión creada correctamente" });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  },

actualizarSesion: async (req, res) => {
  try {
    const sesionId = req.params.id;
    const data = req.body;

    // 1️⃣ Obtener la sesión antes de actualizar
    const [[sesion]] = await pool.query(
      "SELECT seccion_id FROM sesiones WHERE id=?",
      [sesionId]
    );

    if (!sesion) {
      return res.status(404).json({ ok: false, msg: "Sesión no encontrada" });
    }

    const seccionId = sesion.seccion_id;

    // 2️⃣ Actualizar la sesión (fecha, hora, título, etc.)
    await pool.query(
      "UPDATE sesiones SET ? WHERE id=?",
      [data, req.params.id]
    );


    // 🔄 3️⃣ RENÚMERAR TODAS LAS SESIONES DE LA SECCIÓN
    const [sesiones] = await pool.query(
      `
      SELECT id
      FROM sesiones
      WHERE seccion_id=?
      ORDER BY inicia_en ASC
      `,
      [seccionId]
    );

    let contador = 1;
    for (const s of sesiones) {
      await pool.query(
        "UPDATE sesiones SET titulo=? WHERE id=?",
        [`Clase ${contador}`, s.id]
      );
      contador++;
    }

    res.json({
      ok: true,
      msg: "Sesión actualizada y clases renumeradas correctamente"
    });

  } catch (err) {
    console.error("Error actualizarSesion:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},

  eliminarSesion : async (req, res) => {
    try {
      await pool.query("DELETE FROM sesiones WHERE id=?", [req.params.id]);
      res.json({ ok: true, msg: "Sesión eliminada" });
    } catch (err) {
      res.status(500).json({ ok: false, msg: err.message });
    }
  },


  // ─────────────────────────────────────────────
// HORARIOS (para generar sesiones)
// ─────────────────────────────────────────────
listarHorarios : async (req, res) => {
  try {
    const seccionId = req.params.id;
    const [rows] = await pool.query(
      "SELECT * FROM horarios WHERE seccion_id=?",
      [seccionId]
    );
    res.json({ ok: true, horarios: rows });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
},

crearHorario : async (req, res) => {
  try {
    const { seccion_id, dia_semana, hora_inicio, hora_fin, lugar } = req.body;

    // 1️⃣ Verificar si el horario ya existe
    const [existe] = await pool.query(
      `SELECT id 
       FROM horarios 
       WHERE seccion_id = ? 
         AND dia_semana = ? 
         AND hora_inicio = ? 
         AND hora_fin = ?`,
      [seccion_id, dia_semana, hora_inicio, hora_fin]
    );

    // 2️⃣ Solo insertar si NO existe
    if (existe.length === 0) {
      await pool.query("INSERT INTO horarios SET ?", {
        seccion_id,
        dia_semana,
        hora_inicio,
        hora_fin,
        lugar
      });

      return res.json({
        ok: true,
        msg: "Horario creado correctamente"
      });
    }

    // 3️⃣ Si ya existe, NO duplicar
    return res.json({
      ok: true,
      msg: "Horario ya existía, no se duplicó"
    });

  } catch (err) {
    console.error("Error crearHorario:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},



eliminarHorario: async (req, res) => {
  try {
    const horarioId = req.params.id;

    // 1️⃣ Obtener datos del horario
    const [[horario]] = await pool.query(
      "SELECT * FROM horarios WHERE id=?",
      [horarioId]
    );

    if (!horario) {
      return res.status(404).json({ ok: false, msg: "Horario no encontrado" });
    }

    // 2️⃣ Eliminar sesiones que coincidan con ese horario
    await pool.query(
      `
      DELETE s FROM sesiones s
      WHERE s.seccion_id = ?
        AND DAYOFWEEK(s.inicia_en) - 1 = ?
        AND TIME(s.inicia_en) = ?
        AND TIME(s.termina_en) = ?
      `,
      [
        horario.seccion_id,
        horario.dia_semana,
        horario.hora_inicio,
        horario.hora_fin,
      ]
    );

    // 3️⃣ Eliminar el horario
    await pool.query("DELETE FROM horarios WHERE id=?", [horarioId]);

    // 🔄 4️⃣ REORDENAR TITULOS DE SESIONES (🔥 LO QUE FALTABA)
    const [sesiones] = await pool.query(
      `
      SELECT id 
      FROM sesiones 
      WHERE seccion_id=? 
      ORDER BY inicia_en ASC
      `,
      [horario.seccion_id]
    );

    let i = 1;
    for (const s of sesiones) {
      await pool.query(
        "UPDATE sesiones SET titulo=? WHERE id=?",
        [`Clase ${i}`, s.id]
      );
      i++;
    }

    res.json({
      ok: true,
      msg: "Horario eliminado y sesiones renumeradas correctamente"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},


generarSesionesAutomaticas: async (req, res) => {
  try {
    const seccionId = req.params.id;

    await pool.query(
      "DELETE FROM sesiones WHERE seccion_id=?",
      [seccionId]
    );

    const [[seccion]] = await pool.query(
      "SELECT * FROM secciones WHERE id=?", [seccionId]
    );

    if (!seccion) {
      return res.json({ ok: false, msg: "Sección no encontrada" });
    }

    console.log(
      "DEBUG fecha_inicio:",
      seccion.fecha_inicio,
      "tipo:",
      typeof seccion.fecha_inicio
    );

    console.log(
      "DEBUG fecha_fin:",
      seccion.fecha_fin,
      "tipo:",
      typeof seccion.fecha_fin
    );


    const docenteId = seccion.docente_id;

    const [horarios] = await pool.query(
      "SELECT * FROM horarios WHERE seccion_id=?", [seccionId]
    );

    if (horarios.length === 0) {
      return res.json({ ok: false, msg: "No hay horarios configurados" });
    }
    // 🔹 helpers PRIMERO
    const toYMD = (date) => {
      if (typeof date === "string") return date;

      // ⚠️ usar getters LOCALES, NO UTC
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");

      return `${y}-${m}-${d}`;
    };


  const sumarDias = (fecha, dias) => {
    const [y, m, d] = fecha.split("-").map(Number);

    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + dias);

    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");

    return `${yy}-${mm}-${dd}`;
  };


    // 🔹 luego sí usar helpers
    const fechaInicio = toYMD(seccion.fecha_inicio);
    const fechaFin = toYMD(seccion.fecha_fin);

    let contadorClase = 1;
    let horasTotales = 0;

    let fechaActual = fechaInicio;


      while (fechaActual <= fechaFin) {
        const diaSemana = new Date(
          `${fechaActual}T12:00:00`
        ).getDay();

        for (const h of horarios) {
          if (h.dia_semana === diaSemana) {
            const inicia = `${fechaActual}T${h.hora_inicio}`;
            const termina = `${fechaActual}T${h.hora_fin}`;

            await pool.query("INSERT INTO sesiones SET ?", {
              seccion_id: seccionId,
              titulo: `Clase ${contadorClase}`,
              inicia_en: inicia,
              termina_en: termina,
              tipo_sesion: "PRESENCIAL",
              aula: h.lugar,
            });

            contadorClase++;
          }
        }

        fechaActual = sumarDias(fechaActual, 1);
      }



    await pool.query(
      "UPDATE secciones SET duracion_horas=? WHERE id=?",
      [Math.round(horasTotales), seccionId]
    );

    res.json({ ok: true, msg: "Sesiones generadas correctamente" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, msg: err.message });
  }
},




  listarSecretarias: async (req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM usuarios WHERE rol='SECRETARIA'"
    );
    res.json({ ok: true, secretarias: rows });
  },

  listarAlumnos: async (req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM usuarios WHERE rol='ESTUDIANTE'"
    );
    res.json({ ok: true, alumnos: rows });
  },

  // ─────────────────────────────────────────────
  // CURSOS
  // ─────────────────────────────────────────────
  listarCursos: async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM cursos");
    res.json({ ok: true, cursos: rows });
  },

  crearCurso: async (req, res) => {
    await pool.query("INSERT INTO cursos SET ?", [req.body]);
    res.json({ ok: true, msg: "Curso creado" });
  },

  actualizarCurso: async (req, res) => {
    await pool.query("UPDATE cursos SET ? WHERE id=?", [
      req.body,
      req.params.id,
    ]);
    res.json({ ok: true, msg: "Curso actualizado" });
  },

  eliminarCurso: async (req, res) => {
    await pool.query("DELETE FROM cursos WHERE id=?", [req.params.id]);
    res.json({ ok: true, msg: "Curso eliminado" });
  },

  // ─────────────────────────────────────────────
  // SECCIONES
  // ─────────────────────────────────────────────
  listarSecciones: async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM secciones");

    const secciones = rows.map(s => ({
      ...s,
      fecha_inicio: s.fecha_inicio
        ? `${s.fecha_inicio.getFullYear()}-${String(s.fecha_inicio.getMonth()+1).padStart(2,"0")}-${String(s.fecha_inicio.getDate()).padStart(2,"0")}`
        : null,
      fecha_fin: s.fecha_fin
        ? `${s.fecha_fin.getFullYear()}-${String(s.fecha_fin.getMonth()+1).padStart(2,"0")}-${String(s.fecha_fin.getDate()).padStart(2,"0")}`
        : null,
    }));

    res.json({ ok: true, secciones });
  },


  crearSeccion: async (req, res) => {
    await pool.query("INSERT INTO secciones SET ?", [req.body]);
    res.json({ ok: true, msg: "Sección creada" });
  },

  actualizarSeccion: async (req, res) => {
    await pool.query("UPDATE secciones SET ? WHERE id=?", [
      req.body,
      req.params.id,
    ]);
    res.json({ ok: true, msg: "Sección actualizada" });
  },

  eliminarSeccion: async (req, res) => {
    await pool.query("DELETE FROM secciones WHERE id=?", [req.params.id]);
    res.json({ ok: true, msg: "Sección eliminada" });
  },

  // ─────────────────────────────────────────────
  // PAGOS / FACTURAS / AUDITORIA
  // ─────────────────────────────────────────────
  listarPagos: async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM pagos");
    res.json({ ok: true, pagos: rows });
  },

  listarFacturas: async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM facturas");
    res.json({ ok: true, facturas: rows });
  },

  listarAuditoria: async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM auditoria");
    res.json({ ok: true, auditoria: rows });
  },
};
