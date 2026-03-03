// middlewares/rolMiddleware.js
const rolMiddleware = (rolesPermitidos) => (req, res, next) => {
  const usuario = req.user; // ⚡ asegúrate de usar req.user

  console.log("💡 rolMiddleware → usuario:", usuario);

  if (!usuario) return res.status(403).json({ message: "No autorizado" });

  // rolesPermitidos puede ser string o array
  const roles = Array.isArray(rolesPermitidos) ? rolesPermitidos : [rolesPermitidos];

  // ❌ Debug extra
  console.log("💡 usuario.rol:", usuario.rol);
  console.log("💡 roles.includes(usuario.rol):", roles.includes(usuario.rol));

  if (!roles.includes(usuario.rol))
    return res.status(403).json({ message: "Rol no permitido" });

  next();
};

module.exports = { rolMiddleware };
