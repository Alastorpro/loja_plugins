const express = require('express');
const router = express.Router();
const { getPaymentStatus } = require('../services/mercadopago');
const { processApprovedPayment } = require('../services/delivery');

// Webhook do Mercado Pago
// Config do painel MP: Notification URL = https://SEUAPP/api/webhook/mp?sou=teste
router.post('/webhook/mp', async (req, res) => {
  const { type, id: paymentId, topic, data } = req.body;

  // Formato webhook: { type: 'payment', id: 12345 } (topico via query)
  let pid = req.query.id || req.query.data_id;
  if (data && data.id) pid = data.id;
  if (type === 'payment' && req.body.id) pid = req.body.id;
  if (topic === 'payment' && pid) {
    req.body.type = 'payment';
  }

  if (req.body.type !== 'payment' && req.query.type !== 'payment') {
    return res.sendStatus(200); // ignora outros eventos (merchant_order etc)
  }

  const finalPaymentId = paymentId || req.body.id || data?.id;
  if (!finalPaymentId) return res.sendStatus(400);

  try {
    // Consulta o status real do pagamento na API
    const payment = await getPaymentStatus(finalPaymentId);
    if (!payment) return res.sendStatus(424); // falha ao consultar, MP reenviará

    if (payment.status === 'approved') {
      await processApprovedPayment(payment);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
    res.sendStatus(500);
  }
});

// GET ping (para testes)
router.get('/ping', (req, res) => res.json({ ok: true, time: Date.now() }));

module.exports = router;