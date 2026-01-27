const getOrCreate = async (conn, table, nombre, extra = {}) => {
  const [[row]] = await conn.query(
    `SELECT id FROM ${table} WHERE nombre = ? LIMIT 1`,
    [nombre]
  );

  if (row) return row.id;

  const cols = ["nombre", ...Object.keys(extra)];
  const vals = [nombre, ...Object.values(extra)];
  const placeholders = cols.map(() => "?").join(",");

  const [res] = await conn.query(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`,
    vals
  );

  return res.insertId;
};

module.exports = { getOrCreate };
