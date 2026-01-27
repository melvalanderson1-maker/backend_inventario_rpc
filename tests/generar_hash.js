const bcrypt = require("bcryptjs");

const password = "123456"; // aquí escribe la contraseña real que quieres usar

(async () => {
  const hash = await bcrypt.hash(password, 10);
  console.log("NUEVO HASH =>", hash);
})();
