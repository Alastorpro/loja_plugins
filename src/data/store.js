const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const PLUGINS_FILE = path.join(DATA_DIR, 'plugins.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'suggestions.json');
const SUGGESTION_TTL = 24 * 60 * 60 * 1000; // 24 horas

let useDb = false;

// ===== Inicialização =====
async function initData() {
  await db.initDb();
  useDb = db.isEnabled();
  ensureDir();
  if (useDb) {
    // Garante a pasta de materialização dos arquivos (.sma/.amxx)
    if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });
    console.log('[DB] Armazenamento via PostgreSQL ativo.');
  } else {
    if (!fs.existsSync(PLUGINS_FILE)) writeJSON(PLUGINS_FILE, []);
    if (!fs.existsSync(ORDERS_FILE)) writeJSON(ORDERS_FILE, []);
    console.log('[DB] Armazenamento via arquivos JSON (.data/).');
    // Em produção isso significa perda de dados a cada deploy: avisa com destaque.
    if (process.env.NODE_ENV === 'production') {
      console.error('==========================================================');
      console.error('ATENÇÃO: produção SEM PostgreSQL (DATABASE_URL vazia).');
      console.error('Plugins/pedidos ficam em arquivos efêmeros e SOMEM a cada deploy.');
      console.error('Configure DATABASE_URL (+ DATABASE_SSL=true) no Render:');
      console.error('Dashboard -> Web Service -> Environment -> Add Variable.');
      console.error('==========================================================');
    }
  }
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===== Materialização dos arquivos do plugin (Postgres -> disco) =====
// O código existente (compilador, entrega, views) espera um caminho em
// `sourceFile`/`amxxFile`. Quando o plugin vem do banco, os bytes ficam no
// Postgres (smaData/amxxData) e são escritos em .data/sources/<id>.sma|.amxx.
function materializePlugin(p) {
  if (!p) return p;
  if (p.smaData && p.smaData.length) {
    const srcPath = path.join(SOURCES_DIR, `${p.id}.sma`);
    if (!fs.existsSync(srcPath)) writeBytes(srcPath, Buffer.from(p.smaData));
    p.sourceFile = srcPath;
  }
  if (p.amxxData && p.amxxData.length) {
    const amxxPath = path.join(SOURCES_DIR, `${p.id}.amxx`);
    if (!fs.existsSync(amxxPath)) writeBytes(amxxPath, Buffer.from(p.amxxData));
    p.amxxFile = amxxPath;
  }
  // Arquivos extras: grava os bytes e expõe caminhos prontos para entrega.
  const extras = [];
  if (Array.isArray(p.extraFiles)) {
    p.extraFiles.forEach((ef, i) => {
      if (!ef.data || !ef.data.length) return;
      const ext = path.extname(ef.name) || '.amxx';
      const extraPath = path.join(SOURCES_DIR, `${p.id}_extra_${i}${ext}`);
      if (!fs.existsSync(extraPath)) writeBytes(extraPath, Buffer.from(ef.data));
      extras.push({ name: ef.name, path: extraPath });
    });
  }
  p.extraFiles = extras;
  // Remove os buffers do objeto público (os caminhos já foram materializados)
  delete p.smaData;
  delete p.amxxData;
  if (!p.sourceFile) p.sourceFile = null;
  if (!p.amxxFile) p.amxxFile = null;
  return p;
}

function writeBytes(filePath, buf) {
  ensureDir();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

function removeFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) { /* ignora */ }
}

// Lê os bytes de um arquivo enviado no upload (multer) para salvar no banco.
function bufferFromPath(filePath) {
  if (!filePath) return { buf: null, name: null };
  try {
    return { buf: fs.readFileSync(filePath), name: path.basename(filePath) };
  } catch (e) {
    return { buf: null, name: null };
  }
}

// Remove os temporários do multer depois de guardá-los no banco.
function cleanupTempFiles(...paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) { /* ignora */ }
  }
}

// ===== Plugins =====
async function getPlugins() {
  if (useDb) {
    return ((await db.getPlugins()) || []).map(materializePlugin);
  }
  return readJSON(PLUGINS_FILE, []);
}

async function getPublicPlugins() {
  return (await getPlugins()).filter(p => p.active !== false);
}

async function getPluginById(id) {
  if (useDb) {
    return materializePlugin(await db.getPluginById(id));
  }
  return (await getPlugins()).find(p => p.id === id);
}

async function addPlugin(data) {
  // data.extraFiles = lista de caminhos de arquivos extras (upload multer)
  const readExtras = () => (data.extraFiles || []).map(p => bufferFromPath(p)).filter(e => e.buf);

  if (useDb) {
    const sma = bufferFromPath(data.sourceFile);
    const amxx = bufferFromPath(data.amxxFile);
    const record = {
      id: uuidv4(),
      name: data.name,
      description: data.description || '',
      price: Number(data.price) || 0,
      active: data.active !== false,
      customTag: data.customTag !== false,
      smaData: sma.buf,
      amxxData: amxx.buf,
      smaName: sma.name,
      amxxName: amxx.name,
      extraFiles: readExtras(),
      createdAt: new Date().toISOString()
    };
    const saved = await db.addPlugin(record);
    cleanupTempFiles(data.sourceFile, data.amxxFile, ...(data.extraFiles || []));
    return materializePlugin(saved);
  }

  const plugins = readJSON(PLUGINS_FILE, []);
  const plugin = {
    id: uuidv4(),
    name: data.name,
    description: data.description || '',
    price: Number(data.price),
    active: data.active !== false,
    customTag: data.customTag !== false,
    sourceFile: data.sourceFile || null,
    amxxFile: data.amxxFile || null,
    extraFiles: (data.extraFiles || []).slice(),
    createdAt: new Date().toISOString()
  };
  plugins.push(plugin);
  writeJSON(PLUGINS_FILE, plugins);
  return plugin;
}

async function updatePlugin(id, data) {
  if (useDb) {
    const upd = {};
    if (data.name !== undefined) upd.name = data.name;
    if (data.description !== undefined) upd.description = data.description;
    if (data.price !== undefined) upd.price = Number(data.price) || 0;
    if (data.active !== undefined) upd.active = !!data.active;
    if (data.customTag !== undefined) upd.customTag = !!data.customTag;
    if (data.sourceFile) {
      const sma = bufferFromPath(data.sourceFile);
      upd.smaData = sma.buf;
      upd.smaName = sma.name;
    }
    if (data.amxxFile) {
      const amxx = bufferFromPath(data.amxxFile);
      upd.amxxData = amxx.buf;
      upd.amxxName = amxx.name;
    }
    if (data.extraFiles) {
      upd.extraFiles = data.extraFiles.map(p => bufferFromPath(p)).filter(e => e.buf);
    }
    const saved = await db.updatePlugin(id, upd);
    cleanupTempFiles(data.sourceFile, data.amxxFile, ...(data.extraFiles || []));
    return materializePlugin(saved);
  }

  const plugins = readJSON(PLUGINS_FILE, []);
  const idx = plugins.findIndex(p => p.id === id);
  if (idx === -1) return null;
  plugins[idx] = { ...plugins[idx], ...data, id };
  writeJSON(PLUGINS_FILE, plugins);
  return plugins[idx];
}

async function deletePlugin(id) {
  if (useDb) {
    await db.deletePlugin(id);
    removeFile(path.join(SOURCES_DIR, `${id}.sma`));
    removeFile(path.join(SOURCES_DIR, `${id}.amxx`));
    // Remove os arquivos extras materializados (<id>_extra_*.<ext>)
    const prefix = path.join(SOURCES_DIR, `${id}_extra_`);
    try {
      for (const f of fs.readdirSync(SOURCES_DIR)) {
        if (f.startsWith(path.basename(prefix))) removeFile(path.join(SOURCES_DIR, f));
      }
    } catch (e) { /* ignora */ }
    return;
  }
  const plugins = readJSON(PLUGINS_FILE, []);
  writeJSON(PLUGINS_FILE, plugins.filter(p => p.id !== id));
}

// ===== Pedidos =====
async function getOrders() {
  if (useDb) return (await db.getOrders()) || [];
  return readJSON(ORDERS_FILE, []);
}

async function getOrderById(id) {
  if (useDb) return await db.getOrderById(id);
  return (await getOrders()).find(o => o.id === id);
}

async function getOrderByPreferenceId(prefId) {
  if (useDb) return await db.getOrderByPreferenceId(prefId);
  return (await getOrders()).find(o => o.preferenceId === prefId);
}

async function getOrderByPaymentId(paymentId) {
  if (useDb) return await db.getOrderByPaymentId(paymentId);
  return (await getOrders()).find(o => o.paymentId === String(paymentId));
}

async function createOrder({ plugin, buyer, customTag, price, preferenceId }) {
  if (useDb) {
    return await db.createOrder({
      id: uuidv4(),
      pluginId: plugin.id,
      pluginName: plugin.name,
      buyerName: (buyer && buyer.name) || '',
      buyerEmail: (buyer && buyer.email) || undefined,
      customTag: customTag || '',
      price,
      preferenceId,
      createdAt: new Date().toISOString()
    });
  }

  const order = {
    id: uuidv4(),
    pluginId: plugin.id,
    pluginName: plugin.name,
    buyerName: buyer.name || '',
    buyerEmail: buyer.email,
    customTag: customTag || '',
    price,
    preferenceId,
    paymentId: null,
    status: 'pending',
    paymentStatus: 'pending',
    downloadUrl: null,
    createdAt: new Date().toISOString()
  };
  const orders = readJSON(ORDERS_FILE, []);
  orders.push(order);
  writeJSON(ORDERS_FILE, orders);
  return order;
}

async function updateOrder(id, data) {
  if (useDb) return await db.updateOrder(id, data);
  const orders = readJSON(ORDERS_FILE, []);
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  // No modo JSON os arquivos ficam no disco; não guarda os bytes aqui.
  const { deliveryData, deliveryName, adminSmaData, adminSmaName, ...rest } = data;
  orders[idx] = { ...orders[idx], ...rest, id };
  writeJSON(ORDERS_FILE, orders);
  return orders[idx];
}

// ===== Sugestões =====
async function getSuggestions() {
  if (useDb) {
    await db.purgeExpiredSuggestions();
    return (await db.getSuggestions()) || [];
  }
  purgeExpiredSuggestions();
  return readJSON(SUGGESTIONS_FILE, []);
}

async function addSuggestion({ text, author }) {
  if (useDb) {
    return await db.addSuggestion({
      id: uuidv4(),
      text: String(text || '').trim().slice(0, 2000),
      author: String(author || 'Anônimo').trim().slice(0, 60),
      createdAt: new Date().toISOString()
    });
  }

  const list = readJSON(SUGGESTIONS_FILE, []);
  const s = {
    id: uuidv4(),
    text: String(text || '').trim().slice(0, 2000),
    author: String(author || 'Anônimo').trim().slice(0, 60),
    read: false,
    createdAt: new Date().toISOString()
  };
  list.push(s);
  writeJSON(SUGGESTIONS_FILE, list);
  return s;
}

async function markSuggestionRead(id) {
  if (useDb) return await db.markSuggestionRead(id);
  const list = readJSON(SUGGESTIONS_FILE, []);
  const s = list.find(x => x.id === id);
  if (s) {
    s.read = true;
    s.readAt = new Date().toISOString();
    writeJSON(SUGGESTIONS_FILE, list);
  }
  return s;
}

async function deleteSuggestion(id) {
  if (useDb) return await db.deleteSuggestion(id);
  writeJSON(SUGGESTIONS_FILE, readJSON(SUGGESTIONS_FILE, []).filter(x => x.id !== id));
}

// Remove sugestões NÃO LIDAS com mais de 24h (expiração automática).
async function purgeExpiredSuggestions() {
  if (useDb) return await db.purgeExpiredSuggestions();
  const list = readJSON(SUGGESTIONS_FILE, []);
  const now = Date.now();
  const kept = list.filter(s => {
    if (s.read) return true; // lida = fica
    return now - new Date(s.createdAt).getTime() < SUGGESTION_TTL;
  });
  if (kept.length !== list.length) {
    writeJSON(SUGGESTIONS_FILE, kept);
    return true;
  }
  return false;
}

module.exports = {
  initData,
  getPlugins, getPublicPlugins, getPluginById,
  addPlugin, updatePlugin, deletePlugin,
  getOrders, getOrderById,
  getOrderByPreferenceId, getOrderByPaymentId,
  createOrder, updateOrder,
  getSuggestions, addSuggestion, markSuggestionRead, deleteSuggestion, purgeExpiredSuggestions,
  DATA_DIR
};