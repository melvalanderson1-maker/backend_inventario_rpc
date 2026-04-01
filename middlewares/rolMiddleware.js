// middlewares/rolMiddleware.js
const rolMiddleware = (rolesPermitidos) => (req, res, next) => {
  const usuario = req.user; // tu authMiddleware debe poner req.user

  if (!usuario) {
    console.log("❌ No hay usuario en la request");
    return res.status(403).json({ message: "No autorizado" });
  }

  // Asegurarse que rolesPermitidos sea un array
  const roles = Array.isArray(rolesPermitidos) ? rolesPermitidos : [rolesPermitidos];

  // Compara ignorando mayúsculas y espacios
  const rolValido = roles
    .map(r => r.toUpperCase().trim())
    .includes(usuario.rol.toUpperCase().trim());

  console.log("🔐 ROL EN TOKEN:", usuario.rol);
  console.log("💡 ROLES PERMITIDOS:", roles);
  console.log("💡 ROL VALIDO:", rolValido);

  if (!rolValido) {
    console.log("❌ Acceso denegado");
    return res.status(403).json({ message: "Rol no permitido" });
  }

  // Rol permitido → continuar
  next();
};

module.exports = { rolMiddleware };