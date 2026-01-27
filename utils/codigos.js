// Genera códigos aleatorios (para contraseñas temporales)
exports.generarCodigo = (length = 8) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let codigo = "";

  for (let i = 0; i < length; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return codigo;
};
