const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SUGGESTION_WEBHOOK_URL = process.env.SUGGESTION_WEBHOOK_URL;

/**
 * Envia uma mensagem para um canal do Discord via webhook.
 * Desativado se o webhook não estiver definido.
 *
 * Use https://discord.com/api/webhooks/ID/TOKEN
 */
async function sendDiscord(payload, webhookUrl = WEBHOOK_URL) {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error('[Discord] Falha ao enviar webhook:', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[Discord] Erro ao enviar webhook:', e.message);
    return false;
  }
}

function embedColor(status) {
  return status === 'approved' ? 0xe81123 : status === 'pago' ? 0x2ecc71 : 0xf39c12;
}

/** Notifica pagamento aprovado / pedido entregue */
async function notifyOrder(order, extra = {}) {
  const fields = [];
  if (order.customTag) fields.push({ name: 'Tag', value: order.customTag, inline: true });
  fields.push({ name: 'Valor', value: `R$ ${Number(order.price).toFixed(2)}`, inline: true });
  if (order.buyerEmail) fields.push({ name: 'E-mail', value: order.buyerEmail, inline: true });

  const title = extra.status === 'needs_compile'
    ? '⚠️ Pagamento aprovado — precisa compilar manualmente'
    : '✅ Pagamento aprovado — plugin entregue';

  const url = (process.env.APP_URL || '') + '/admin/orders/' + order.id;

  await sendDiscord({
    embeds: [{
      title,
      color: 0x2ecc71,
      description: `**${order.pluginName}** \`#${order.id.slice(0, 8)}\``,
      fields,
      footer: { text: '[DEV] Alastor — Vendas e criador de plugin' },
      timestamp: new Date().toISOString()
    }],
    content: extra.mention ? '<@&' + extra.mention + '>' : undefined
  });
}

/** Notifica nova sugestão — usa o webhook SEPARADO de sugestões
 *  (SUGGESTION_WEBHOOK_URL). Sem ele, cai no webhook geral de vendas. */
async function notifySuggestion(s) {
  const webhook = SUGGESTION_WEBHOOK_URL || WEBHOOK_URL;
  const sent = await sendDiscord({
    embeds: [{
      title: '💡 Nova sugestão',
      color: embedColor('pending'),
      description: `> ${s.text}`,
      fields: [{ name: 'Autor', value: s.author || 'Anônimo', inline: true }],
      timestamp: new Date().toISOString()
    }]
  });
  if (!sent) console.error('[Discord] Sem webhook configurado: sugestão não pôde ser notificada.');
  return sent;
}

/** Notifica novo pedido iniciado (checkout) */
async function notifyCheckout(order) {
  await sendDiscord({
    embeds: [{
      title: '🛒 Novo pedido iniciado',
      color: embedColor('pending'),
      description: `**${order.pluginName}** \`#${order.id.slice(0, 8)}\``,
      fields: [
        { name: 'E-mail', value: order.buyerEmail || '-', inline: true },
        { name: 'Tag', value: order.customTag || '-', inline: true },
        { name: 'Valor', value: `R$ ${Number(order.price).toFixed(2)}`, inline: true }
      ],
      footer: { text: '[DEV] Alastor — Vendas e criador de plugin' },
      timestamp: new Date().toISOString()
    }]
  });
}

module.exports = { sendDiscord, notifyOrder, notifySuggestion, notifyCheckout };