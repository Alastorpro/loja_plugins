const { Pool } = require('pg');

let pool = null;
let initialized = false;

// Retorna null se DATABASE_URL não estiver definida (fallback JSON local).
function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return { connectionString: cleanUrl(url) };
}

// Remove parametros de SSL/autenticacao que o node-postgres interpreta de forma
// confusa (sslmode -> gera aviso de seguranca; channel_binding nao e usado por nos).
// O SSL ja e garantido via DATABASE_SSL (default true).
function cleanUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    if (u.searchParams.toString()) u.search = u.searchParams.toString();
    else u.search = '';
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Retorna o pool do Postgres (null quando DATABASE_URL não está definida).
function getPool() {
  return pool;
}

function isEnabled() {
  return !!getConfig();
}

async function initDb() {
  if (initialized) return;
  const cfg = getConfig();
  if (!cfg) {
    console.warn('[DB] DATABASE_URL não definida. Usando armazenamento JSON local (.data/).');
    return;
  }
  pool = new Pool({
    connectionString: cfg.connectionString,
    // Limite conservador p/ planos free (Neon free = 10 conexões no máximo)
    max: Math.min(Number(process.env.DATABASE_POOL_MAX) || 5, 10),
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });
  pool.on('error', (err) => {
    console.error('[DB] Erro inesperado no pool do Postgres:', err.message);
  });
  await createTables();
  initialized = true;
  console.log('[DB] PostgreSQL conectado e tabelas prontas.');
}

async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price NUMERIC NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT true,
        custom_tag BOOLEAN NOT NULL DEFAULT true,
        download_name TEXT,
        sma_data BYTEA,
        amxx_data BYTEA,
        sma_name TEXT,
        amxx_name TEXT,
        extra_files JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        plugin_id TEXT,
        plugin_name TEXT,
        buyer_name TEXT NOT NULL DEFAULT '',
        buyer_email TEXT,
        custom_tag TEXT NOT NULL DEFAULT '',
        price NUMERIC NOT NULL DEFAULT 0,
        preference_id TEXT,
        payment_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_status TEXT NOT NULL DEFAULT 'pending',
        download_url TEXT,
        delivery_file TEXT,
        delivery_type TEXT,
        saved TEXT,
        admin_sma_file TEXT,
        admin_sma_url TEXT,
        pending_sma TEXT,
        compile_output TEXT,
        notice TEXT,
        error_msg TEXT,
        delivery_data BYTEA,
        delivery_name TEXT,
        delivery_extras JSONB NOT NULL DEFAULT '[]',
        admin_sma_data BYTEA,
        admin_sma_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Migração idempotente para bancos criados antes dessas colunas.
    await client.query(`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS extra_files JSONB NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS download_name TEXT`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_extras JSONB NOT NULL DEFAULT '[]'`);
  } finally {
    client.release();
  }
}

// ===== Plugins =====
async function getPlugins() {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, name, description, price, active, custom_tag,
            download_name, sma_data, amxx_data, sma_name, amxx_name, extra_files, created_at
     FROM plugins ORDER BY created_at ASC`
  );
  return rows.map(rowToPlugin);
}

async function getPluginById(id) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, name, description, price, active, custom_tag,
            download_name, sma_data, amxx_data, sma_name, amxx_name, extra_files, created_at
     FROM plugins WHERE id = $1`, [id]
  );
  return rows.length ? rowToPlugin(rows[0]) : null;
}

async function addPlugin(data) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO plugins (id, name, description, price, active, custom_tag, download_name, sma_data, amxx_data, sma_name, amxx_name, extra_files, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, name, description, price, active, custom_tag,
               download_name, sma_data, amxx_data, sma_name, amxx_name, extra_files, created_at`,
    [
      data.id,
      data.name,
      data.description || '',
      Number(data.price) || 0,
      data.active !== false,
      data.customTag !== false,
      data.downloadName || null,
      data.smaData || null,
      data.amxxData || null,
      data.smaName || null,
      data.amxxName || null,
      toExtrasJson(data.extraFiles),
      data.createdAt || new Date().toISOString()
    ]
  );
  return rowToPlugin(rows[0]);
}

async function updatePlugin(id, data) {
  if (!pool) return null;
  // Monta SET dinamicamente com os campos fornecidos
  const set = [];
  const vals = [];
  let i = 1;
  const push = (col, val) => { set.push(`${col}=$${i++}`); vals.push(val); };

  if (data.name !== undefined) push('name', data.name);
  if (data.description !== undefined) push('description', data.description);
  if (data.price !== undefined) push('price', Number(data.price) || 0);
  if (data.active !== undefined) push('active', data.active !== false);
  if (data.customTag !== undefined) push('custom_tag', data.customTag !== false);
  if (data.downloadName !== undefined) push('download_name', data.downloadName);
  if (data.smaData !== undefined) push('sma_data', data.smaData);
  if (data.amxxData !== undefined) push('amxx_data', data.amxxData);
  if (data.smaName !== undefined) push('sma_name', data.smaName);
  if (data.amxxName !== undefined) push('amxx_name', data.amxxName);
  if (data.extraFiles !== undefined) push('extra_files', toExtrasJson(data.extraFiles));

  if (set.length === 0) return getPluginById(id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE plugins SET ${set.join(', ')} WHERE id=$${i} RETURNING *`, vals
  );
  return rows.length ? rowToPlugin(rows[0]) : null;
}

async function deletePlugin(id) {
  if (!pool) return null;
  await pool.query('DELETE FROM plugins WHERE id=$1', [id]);
}

// extraFiles -> [{ name, buf }] -> JSON string p/ JSONB (pg exige string, não array).
function toExtrasJson(extraFiles) {
  if (!Array.isArray(extraFiles) || extraFiles.length === 0) return '[]';
  return JSON.stringify(extraFiles.map(ef => ({
    name: ef.name || 'arquivo',
    data: ef.buf ? Buffer.from(ef.buf).toString('base64') : (ef.data || null)
  })));
}

function rowToPlugin(row) {
  const extras = Array.isArray(row.extra_files) ? row.extra_files : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    active: row.active,
    customTag: row.custom_tag,
    downloadName: row.download_name,
    smaData: row.sma_data ? Buffer.from(row.sma_data) : null,
    amxxData: row.amxx_data ? Buffer.from(row.amxx_data) : null,
    smaName: row.sma_name,
    amxxName: row.amxx_name,
    extraFiles: extras.map(ef => ({
      name: ef.name || 'arquivo',
      data: ef.data ? Buffer.from(ef.data, 'base64') : null
    })),
    createdAt: new Date(row.created_at).toISOString()
  };
}

// ===== Pedidos =====
async function getOrders() {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at ASC');
  return rows.map(rowToOrder);
}

async function getOrderById(id) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
  return rows.length ? rowToOrder(rows[0]) : null;
}

async function getOrderByPreferenceId(prefId) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT * FROM orders WHERE preference_id=$1', [prefId]);
  return rows.length ? rowToOrder(rows[0]) : null;
}

async function getOrderByPaymentId(paymentId) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT * FROM orders WHERE payment_id=$1', [String(paymentId)]);
  return rows.length ? rowToOrder(rows[0]) : null;
}

async function createOrder(data) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO orders (id, plugin_id, plugin_name, buyer_name, buyer_email, custom_tag, price, preference_id, payment_id, status, payment_status, download_url, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','pending',$10,$11)
     RETURNING *`,
    [
      data.id,
      data.pluginId,
      data.pluginName,
      data.buyerName || '',
      data.buyerEmail,
      data.customTag || '',
      Number(data.price) || 0,
      data.preferenceId || null,
      data.paymentId || null,
      data.downloadUrl || null,
      data.createdAt || new Date().toISOString()
    ]
  );
  return rowToOrder(rows[0]);
}

async function updateOrder(id, data) {
  if (!pool) return null;
  const set = [];
  const vals = [];
  let i = 1;
  const push = (col, val) => { set.push(`${col}=$${i++}`); vals.push(val); };

  const fieldMap = {
    pluginId: 'plugin_id', pluginName: 'plugin_name', buyerName: 'buyer_name',
    buyerEmail: 'buyer_email', customTag: 'custom_tag', price: 'price',
    preferenceId: 'preference_id', paymentId: 'payment_id', status: 'status',
    paymentStatus: 'payment_status', downloadUrl: 'download_url',
    deliveryFile: 'delivery_file', deliveryType: 'delivery_type', saved: 'saved',
    adminSmaFile: 'admin_sma_file', adminSmaUrl: 'admin_sma_url',
    pendingSma: 'pending_sma', compileOutput: 'compile_output', notice: 'notice',
    error: 'error_msg', deliveryData: 'delivery_data', deliveryName: 'delivery_name',
    deliveryExtras: 'delivery_extras',
    adminSmaData: 'admin_sma_data', adminSmaName: 'admin_sma_name'
  };
  for (const [key, val] of Object.entries(data)) {
    if (val === undefined || !fieldMap[key]) continue;
    if (key === 'deliveryExtras') {
      const list = Array.isArray(val) ? val : [];
      push(fieldMap[key], JSON.stringify(list.map(e => ({
        name: e.name || 'arquivo',
        data: e.data ? Buffer.from(e.data).toString('base64') : null
      }))));
    } else {
      push(fieldMap[key], val);
    }
  }
  if (set.length === 0) return getOrderById(id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE orders SET ${set.join(', ')} WHERE id=$${i} RETURNING *`, vals
  );
  return rows.length ? rowToOrder(rows[0]) : null;
}

function rowToOrder(row) {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    pluginName: row.plugin_name,
    buyerName: row.buyer_name,
    buyerEmail: row.buyer_email,
    customTag: row.custom_tag,
    price: Number(row.price),
    preferenceId: row.preference_id,
    paymentId: row.payment_id,
    status: row.status,
    paymentStatus: row.payment_status,
    downloadUrl: row.download_url,
    deliveryFile: row.delivery_file,
    deliveryType: row.delivery_type,
    saved: row.saved,
    adminSmaFile: row.admin_sma_file,
    adminSmaUrl: row.admin_sma_url,
    pendingSma: row.pending_sma,
    compileOutput: row.compile_output,
    notice: row.notice,
    error: row.error_msg,
    deliveryData: row.delivery_data ? Buffer.from(row.delivery_data) : null,
    deliveryName: row.delivery_name,
    deliveryExtras: (Array.isArray(row.delivery_extras) ? row.delivery_extras : []).map(e => ({
      name: e.name || 'arquivo',
      data: e.data ? Buffer.from(e.data, 'base64') : null
    })),
    adminSmaData: row.admin_sma_data ? Buffer.from(row.admin_sma_data) : null,
    adminSmaName: row.admin_sma_name,
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function deleteOrder(id) {
  if (!pool) return null;
  await pool.query('DELETE FROM orders WHERE id=$1', [id]);
}

// ===== Sugestões =====
async function getSuggestions() {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id, text, author, read, read_at, created_at FROM suggestions ORDER BY created_at ASC`
  );
  return rows.map(rowToSuggestion);
}

async function addSuggestion(data) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO suggestions (id, text, author, read, created_at)
     VALUES ($1,$2,$3,false,$4) RETURNING *`,
    [data.id, data.text, data.author || 'Anônimo', data.createdAt || new Date().toISOString()]
  );
  return rowToSuggestion(rows[0]);
}

async function markSuggestionRead(id) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `UPDATE suggestions SET read=true, read_at=now() WHERE id=$1 RETURNING *`, [id]
  );
  return rows.length ? rowToSuggestion(rows[0]) : null;
}

async function deleteSuggestion(id) {
  if (!pool) return null;
  await pool.query('DELETE FROM suggestions WHERE id=$1', [id]);
}

async function purgeExpiredSuggestions() {
  if (!pool) return null;
  const ttl = 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - ttl).toISOString();
  const { rowCount } = await pool.query(
    `DELETE FROM suggestions WHERE created_at < $1`, [cutoff]
  );
  return rowCount > 0;
}

function rowToSuggestion(row) {
  return {
    id: row.id,
    text: row.text,
    author: row.author,
    read: row.read,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

module.exports = {
  isEnabled, initDb, getConfig, getPool,
  getPlugins, getPluginById, addPlugin, updatePlugin, deletePlugin,
  getOrders, getOrderById, getOrderByPreferenceId, getOrderByPaymentId,
  createOrder, updateOrder, deleteOrder,
  getSuggestions, addSuggestion, markSuggestionRead, deleteSuggestion, purgeExpiredSuggestions
};