// utils/enviarCorreo.js
const { sendMail } = require("./sendMail");

async function enviarCorreoMatricula(usuario, curso, seccion, passTemp = null) {
  const html = `
    <p>Hola <b>${usuario.nombre}</b>,</p>
    <p>Te has matriculado correctamente en el curso <b>${curso.titulo}</b>, sección: <b>${seccion?.periodo || "-"}</b>.</p>
    <p>Tu correo de acceso es: <b>${usuario.correo}</b></p>
    ${passTemp ? `<p>Tu contraseña temporal es: <b>${passTemp}</b><br>Cámbiala cuando ingreses por primera vez.</p>` : ""}
    <p>¡Bienvenido(a) a Quantum!</p>
  `;
  try {
    await sendMail(usuario.correo, "✅ Matrícula y pago registrados", html);
  } catch (e) {
    console.warn("Error enviando correo de matrícula:", e);
  }
}

module.exports = { enviarCorreoMatricula };
