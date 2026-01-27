const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {

  // permitir preflight
  if (req.method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.authorization;
  console.log("AUTH HEADER:", authHeader);

  console.log("URL:", req.originalUrl);
  console.log("AUTH HEADER:", req.headers.authorization);


  if (!authHeader) {
    return res.status(401).json({ message: "No autorizado" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token no enviado" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ AQUÍ recién existe req.user
    req.user = payload;

    console.log("JWT PAYLOAD:", payload);

    next();
  } catch (error) {
    console.error("JWT ERROR:", error);
    return res.status(401).json({ message: "Token inválido" });
  }
};

module.exports = authMiddleware;
