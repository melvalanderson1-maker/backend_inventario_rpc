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
      AND estado = 'VALIDADO_LOGISTICA'  -- 🔥 CLAVE
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

  // NORMALIZAR
  cantidad = Number(cantidad) || 0;
  precio = Number(precio) || 0;

  // ===============================
  // ENTRADA / SALDO INICIAL
  // ===============================
  if (tipo === "entrada" || tipo === "saldo_inicial") {

    const valor_entrada = cantidad * precio;

    nuevo_stock = stock_actual + cantidad;
    nuevo_valor = valor_actual + valor_entrada;

    nuevo_costo = nuevo_stock > 0
      ? nuevo_valor / nuevo_stock
      : 0;
  }

  // ===============================
  // SALIDA
  // ===============================
  else if (tipo === "salida") {

    if (stock_actual < cantidad) {
      throw new Error("Stock insuficiente");
    }

    // ✅ USAR COSTO REDONDEADO A 2 DECIMALES (IGUAL QUE UI)
    const costo_salida = Number(costo_actual.toFixed(2));

    // ✅ VALOR CONSISTENTE CON UI
    const valor_salida = Number((cantidad * costo_salida).toFixed(2));

    nuevo_stock = stock_actual - cantidad;

    // ✅ RESTA LIMPIA
    nuevo_valor = Number((valor_actual - valor_salida).toFixed(4));

    nuevo_costo = costo_actual; // 🔥 NO CAMBIA
  }

  // ===============================
  // TRASLADO
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

  // ===============================
  // 🔥 ÚNICO REDONDEO (AQUÍ)
  // ===============================
  return {
    nuevo_stock: Number(nuevo_stock),
    nuevo_valor: Number(nuevo_valor.toFixed(4)), // 🔥 SOLO AQUÍ
    nuevo_costo: Number(nuevo_costo.toFixed(4)), // 🔥 SOLO AQUÍ
    costo_anterior: Number(costo_actual.toFixed(4))
  };
}

module.exports = {
  calcularCostoYStock
};