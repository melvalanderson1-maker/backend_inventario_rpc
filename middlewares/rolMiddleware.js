// middlewares/rolMiddleware.js
const rolMiddleware = (rolesPermitidos) => (req, res, next) => {
  const usuario = req.user;

  if (!usuario) return res.status(403).json({ message: "No autorizado" });

  const roles = Array.isArray(rolesPermitidos) ? rolesPermitidos : [rolesPermitidos];

  // Compara ignorando mayúsculas y espacios
  const rolValido = roles.map(r => r.toUpperCase().trim()).includes(usuario.rol.toUpperCase().trim());

  console.log("💡 usuario.rol:", usuario.rol);
  console.log("💡 rolesPermitidos:", roles);
  console.log("💡 rolValido:", rolValido);

  if (!rolValido) return res.status(403).json({ message: "Rol no permitido" });

  next();
};

module.exports = { rolMiddleware };
