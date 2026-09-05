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
}).fields([{ name: 'sma', maxCount: 1 }, { name: 'amxx', maxCount: 1 }, { name: 'extras', maxCount: 10 }]);

function requireAuth(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// Renomeia os temporários do multer (que são salvos com UUID) para o nome ORIGINAL
// do upload. Assim o arquivo entregue ao cliente mantém o nome certo
// (ex.: mutar_microfone.amxx em vez de d192c539-...-amxx).
function keepOriginalNames(files) {
  const renameds = [];
  for (const f of (files || [])) {
    const baseRaw = (f.originalname || f.filename || 'arquivo')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const base = baseRaw || 'arquivo';
    const dir = path.dirname(f.path);
    let final = path.join(dir, base);
    let n = 1;
    const ext = path.extname(base);
    while (fs.existsSync(final) && final !== f.path) {
      final = path.join(dir, `${path.basename(base, ext)}_${n}${ext}`);
      n++;
    }
    try {
      fs.renameSync(f.path, final);
      renameds.push(final);
    } catch (e) {
      renameds.push(f.path);
    }
  }
  return renameds;
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
router.get('/', requireAuth, async (req, res) => {
  res.render('admin', await adminData());
});

// ===== Helper com os dados do painel =====
async function adminData(extra) {
  return Object.assign({
    plugins: await store.getPlugins(),
    orders: (await store.getOrders()).slice().reverse(),
    suggestions: await store.getSuggestions().then(list => list.slice().reverse()),
    archivedOrders: (await store.getArchivedOrders()).slice().reverse(),
    now: Date.now(),
    TTL: 24 * 60 * 60 * 1000
  }, extra || {});
}

// ===== Plugins: criar =====
router.post('/plugins', requireAuth, (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.render('admin', await adminData({ error: err.message }));
    }
    const { name, description, price, customTag } = req.body;
    const usesCustomTag = customTag === 'on';
    if (!name || !price) {
      return res.render('admin', await adminData({ error: 'Nome e preço são obrigatórios.' }));
    }
    const files = req.files || {};
    const sma = (files['sma'] && keepOriginalNames(files['sma'])[0]) || null;
    const amxx = (files['amxx'] && keepOriginalNames(files['amxx'])[0]) || null;
    const extrasPaths = keepOriginalNames(files['extras'] || []);
    try {
      await store.addPlugin({
        name,
        description,
        price,
        customTag: usesCustomTag,
        downloadName: (req.body.downloadName || '').trim(),
        sourceFile: sma,
        amxxFile: amxx,
        extraFiles: extrasPaths
      });
    } catch (e) {
      console.error('[Admin] Falha ao salvar plugin:', e.message);
      return res.render('admin', await adminData({ error: 'Falha ao salvar o plugin: ' + e.message }));
    }
    res.redirect('/admin#plugins');
  });
});

// ===== Plugins: editar (nome/preço/descrição) =====
router.post('/plugins/:id/edit', requireAuth, async (req, res) => {
  const p = await store.getPluginById(req.params.id);
  if (!p) return res.redirect('/admin#plugins');
  const { name, description, price } = req.body;
  await store.updatePlugin(p.id, {
    name: name || p.name,
    description: description !== undefined ? description : p.description,
    price: price !== '' ? Number(price) : p.price
  });
  res.redirect('/admin#plugins');
});

// ===== Plugins: ativar/desativar =====
router.post('/plugins/:id/toggle', requireAuth, async (req, res) => {
  const p = await store.getPluginById(req.params.id);
  if (p) await store.updatePlugin(p.id, { active: !p.active });
  res.redirect('/admin#plugins');
});

// ===== Plugins: excluir =====
router.post('/plugins/:id/delete', requireAuth, async (req, res) => {
  const p = await store.getPluginById(req.params.id);
  if (p) {
    for (const f of [p.sourceFile, p.amxxFile]) {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    }
  }
  await store.deletePlugin(req.params.id);
  res.redirect('/admin#plugins');
});

// ===== Pedidos: aprovar manualmente =====
router.post('/orders/:id/approve', requireAuth, async (req, res) => {
  const order = await store.getOrderById(req.params.id);
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
  uploadAmxx(req, res, async (err) => {
    const order = await store.getOrderById(req.params.id);
    if (err || !order) {
      console.error('[Admin] Upload .amxx falhou:', err && err.message);
      return res.redirect('/admin#orders');
    }
    if (req.file) {
      const fileName = path.basename(req.file.path);
      await updateOrDeliver(order, `/download/${order.id}/${fileName}`, req.file.path);
      console.log(`[Admin] .amxx enviado manualmente para o pedido ${order.id}`);
    }
    res.redirect('/admin#orders');
  });
});

async function updateOrDeliver(order, downloadUrl, uploadedPath) {
  let deliveryData = null;
  let deliveryName = null;
  try {
    deliveryData = fs.readFileSync(uploadedPath);
    deliveryName = path.basename(uploadedPath);
  } catch (e) { /* ignora */ }
  await store.updateOrder(order.id, {
    status: 'delivered',
    deliveryType: 'amxx',
    downloadUrl,
    deliveryFile: uploadedPath || null,
    deliveryData,
    deliveryName,
    notice: 'Entregue via upload manual do .amxx pelo admin.',
    paymentStatus: order.paymentStatus || 'approved'
  });
}

// ===== Pedidos: visualizar =====
router.get('/orders/:id', requireAuth, async (req, res) => {
  const order = await store.getOrderById(req.params.id);
  if (!order) return res.status(404).render('404');
  res.render('admin_order', { order });
});

// ===== Pedidos: arquivar (some da lista, mas o cliente já pago continua baixando) =====
router.post('/orders/:id/delete', requireAuth, async (req, res) => {
  const order = await store.getOrderById(req.params.id);
  if (order) {
    await store.setOrderArchived(order.id, true)
      .then(() => console.log(`[Admin] Pedido ${order.id} arquivado (cliente preserva o download).`))
      .catch(e => console.error('[Admin] Falha ao arquivar pedido:', e.message));
  }
  res.redirect('/admin#orders');
});

// ===== Pedidos: restaurar (volta pra lista) =====
router.post('/orders/:id/restore', requireAuth, async (req, res) => {
  const order = await store.getOrderById(req.params.id);
  if (order) {
    await store.setOrderArchived(order.id, false)
      .then(() => console.log(`[Admin] Pedido ${order.id} restaurado.`))
      .catch(e => console.error('[Admin] Falha ao restaurar pedido:', e.message));
  }
  res.redirect('/admin#orders');
});

// ===== Pedidos: excluir DEFINITIVAMENTE (só para arquivados) =====
router.post('/orders/:id/purge', requireAuth, async (req, res) => {
  const order = await store.getOrderById(req.params.id);
  if (order) {
    for (const p of [order.deliveryFile, order.adminSmaFile, order.pendingSma]) {
      try { if (p && fs.existsSync(p) && !fs.statSync(p).isDirectory()) fs.unlinkSync(p); } catch (e) {}
    }
    try {
      const dir = path.join(store.DATA_DIR, 'deliver', order.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}
    await store.deleteOrder(order.id)
      .then(() => console.log(`[Admin] Pedido ${order.id} excluído definitivamente.`))
      .catch(e => console.error('[Admin] Falha ao excluir pedido definitivamente:', e.message));
  }
  res.redirect('/admin#orders');
});

// ===== Pedidos: baixar o .sma personalizado (conferir a tag) =====
router.get('/orders/:id/sma', requireAuth, async (req, res) => {
  const order = await store.getOrderById(req.params.id);
  if (!order) return res.status(404).render('404');
  const smaPath = order.adminSmaFile || order.pendingSma;
  if (smaPath && fs.existsSync(smaPath)) {
    const base = (order.pluginName || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_');
    return res.download(smaPath, `${base}_${order.id.slice(0, 8)}.sma`);
  }
  // Fallback: .sma guardado no banco (bytes) — sobrevive a restart/deploy
  if (order.adminSmaData && order.adminSmaData.length) {
    const base = (order.pluginName || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${base}_${order.id.slice(0, 8)}.sma"`);
    return res.send(Buffer.from(order.adminSmaData));
  }
  return res.status(404).render('404');
});

// ===== Sugestões: marcar como lida =====
router.post('/suggestions/:id/read', requireAuth, async (req, res) => {
  await store.markSuggestionRead(req.params.id);
  res.redirect('/admin#sugestoes');
});

// ===== Sugestões: excluir =====
router.post('/suggestions/:id/delete', requireAuth, async (req, res) => {
  await store.deleteSuggestion(req.params.id);
  res.redirect('/admin#sugestoes');
});

module.exports = router;