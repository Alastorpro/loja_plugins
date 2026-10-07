const express = require('express');
const router = express.Router();
const { getPluginById, createOrder } = require('../data/store');
const { createPreference } = require('../services/mercadopago');

// POST /checkout/create - cria o pedido e redireciona pro Mercado Pago
router.post('/create', async (req, res) => {
  const { pluginId, nome, tag } = req.body;
  const wantsJson = req.accepts('json') ? true : false;
  const fail = (msg, code = 400) => wantsJson
    ? res.status(code).json({ error: msg })
    : res.status(code).render('plugin', { plugin, error: msg });

  const plugin = await getPluginById(pluginId);
  if (!plugin || plugin.active === false) {
    return wantsJson ? res.status(404).json({ error: 'Plugin não encontrado.' }) : res.status(404).render('404');
  }

  // Valida o nome/nick
  const nick = String(nome || '').trim();
  if (!nick || nick.length < 3 || nick.length > 60) {
    return fail('Informe seu nome ou nick (3 a 60 caracteres).');
  }

  // Se o plugin permite tag customizada mas a tag está vazia, obriga
  // (exceto plugins .amxx prontos, que não recebem tag)
  if (plugin.customTag !== false && !plugin.amxxFile && !tag) {
    return fail('Informe a tag que deseja usar no plugin.');
  }

  if (tag && tag.length > 16) {
    return fail('A tag deve ter no máximo 16 caracteres.');
  }

  // Idempotência por sessão para evitar pedidos duplicados
  const sessionKey = `order_${pluginId}_${nick}_${tag || ''}`;
  if (req.session[sessionKey]) {
    const url = `/pedido/${req.session[sessionKey]}`;
    return wantsJson ? res.json({ url, orderId: req.session[sessionKey] }) : res.redirect(url);
  }

  try {
    const order = await createOrder({
      plugin,
      buyer: { name: nick },
      customTag: tag || '',
      price: plugin.price,
      preferenceId: null
    });

    // Avisa no Discord sobre o novo pedido iniciado
    const { notifyCheckout } = require('../services/discord');
    notifyCheckout(order);

    // ===== MODO DEMO: simula pagamento aprovado (teste local sem Mercado Pago) =====
    if (process.env.DEMO_MODE === 'on' || process.env.NODE_ENV === 'development' && !process.env.MP_ACCESS_TOKEN) {
      console.log('[DEMO] Pagamento simulado aprovado para o pedido', order.id);
      const { processApprovedPayment } = require('../services/delivery');
      await processApprovedPayment({
        id: 'demo-' + Date.now(),
        external_reference: order.id,
        status: 'approved'
      });
      req.session[sessionKey] = order.id;
      const url = `/pedido/${order.id}`;
      return wantsJson ? res.json({ url, orderId: order.id, demo: true }) : res.redirect(url);
    }

    // Cria a preference no Mercado Pago
    const pref = await createPreference({
      order, plugin,
      customTag: tag || ''
    });

    // Atualiza o pedido com o id da preference
    const { updateOrder } = require('../data/store');
    await updateOrder(order.id, { preferenceId: pref.id });

    // Sessão para idempotência
    req.session[sessionKey] = order.id;

    if (wantsJson) {
      return res.json({ url: pref.init_point, orderId: order.id, demo: false });
    }
    res.redirect(pref.init_point);
  } catch (err) {
    console.error('[Checkout] Erro ao criar pagamento:', err.message);
    if (wantsJson) return res.status(500).json({ error: 'Erro ao criar o pagamento. Tente novamente.' });
    res.render('plugin', { plugin, error: 'Erro ao criar o pagamento. Tente novamente.' });
  }
});

module.exports = router;