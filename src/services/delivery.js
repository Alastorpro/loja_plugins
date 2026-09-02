const fs = require('fs');
const path = require('path');
const {
  getPluginById, updateOrder, getOrderById,
  getOrderByPaymentId, DATA_DIR
} = require('../data/store');
const { deliverPlugin } = require('./compiler');
const { notifyOrder } = require('./discord');

const DELIVER_DIR = path.join(DATA_DIR, 'deliver');

/**
 * Entrega um pedido já aprovado:
 *  - gera o .sma personalizado
 *  - compila para .amxx (obrigatório)
 *  - guarda o caminho do download no pedido
 */
async function processApprovedPayment(payment) {
  const paymentId = String(payment.id);

  // Procura o pedido pelo external_reference (id do pedido) informado na preference
  let order = getOrderById(payment.external_reference) || getOrderByPaymentId(paymentId);

  if (!order) {
    console.warn('[Entrega] Pedido não encontrado para o pagamento', paymentId);
    return null;
  }

  // Idempotência: se já entregue, não faz de novo
  if (order.status === 'delivered' || order.status === 'complex') {
    return order;
  }

  const plugin = getPluginById(order.pluginId);
  if (!plugin) {
    updateOrder(order.id, { status: 'error', error: 'plugin-removido', paymentStatus: 'approved' });
    return null;
  }

  try {
    const fileInfo = await deliverPlugin(plugin, order.customTag);

    if (fileInfo.type === 'amxx') {
      // Arquivo entregue fica dentro de um diretório com nome = id do pedido
      const finalDir = path.join(DELIVER_DIR, order.id);
      fs.mkdirSync(finalDir, { recursive: true });
      const finalPath = path.join(finalDir, path.basename(fileInfo.path));
      fs.copyFileSync(fileInfo.path, finalPath);

      // Guarda também o .sma personalizado (só visível no admin, para conferir a tag)
      let adminSmaFile = null;
      let adminSmaUrl = null;
      if (fileInfo.smaPath && fs.existsSync(fileInfo.smaPath)) {
        adminSmaFile = path.join(finalDir, path.basename(fileInfo.smaPath));
        fs.copyFileSync(fileInfo.smaPath, adminSmaFile);
        adminSmaUrl = `/admin/orders/${order.id}/sma`;
      }

      const logged = {
        paymentId,
        status: 'delivered',
        downloadUrl: `/download/${order.id}/${path.basename(finalPath)}`,
        deliveryFile: finalPath,
        deliveryType: 'amxx',
        adminSmaFile,
        adminSmaUrl,
        pendingSma: null,
        compileOutput: fileInfo.output,
        paymentStatus: 'approved'
      };

      updateOrder(order.id, logged);
      console.log(`[Entrega] Pedido ${order.id} entregue (.amxx)`);
      notifyOrder(order, { status: 'delivered' });
      return logged;
    }

    // Não compilou: pedido fica pendente de compilação manual pelo admin
    const pendingSma = fileInfo.smaPath || null;
    updateOrder(order.id, {
      paymentId,
      status: 'needs_compile',
      paymentStatus: 'approved',
      pendingSma,
      compileOutput: fileInfo.output,
      notice: 'Pagamento aprovado, mas o .amxx ainda precisa ser compilado/enviado pelo admin.'
    });
    console.warn(`[Entrega] Pedido ${order.id} precisa de compilação manual (compilador indisponível/falha).`);
    notifyOrder(order, { status: 'needs_compile' });
    return { status: 'needs_compile', pendingSma };
  } catch (err) {
    console.error('[Entrega] Erro ao preparar entrega do pedido', order.id, err);
    updateOrder(order.id, { status: 'error', error: err.message, paymentStatus: 'approved' });
    return null;
  }
}

module.exports = { processApprovedPayment };