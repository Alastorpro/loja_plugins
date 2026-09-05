const fs = require('fs');
const path = require('path');
const {
  getPluginById, updateOrder, getOrderById,
  getOrderByPaymentId, DATA_DIR
} = require('../data/store');
const { deliverPlugin } = require('./compiler');
const { notifyOrder } = require('./discord');

const DELIVER_DIR = path.join(DATA_DIR, 'deliver');

// Cria um {name, path} a partir de cada entrada de extraFiles do plugin.
function normalizeExtras(plugin) {
  return (plugin.extraFiles || []).map(ef => {
    if (typeof ef === 'string') return { name: path.basename(ef), path: ef };
    return { name: ef.name || path.basename(ef.path || 'arquivo'), path: ef.path };
  }).filter(ef => ef.path && fs.existsSync(ef.path));
}

// Copia os arquivos extras para a pasta do pedido e devolve [{name, data}].
function copyExtras(plugin, finalDir) {
  const items = normalizeExtras(plugin);
  const out = [];
  for (const ef of items) {
    const dest = path.join(finalDir, ef.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
    if (!fs.existsSync(dest)) fs.copyFileSync(ef.path, dest);
    out.push({ name: path.basename(dest), data: fs.readFileSync(dest) });
  }
  return out;
}

/**
 * Entrega um pedido já aprovado:
 *  - gera o .sma personalizado
 *  - compila para .amxx (obrigatório)
 *  - guarda o caminho do download no pedido
 */
async function processApprovedPayment(payment) {
  const paymentId = String(payment.id);

  // Procura o pedido pelo external_reference (id do pedido) informado na preference
  let order = await getOrderById(payment.external_reference) || await getOrderByPaymentId(paymentId);

  if (!order) {
    console.warn('[Entrega] Pedido não encontrado para o pagamento', paymentId);
    return null;
  }

  // Idempotência: se já entregue, não faz de novo
  if (order.status === 'delivered' || order.status === 'complex') {
    return order;
  }

  const plugin = await getPluginById(order.pluginId);
  if (!plugin) {
    await updateOrder(order.id, { status: 'error', error: 'plugin-removido', paymentStatus: 'approved' });
    return null;
  }

  // ===== Plugin pronto (.amxx fixo): entrega direto, SEM edição/tag/compilação =====
  if (plugin.amxxFile && fs.existsSync(plugin.amxxFile)) {
    const finalDir = path.join(DELIVER_DIR, order.id);
    fs.mkdirSync(finalDir, { recursive: true });
    const baseName = ((plugin.downloadName || plugin.name) || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'plugin';
    const finalPath = path.join(finalDir, `${baseName}.amxx`);
    fs.copyFileSync(plugin.amxxFile, finalPath);

    // Guarda os bytes no banco para o download sobreviver a restart/deploy
    const deliveryData = fs.readFileSync(finalPath);
    const deliveryExtras = copyExtras(plugin, finalDir);

    const logged = {
      paymentId,
      status: 'delivered',
      downloadUrl: `/download/${order.id}/${path.basename(finalPath)}`,
      deliveryFile: finalPath,
      deliveryType: 'amxx',
      saved: 'pronto',
      adminSmaFile: null,
      adminSmaUrl: null,
      pendingSma: null,
      compileOutput: null,
      paymentStatus: 'approved',
      deliveryData,
      deliveryName: path.basename(finalPath),
      deliveryExtras
    };

    await updateOrder(order.id, logged);
    console.log(`[Entrega] Pedido ${order.id} entregue (.amxx pronto, sem edição)`);
    notifyOrder(order, { status: 'delivered' });
    return logged;
  }

  try {
    const fileInfo = await deliverPlugin(plugin, order.customTag);

    if (fileInfo.type === 'amxx') {
      // Arquivo entregue fica dentro de um diretório com nome = id do pedido
      const finalDir = path.join(DELIVER_DIR, order.id);
      fs.mkdirSync(finalDir, { recursive: true });
      const finalBase = ((plugin.downloadName || plugin.name) || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'plugin';
      const finalPath = path.join(finalDir, `${finalBase}.amxx`);
      fs.copyFileSync(fileInfo.path, finalPath);
      const deliveryExtras = copyExtras(plugin, finalDir);

      // Guarda também o .sma personalizado (só visível no admin, para conferir a tag)
      let adminSmaFile = null;
      let adminSmaUrl = null;
      let adminSmaData = null;
      let adminSmaName = null;
      if (fileInfo.smaPath && fs.existsSync(fileInfo.smaPath)) {
        adminSmaFile = path.join(finalDir, path.basename(fileInfo.smaPath));
        fs.copyFileSync(fileInfo.smaPath, adminSmaFile);
        adminSmaUrl = `/admin/orders/${order.id}/sma`;
        adminSmaData = fs.readFileSync(adminSmaFile);
        adminSmaName = path.basename(adminSmaFile);
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
        paymentStatus: 'approved',
        deliveryData: fs.readFileSync(finalPath),
        deliveryName: path.basename(finalPath),
        deliveryExtras,
        adminSmaData,
        adminSmaName
      };

      await updateOrder(order.id, logged);
      console.log(`[Entrega] Pedido ${order.id} entregue (.amxx)`);
      notifyOrder(order, { status: 'delivered' });
      return logged;
    }

    // Não compilou: pedido fica pendente de compilação manual pelo admin
    let pendingSma = fileInfo.smaPath || null;
    let pendingSmaData = null;
    let pendingSmaName = null;
    if (pendingSma && fs.existsSync(pendingSma)) {
      pendingSmaData = fs.readFileSync(pendingSma);
      pendingSmaName = path.basename(pendingSma);
    }
    await updateOrder(order.id, {
      paymentId,
      status: 'needs_compile',
      paymentStatus: 'approved',
      pendingSma,
      compileOutput: fileInfo.output,
      adminSmaData: pendingSmaData,
      adminSmaName: pendingSmaName,
      notice: 'Pagamento aprovado, mas o .amxx ainda precisa ser compilado/enviado pelo admin.'
    });
    console.warn(`[Entrega] Pedido ${order.id} precisa de compilação manual (compilador indisponível/falha).`);
    notifyOrder(order, { status: 'needs_compile' });
    return { status: 'needs_compile', pendingSma };
  } catch (err) {
    console.error('[Entrega] Erro ao preparar entrega do pedido', order.id, err);
    await updateOrder(order.id, { status: 'error', error: err.message, paymentStatus: 'approved' });
    return null;
  }
}

module.exports = { processApprovedPayment };