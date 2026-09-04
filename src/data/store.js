const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const PLUGINS_FILE = path.join(DATA_DIR, 'plugins.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'suggestions.json');
const SUGGESTION_TTL = 24 * 60 * 60 * 1000; // 24 horas

function initData() {
  ensureDir();
  if (!fs.existsSync(PLUGINS_FILE)) writeJSON(PLUGINS_FILE, []);
  if (!fs.existsSync(ORDERS_FILE)) writeJSON(ORDERS_FILE, []);
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

// ===== Plugins =====
function getPlugins() {
  return readJSON(PLUGINS_FILE, []);
}

function savePlugins(plugins) {
  writeJSON(PLUGINS_FILE, plugins);
}

function getPublicPlugins() {
  return getPlugins().filter(p => p.active !== false);
}

function getPluginById(id) {
  return getPlugins().find(p => p.id === id);
}

function addPlugin(data) {
  const plugins = getPlugins();
  const plugin = {
    id: uuidv4(),
    name: data.name,
    description: data.description || '',
    price: Number(data.price),
    active: data.active !== false,
    customTag: data.customTag !== false,
    // Caminho do arquivo .sma original (base)
    sourceFile: data.sourceFile || null,
    // Caminho do arquivo .amxx pronto (entrega direta, sem edição/tag)
    amxxFile: data.amxxFile || null,
    createdAt: new Date().toISOString()
  };
  plugins.push(plugin);
  savePlugins(plugins);
  return plugin;
}

function updatePlugin(id, data) {
  const plugins = getPlugins();
  const idx = plugins.findIndex(p => p.id === id);
  if (idx === -1) return null;
  plugins[idx] = { ...plugins[idx], ...data, id };
  savePlugins(plugins);
  return plugins[idx];
}

function deletePlugin(id) {
  savePlugins(getPlugins().filter(p => p.id !== id));
}

// ===== Pedidos =====
function getOrders() {
  return readJSON(ORDERS_FILE, []);
}

function saveOrders(orders) {
  writeJSON(ORDERS_FILE, orders);
}

function getOrderById(id) {
  return getOrders().find(o => o.id === id);
}

function getOrderByPreferenceId(prefId) {
  return getOrders().find(o => o.preferenceId === prefId);
}

function getOrderByPaymentId(paymentId) {
  return getOrders().find(o => o.paymentId === String(paymentId));
}

function createOrder({ plugin, buyer, customTag, price, preferenceId }) {
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
  const orders = getOrders();
  orders.push(order);
  saveOrders(orders);
  return order;
}

function updateOrder(id, data) {
  const orders = getOrders();
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...data, id };
  saveOrders(orders);
  return orders[idx];
}

// ===== Sugestões =====
function getSuggestions() {
  purgeExpiredSuggestions();
  return readJSON(SUGGESTIONS_FILE, []);
}

function saveSuggestions(list) {
  writeJSON(SUGGESTIONS_FILE, list);
}

function addSuggestion({ text, author }) {
  const list = readJSON(SUGGESTIONS_FILE, []);
  const s = {
    id: uuidv4(),
    text: String(text || '').trim().slice(0, 2000),
    author: String(author || 'Anônimo').trim().slice(0, 60),
    read: false,
    createdAt: new Date().toISOString()
  };
  list.push(s);
  saveSuggestions(list);
  return s;
}

function markSuggestionRead(id) {
  const list = readJSON(SUGGESTIONS_FILE, []);
  const s = list.find(x => x.id === id);
  if (s) {
    s.read = true;
    s.readAt = new Date().toISOString();
    saveSuggestions(list);
  }
  return s;
}

function deleteSuggestion(id) {
  saveSuggestions(readJSON(SUGGESTIONS_FILE, []).filter(x => x.id !== id));
}

// Remove sugestões NÃO LIDAS com mais de 24h (expiração automática).
// As lidas ficam guardadas até serem excluídas pelo admin.
function purgeExpiredSuggestions() {
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
  getPlugins, savePlugins, getPublicPlugins, getPluginById,
  addPlugin, updatePlugin, deletePlugin,
  getOrders, saveOrders, getOrderById,
  getOrderByPreferenceId, getOrderByPaymentId,
  createOrder, updateOrder,
  getSuggestions, addSuggestion, markSuggestionRead, deleteSuggestion, purgeExpiredSuggestions,
  DATA_DIR
};
