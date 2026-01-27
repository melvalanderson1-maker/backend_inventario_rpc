// backend/tests/test_bcrypt.js
const bcrypt = require("bcryptjs");

const passwordPlano = "123456"; 
const hash = "$2b$10$k4PehQy87qNlYWHBnEwH3eVVjMIc8vzzpIv2D0PXmZ/nAm0i4OiPy";  

(async () => {
  const result = await bcrypt.compare(passwordPlano, hash);
  console.log("¿La contraseña coincide?:", result);
})();
