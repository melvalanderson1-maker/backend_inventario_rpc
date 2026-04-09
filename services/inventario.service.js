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

  let stock_actual = ultimo?.stock_resultante || 0;
  let costo_actual = ultimo?.costo_promedio_resultante || 0;
  let valor_actual = ultimo?.valor_stock_resultante || 0;

  let nuevo_stock = stock_actual;
  let nuevo_valor = valor_actual;
  let nuevo_costo = costo_actual;

  if (tipo === "entrada" || tipo === "saldo_inicial") {
    const valor_entrada = cantidad * (precio || 0);

    nuevo_valor = valor_actual + valor_entrada;
    nuevo_stock = stock_actual + cantidad;
    nuevo_costo = nuevo_stock > 0 ? (nuevo_valor / nuevo_stock) : 0;

  } else if (tipo === "salida") {
    nuevo_stock = stock_actual - cantidad;
    nuevo_valor = nuevo_stock * costo_actual;
    nuevo_costo = costo_actual;
  }

  return {
    nuevo_stock,
    nuevo_valor,
    nuevo_costo
  };
}

module.exports = {
  calcularCostoYStock
};