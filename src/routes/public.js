const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getPublicPlugins, getOrderById, DATA_DIR } = require('../data/store');
const { compileStandalone } = require('../services/compiler');

// ===== Compilador avulso (tipo amx.worldcs.ro) =====
const compilerWork = path.join(DATA_DIR, 'compiler-work');
const DELIVERY_DIR_PUBLIC = path.join(DATA_DIR, 'deliver');
if (!fs.existsSync(compilerWork)) fs.mkdirSync(compilerWork, { recursive: true });

const compilerUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, compilerWork),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, uuidv4() + '_' + safe);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }
}).fields([{ name: 'sma', maxCount: 1 }, { name: 'incs', maxCount: 10 }]);

router.get('/compilador', (req, res) => {
  res.render('compilador', { error: null, success: null, output: null });
});

router.post('/compilador', (req, res) => {
  compilerUpload(req, res, async (err) => {
    if (err) {
      return res.render('compilador', {
        error: 'Erro no upload: ' + (err.message || 'arquivo muito grande'), success: null, output: null
      });
    }
    const smaFile = req.files && req.files['sma'] && req.files['sma'][0];
    if (!smaFile) {
      return res.render('compilador', {
        error: 'Selecione um arquivo .sma primeiro.', success: null, output: null
      });
    }
    const incFiles = (req.files && req.files['incs']) || [];
    try {
      const result = await compileStandalone({
        smaPath: smaFile.path,
        incFiles: incFiles.map(f => f.path)
      });
      if (result.success && result.amxxPath) {
        const fileName = path.basename(result.amxxPath);
        const dl = `/compilador/download/${fileName}`;
        return res.render('compilador', {
          error: null,
          success: 'Plugin compilado com sucesso! Baixe abaixo.',
          output: result.output,
          downloadUrl: dl
        });
      }
      return res.render('compilador', {
        error: 'Não foi possível compilar o plugin.',
        success: null,
        output: result.output || 'Erro desconhecido'
      });
    } catch (e) {
      return res.render('compilador', {
        error: 'Erro ao compilar: ' + (e.message || 'erro interno'), success: null, output: null
      });
    }
  });
});

router.get('/compilador/download/:file', (req, res) => {
  // segurança: impede path traversal
  const safe = path.basename(req.params.file);
  const real = path.join(DELIVERY_DIR_PUBLIC, safe);
  if (!fs.existsSync(real)) return res.status(404).render('404');
  res.download(real, safe);
});

// Página inicial - lista de plugins
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