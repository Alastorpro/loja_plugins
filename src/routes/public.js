const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getPublicPlugins, getOrderById, DATA_DIR } = require('../data/store');

// Página inicial - lista de plugins
router.get('/', (req, res) => {
  const plugins = getPublicPlugins();
  res.render('index', { plugins });
});

// Página do produto/checkout (formulário: email + tag)
router.get('/plugin/:id', (req, res) => {
  const store = require('../data/store');
  const plugin = store.getPublicPlugins().find(p => p.id === req.params.id);
  if (!plugin) return res.status(404).render('404');
  res.render('plugin', { plugin });
});

// Download do arquivo entregue
router.get('/download/:orderId/:file', (req, res) => {
  const order = getOrderById(req.params.orderId);
  const file = req.params.file;

  if (!order || !order.downloadUrl || order.downloadUrl !== `/download/${order.id}/${file}`) {
    return res.status(404).render('404');
  }

  const fullPath = path.join(DATA_DIR, 'deliver', order.id, file);
  if (!fs.existsSync(fullPath)) return res.status(404).render('404');

  res.download(fullPath, file);
});

// Página "obrigado" após pagamento
router.get('/checkout/obrigado', (req, res) => {
  const order = getOrderById(req.query.order_id) || (req.query.preference_id ? undefined : null);
  res.render('obrigado', {
    order: order || null,
    collection_id: req.query.collection_id || req.query.payment_id || undefined
  });
});

// Página "pendente"
router.get('/checkout/pendente', (req, res) => {
  res.render('pendente');
});

// Página "falhou"
router.get('/checkout/falhou', (req, res) => {
  res.render('falhou');
});

// Página "rastreando pedido" pelo ID
router.get('/pedido/:id', (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) return res.status(404).render('404');
  res.render('pedido', { order });
});

// ===== Sugestões =====
router.get('/sugestao', (req, res) => {
  res.render('sugestao', { success: null, error: null });
});

router.post('/sugestao', (req, res) => {
  const { texto, nome } = req.body;
  if (!texto || !String(texto).trim()) {
    return res.render('sugestao', {
      success: null,
      error: 'Escreva sua sugestão primeiro.'
    });
  }
  const { addSuggestion } = require('../data/store');
  const s = addSuggestion({ text: texto, author: nome });
  const { notifySuggestion } = require('../services/discord');
  notifySuggestion(s);
  res.render('sugestao', {
    success: 'Sugestão enviada! Obrigado por ajudar a melhorar a loja.',
    error: null
  });
});

module.exports = router;