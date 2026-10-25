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
        <meta property="og:image" content="https://patient-math-9da9.brunosamuel1524.workers.dev/preview.png?code=${code}">
        <meta property="og:image:type" content="image/svg+xml">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:image" content="https://patient-math-9da9.brunosamuel1524.workers.dev/preview.png?code=${code}">
        <meta http-equiv="refresh" content="0;url=https://compartilhar-tela.github.io/#${code}">
      </head>
      <body>Redirecionando para a sala ${code}...</body>
      </html>`;
      return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", ...cors } });
    }

    // 2. Geração da imagem dinâmica com o código da sala
    if (url.pathname.endsWith("/preview.png")) {
      const roomCode = (url.searchParams.get("code") || "LIVE").toUpperCase();
      const svgImage = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0b0d1f"/>
            <stop offset="100%" stop-color="#1a1f3d"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="630" fill="url(#bg)" rx="24"/>
        <rect x="30" y="30" width="1140" height="570" rx="16" fill="none" stroke="#272c52" stroke-width="4"/>
        <text x="90" y="210" font-family="system-ui, sans-serif" font-weight="800" font-size="72px" fill="#ffffff">Compartilhe</text>
        <text x="90" y="295" font-family="system-ui, sans-serif" font-weight="800" font-size="72px" fill="#8a7dff">sua tela</text>
        <text x="90" y="390" font-family="system-ui, sans-serif" font-weight="400" font-size="28px" fill="#9aa0c7">Mostre sua tela ao vivo, sem cadastro e sem instalar nada.</text>
        <g transform="translate(720, 180)">
          <rect width="360" height="270" rx="20" fill="#12162b" stroke="#8a7dff" stroke-width="3"/>
          <text x="40" y="65" font-family="system-ui, sans-serif" font-weight="700" font-size="20px" fill="#9aa0c7" letter-spacing="2">CÓDIGO DA SALA</text>
          <text x="40" y="175" font-family="system-ui, sans-serif" font-weight="800" font-size="75px" fill="#ffffff" letter-spacing="8">${roomCode}</text>
          <circle cx="310" cy="55" r="8" fill="#2ecc8f"/>
          <text x="230" y="62" font-family="system-ui, sans-serif" font-weight="700" font-size="16px" fill="#2ecc8f">AO VIVO</text>
        </g>
      </svg>`;

      return new Response(svgImage, {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=60", ...cors }
      });
    }

    // 3. Fornecer credenciais ICE/TURN para o WebRTC
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
