// services/inventario.service.js

async function calcularCostoYStock(conn, {
  producto_id,
  empresa_id,
  almacen_id,
  fabricante_id,
  cantidad,
  precio,
  tipo,
  costo_referencia // 👈 NUEVO
}) {

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

  let stock_actual = Number(ultimo?.stock_resultante) || 0;
  let costo_actual = Number(ultimo?.costo_promedio_resultante) || 0;
  let valor_actual = Number(ultimo?.valor_stock_resultante) || 0;

  let nuevo_stock = stock_actual;
  let nuevo_valor = valor_actual;
  let nuevo_costo = costo_actual;

  cantidad = Number(cantidad) || 0;
  precio = Number(precio) || 0;

  // ===============================
  // ENTRADA / SALDO INICIAL
  // ===============================
  if (tipo === "entrada" || tipo === "saldo_inicial") {

    // 🔥 REDONDEAR PRECIO
    const precio_redondeado = Number(precio.toFixed(2));

    // 🔥 VALOR EXACTO
    const valor_entrada = Number((cantidad * precio_redondeado).toFixed(2));

    nuevo_stock = stock_actual + cantidad;

    // 🔥 REDONDEAR TOTAL
    nuevo_valor = Number((valor_actual + valor_entrada).toFixed(2));

    nuevo_costo = nuevo_stock > 0
    ? Number((nuevo_valor / nuevo_stock).toFixed(4))
    : 0;
  }

  // ===============================
  // SALIDA
  // ===============================
  else if (tipo === "salida") {

    if (stock_actual < cantidad) {
      throw new Error("Stock insuficiente");
    }

    // 🔥 REDONDEAR COSTO A 2 DECIMALES (CLAVE)
    const costo_redondeado = Number(costo_actual.toFixed(2));

    // 🔥 CALCULAR VALOR SALIDA CON PRECISIÓN UI
    const valor_salida = Number((cantidad * costo_redondeado).toFixed(2));

    nuevo_stock = stock_actual - cantidad;

    // 🔥 TAMBIÉN REDONDEAR RESULTADO FINAL
    nuevo_valor = Number((valor_actual - valor_salida).toFixed(2));

    nuevo_costo = costo_actual; // no cambia
  }

  // ===============================
  // 🔥 TRASLADO (NUEVO)
  // ===============================
  else if (tipo === "traslado") {

    if (stock_actual < cantidad) {
      throw new Error("Stock insuficiente para traslado");
    }

    const costo = costo_referencia ?? costo_actual;
    const valor = cantidad * costo;

    nuevo_stock = stock_actual - cantidad;
    nuevo_valor = valor_actual - valor;

    nuevo_costo = costo_actual;
  }

  return {
    nuevo_stock: Number(nuevo_stock),
    nuevo_valor: Number(nuevo_valor.toFixed(2)),
    nuevo_costo: Number(nuevo_costo.toFixed(4)),
    costo_anterior: Number(costo_actual) // 👈 NUEVO
  };
}

module.exports = {
  calcularCostoYStock
};