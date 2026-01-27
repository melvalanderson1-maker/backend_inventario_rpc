// test-db.js
const mysql = require('mysql2/promise');

(async () => {
  try {
    const connection = await mysql.createConnection({
      host: 'srv2105.hstgr.io',      // Host remoto de Hostinger
      port: 3306,                     // Puerto MySQL
      user: 'u498236186_Melendez',   // Tu usuario
      password: 'Amelval77@exo',      // La contraseña que creaste
      database: 'u498236186_inventario_rpc' // Tu base de datos
    });

    console.log('✅ Conexión exitosa a MySQL remoto!');
    await connection.end();
  } catch (err) {
    console.error('❌ Error conectando:', err.message);
  }
})();
