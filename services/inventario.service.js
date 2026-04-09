// services/inventario.service.js

async function calcularCostoYStock(conn, {
  producto_id,
  empresa_id,
  almacen_id,
  fabricante_id,
  cantidad,
  precio,
  tipo
}) {

  // 🔹 Buscar el último movimiento para obtener acumulados
  const [[ultimo]] = await conn.query(
    `SELECT stock_resultante, costo_promedio_resultante, valor_stock_resultante
     FROM movimientos_inventario
     WHERE producto_id = ?
     AND empresa_id = ?
     AND almacen_id = ?
     AND (fabricante_id <=> ?)
     ORDER BY id DESC
     LIMIT 1`,
    [producto_id, empresa_id, almacen_id, fabricante_id]
  );

  // 🔹 Valores actuales
  let stock_actual = Number(ultimo?.stock_resultante) || 0;
  let costo_actual = Number(ultimo?.costo_promedio_resultante) || 0;
  let valor_actual = Number(ultimo?.valor_stock_resultante) || 0;

  // 🔹 Inicializar nuevos valores
  let nuevo_stock = stock_actual;
  let nuevo_valor = valor_actual;
  let nuevo_costo = costo_actual;

  cantidad = Number(cantidad) || 0;
  precio = Number(precio) || 0;

  // ===============================
  // ENTRADA O SALDO INICIAL
  // ===============================
  if (tipo === "entrada" || tipo === "saldo_inicial") {

    const valor_entrada = cantidad * precio;

    nuevo_stock = stock_actual + cantidad;
    nuevo_valor = valor_actual + valor_entrada;

    // Promedio ponderado
    nuevo_costo = nuevo_stock > 0
      ? (nuevo_valor / nuevo_stock)
      : 0;

  }

  // ===============================
  // SALIDA
  // ===============================
  else if (tipo === "salida") {

    if (stock_actual < cantidad) {
      throw new Error("Stock insuficiente para realizar la salida");
    }

    const valor_salida = cantidad * costo_actual;

    nuevo_stock = stock_actual - cantidad;
    nuevo_valor = valor_actual - valor_salida;

    // El costo promedio NO cambia en salida
    nuevo_costo = costo_actual;

  }

  // 🔹 Redondeo para evitar errores flotantes
  nuevo_stock = Number(nuevo_stock);
  nuevo_valor = Number(nuevo_valor.toFixed(4));
  nuevo_costo = Number(nuevo_costo.toFixed(4));

  return {
    nuevo_stock,
    nuevo_valor,
    nuevo_costo
  };
}

module.exports = {
  calcularCostoYStock
};