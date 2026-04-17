const jwt = require("jsonwebtoken");
const { initDB } = require("../config/db");

const authMiddleware = async (req, res, next) => {

  if (req.method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.authorization;
  const sessionToken = req.headers["x-session-token"];

  if (!authHeader) {
    return res.status(401).json({ message: "No autorizado" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token no enviado" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const db = await initDB();

    const [rows] = await db.query(
      "SELECT session_token FROM usuarios WHERE id = ?",
      [payload.id]
    );

    if (!rows.length) {
      return res.status(401).json({ message: "Usuario no existe" });
    }

    // 🔥 AQUÍ ESTÁ LA MAGIA
    if (rows[0].session_token !== sessionToken) {
      return res.status(401).json({ message: "Sesión inválida (cerrada por otro login)" });
    }

    req.user = payload;

    next();

  } catch (error) {
    return res.status(401).json({ message: "Token inválido" });
  }
};

module.exports = authMiddleware;