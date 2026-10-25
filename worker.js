// Cloudflare Worker: entrega credenciais TURN temporárias para o site Telaja/Compartilha.
// Variáveis necessárias (Settings > Variables and Secrets):
//   TURN_KEY_ID     (texto)   -> "Key ID" da sua TURN key
//   TURN_API_TOKEN  (secret)  -> "API Token" da sua TURN key
//   ALLOWED_ORIGIN  (texto, opcional) -> padrão: https://compartilhar-tela.github.io

// Cloudflare Worker: credenciais TURN e pré-visualização dinâmica com código da sala
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = env.ALLOWED_ORIGIN || "https://compartilhar-tela.github.io";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // 1. Se alguém aceder com ?code=ABC (gerado para o Discord/WhatsApp lerem)
    if (url.searchParams.has("code")) {
      const code = url.searchParams.get("code").toUpperCase();
      const html = `<!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Compartilhe sua tela - Sala ${code}</title>
        <meta property="og:title" content="Compartilhe sua tela - Sala ${code}">
        <meta property="og:description" content="Clique para entrar na sala ${code} e assistir à transmissão ao vivo sem instalar nada.">
        <meta property="og:image" content="https://compartilhar-tela.github.io/preview.png">
        <meta property="og:image:type" content="image/png">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:image" content="https://compartilhar-tela.github.io/preview.png">
        <meta http-equiv="refresh" content="0;url=https://compartilhar-tela.github.io/#${code}">
      </head>
      <body>Redirecionando para a sala ${code}...</body>
      </html>`;
      return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", ...cors } });
    }

    // 2. Fornecer credenciais ICE/TURN para o WebRTC
    if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
      return new Response(JSON.stringify({ error: "Worker sem credenciais" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );
    if (!r.ok) return new Response(JSON.stringify({ error: "Erro na Cloudflare" }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });

    const data = await r.json();
    return new Response(JSON.stringify({ iceServers: Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers] }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  },
};
