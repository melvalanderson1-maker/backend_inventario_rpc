const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false, // <== Esto permite certificados self-signed
  },
});

/**
 * Envía correos de forma segura y reutilizable.
 */
async function sendMail(to, subject, html) {
  try {
    const info = await transporter.sendMail({
      from: `"Campus UC" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });

    console.log("📧 Email enviado:", info.messageId);
    return true;
  } catch (err) {
    console.error("💥 ERROR enviando correo:", err);
    return false;
  }
}

module.exports = { sendMail };
