const nodemailer = require("nodemailer");
require("dotenv").config(); // Carga variables de .env

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false, // true si usas 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendMail(to, subject, html) {
  if (!to) throw new Error("No recipients defined"); // 💡 validación
  return transporter.sendMail({
    from: `"Quantum" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
}

module.exports = { sendMail };
