const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SUGGESTION_WEBHOOK_URL = process.env.SUGGESTION_WEBHOOK_URL;

/**
 * Envia uma mensagem para um canal do Discord via webhook.
 * Desativado se o webhook não estiver definido.
 *
 * Use https://discord.com/api/webhooks/ID/TOKEN
 */
async function sendDiscord(payload, webhookUrl = WEBHOOK_URL, retries = 3) {
  if (!webhookUrl) return false;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36'
  };
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (res.ok) return true;

      const txt = await res.text().catch(() => '');
      if (res.status === 429 || res.status >= 500) {
        // 429/5xx: espera e tenta de novo (rate limit que costuma liberar em segundos)
        let wait = 2000 + (attempt - 1) * 3000;
        try {
          const j = JSON.parse(txt);
          if (j.retry_after) wait = Math.round(j.retry_after * 1000);
        } catch (e) { /* corpo HTML/Cloudflare: usa espera fixa */ }
        wait = Math.min(wait, 10000);
        console.error(`[Discord] tentativa ${attempt}/${retries} falhou (HTTP ${res.status}); retentando em ${Math.round(wait / 1000)}s`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      console.error(`[Discord] Falha ao enviar webhook: ${res.status} ${txt.replace(/\s+/g, ' ').slice(0, 200)}`);
      return false;
    } catch (e) {
      console.error(`[Discord] tentativa ${attempt}/${retries} erro de rede: ${e.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return false;
    }
  }
  return false;
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
  if (!webhook) {
    console.error('[Discord] Nem SUGGESTION_WEBHOOK_URL nem DISCORD_WEBHOOK_URL configurados.');
    return false;
  }
  const sent = await sendDiscord({
    embeds: [{
      title: '💡 Nova sugestão',
      color: embedColor('pending'),
      description: `> ${s.text}`,
      fields: [{ name: 'Autor', value: s.author || 'Anônimo', inline: true }],
      timestamp: new Date().toISOString()
    }]
  }, webhook);
  if (!sent) console.error(`[Discord] Webhook de sugestões falhou (${SUGGESTION_WEBHOOK_URL ? 'separado' : 'geral'}).`);
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