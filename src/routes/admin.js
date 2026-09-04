const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const store = require('../data/store');
const { prepareSource } = require('../services/compiler');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ===== Upload de .sma e/ou .amxx pronto =====
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(store.DATA_DIR, 'sources');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, uuidv4() + path.extname(file.originalname));
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'sma' && ext !== '.sma') return cb(new Error('O arquivo .sma deve ter extensão .sma.'));
    if (file.fieldname === 'amxx' && ext !== '.amxx') return cb(new Error('O arquivo .amxx deve ter extensão .amxx.'));
    cb(null, true);
  }
}).fields([{ name: 'sma', maxCount: 1 }, { name: 'amxx', maxCount: 1 }]);

function requireAuth(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ===== Login =====
router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin_login', { error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin_login', { error: 'Senha incorreta.' });
});

router.post('/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/admin/login');
});

// ===== Painel =====
router.get('/', requireAuth, (req, res) => {
  res.render('admin', adminData());
});

// ===== Helper com os dados do painel =====
function adminData(extra) {
  return Object.assign({
    plugins: store.getPlugins(),
    orders: store.getOrders().slice().reverse(),
    suggestions: store.getSuggestions().slice().reverse(),
    now: Date.now(),
    TTL: 24 * 60 * 60 * 1000
  }, extra || {});
}

// ===== Plugins: criar =====
router.post('/plugins', requireAuth, (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      return res.render('admin', adminData({ error: err.message }));
    }
    const { name, description, price, customTag } = req.body;
    const usesCustomTag = customTag === 'on';
    if (!name || !price) {
      return res.render('admin', adminData({ error: 'Nome e preço são obrigatórios.' }));
    }
    const files = req.files || {};
    const sma = files['sma'] && files['sma'][0];
    const amxx = files['amxx'] && files['amxx'][0];
    store.addPlugin({
      name,
      description,
      price,
      customTag: usesCustomTag,
      sourceFile: sma ? sma.path : null,
      amxxFile: amxx ? amxx.path : null
    });
    res.redirect('/admin#plugins');
  });
});

// ===== Plugins: editar (nome/preço/descrição) =====
router.post('/plugins/:id/edit', requireAuth, (req, res) => {
  const p = store.getPluginById(req.params.id);
  if (!p) return res.redirect('/admin#plugins');
  const { name, description, price } = req.body;
  store.updatePlugin(p.id, {
    name: name || p.name,
    description: description !== undefined ? description : p.description,
    price: price !== '' ? Number(price) : p.price
  });
  res.redirect('/admin#plugins');
});

// ===== Plugins: ativar/desativar =====
router.post('/plugins/:id/toggle', requireAuth, (req, res) => {
  const p = store.getPluginById(req.params.id);
  if (p) store.updatePlugin(p.id, { active: !p.active });
  res.redirect('/admin#plugins');
});

// ===== Plugins: excluir =====
router.post('/plugins/:id/delete', requireAuth, (req, res) => {
  const p = store.getPluginById(req.params.id);
  if (p && p.sourceFile && fs.existsSync(p.sourceFile)) {
    try { fs.unlinkSync(p.sourceFile); } catch (e) {}
  }
  store.deletePlugin(req.params.id);
  res.redirect('/admin#plugins');
});

// ===== Pedidos: aprovar manualmente =====
router.post('/orders/:id/approve', requireAuth, async (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.redirect('/admin#orders');
  if (order.status === 'pending') {
    const fakePayment = {
      id: 'manual-' + Date.now(),
      external_reference: order.id,
      status: 'approved'
    };
    const { processApprovedPayment } = require('../services/delivery');
    await processApprovedPayment(fakePayment);
  }
  res.redirect('/admin#orders');
});

// ===== Pedidos: upload do .amxx (compilação manual) =====
const uploadAmxx = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(store.DATA_DIR, 'deliver', req.params.id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
    }
  }),
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.amxx')) {
      return cb(new Error('Apenas arquivos .amxx são permitidos.'));
    }
    cb(null, true);
  }
}).single('amxx');

router.post('/orders/:id/upload', requireAuth, (req, res) => {
  uploadAmxx(req, res, (err) => {
    const order = store.getOrderById(req.params.id);
    if (err || !order) {
      console.error('[Admin] Upload .amxx falhou:', err && err.message);
      return res.redirect('/admin#orders');
    }
    if (req.file) {
      const fileName = path.basename(req.file.path);
      updateOrDeliver(order, `/download/${order.id}/${fileName}`);
      console.log(`[Admin] .amxx enviado manualmente para o pedido ${order.id}`);
    }
    res.redirect('/admin#orders');
  });
});

function updateOrDeliver(order, downloadUrl) {
  store.updateOrder(order.id, {
    status: 'delivered',
    deliveryType: 'amxx',
    downloadUrl,
    deliveryFile: null,
    notice: 'Entregue via upload manual do .amxx pelo admin.',
    paymentStatus: order.paymentStatus || 'approved'
  });
}

// ===== Pedidos: visualizar =====
router.get('/orders/:id', requireAuth, (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).render('404');
  res.render('admin_order', { order });
});

// ===== Pedidos: baixar o .sma personalizado (conferir a tag) =====
router.get('/orders/:id/sma', requireAuth, (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).render('404');
  const smaPath = order.adminSmaFile || order.pendingSma;
  if (!smaPath || !fs.existsSync(smaPath)) return res.status(404).render('404');
  const base = (order.pluginName || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_');
  res.download(smaPath, `${base}_${order.id.slice(0, 8)}.sma`);
});

// ===== Sugestões: marcar como lida =====
router.post('/suggestions/:id/read', requireAuth, (req, res) => {
  store.markSuggestionRead(req.params.id);
  res.redirect('/admin#sugestoes');
});

// ===== Sugestões: excluir =====
router.post('/suggestions/:id/delete', requireAuth, (req, res) => {
  store.deleteSuggestion(req.params.id);
  res.redirect('/admin#sugestoes');
});

module.exports = router;