const { MercadoPagoConfig } = require('mercadopago');
const { Preference } = require('mercadopago');
const { Payment } = require('mercadopago');

let client = null;
let configured = false;

function initMercadoPago() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (token) {
    client = new MercadoPagoConfig({ accessToken: token });
    configured = true;
    console.log('[MP] Mercado Pago configurado (token presente).');
  } else {
    console.warn('[MP] MP_ACCESS_TOKEN não definido no .env. Checkout pagamento desativado.');
  }
}

/**
 * Cria uma preference de pagamento no Mercado Pago.
 * Retorna { init_point, id } para o front-end.
 */
async function createPreference({ order, plugin, customTag }) {
  if (!configured || !client) {
    throw new Error('Mercado Pago não configurado. Defina MP_ACCESS_TOKEN no .env');
  }

  const itemId = `${plugin.id}|${customTag || ''}|${order.id}`;
  const preferenceBody = {
    items: [{
      id: itemId,
      title: plugin.name + (customTag ? ` (tag: ${customTag})` : ''),
      quantity: 1,
      currency_id: 'BRL',
      unit_price: plugin.price
    }],
    payer: {},
    back_urls: {
      success: `${process.env.APP_URL}/checkout/obrigado?order_id=${order.id}`,
      pending: `${process.env.APP_URL}/checkout/pendente?order_id=${order.id}`,
      failure: `${process.env.APP_URL}/checkout/falhou?order_id=${order.id}`
    },
    auto_return: 'approved',
    external_reference: order.id,
    notification_url: `${process.env.APP_URL}/api/webhook/mp`
  };

  const preference = new Preference(client);
  const res = await preference.create({ body: preferenceBody });
  return { init_point: res.init_point, id: res.id };
}

/**
 * Consulta um pagamento pelo ID no Mercado Pago.
 */
async function getPaymentStatus(paymentId) {
  if (!configured || !client) return null;
  try {
    const payment = new Payment(client);
    const res = await payment.get({ id: paymentId });
    return res;
  } catch (e) {
    console.error('[MP] Erro ao consultar pagamento:', e.message);
    return null;
  }
}

function isConfigured() {
  return configured;
}

module.exports = { initMercadoPago, createPreference, getPaymentStatus, isConfigured };