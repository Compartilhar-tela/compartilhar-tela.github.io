// Cloudflare Worker "musica": converte um link de MÚSICA do Spotify na versão completa do YouTube.
// Entrada:  GET /?u=https://open.spotify.com/track/XXXXXXXXXXXXXXXXXXXXXX
// Saída:    { id, ids:[...], title, artist, img }
//
// Configuração (opcional, em Settings > Variables do Worker):
//   YT_KEY          chave da YouTube Data API v3 (deixa a busca mais estável). Sem ela, o Worker usa a busca do site.
//   ALLOWED_ORIGIN  endereço do seu site, ex.: https://telinhaa.pages.dev  (padrão: qualquer origem)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BAD = /\b(live|ao vivo|cover|karaoke|karaokê|remix|reaction|rea[cç][aã]o|lyrics?|letra|slowed|sped up|nightcore|8d|tutorial|instrumental)\b/i;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowed === "*" ? "*" : (origin === allowed ? origin : allowed),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const u = new URL(request.url).searchParams.get("u") || "";
    const m = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})$/.exec(u);
    if (!m) return json({ error: "link" }, 400, cors);

    try {
      const info = await spotifyInfo(m[1]);
      if (!info || !info.title) return json({ error: "spotify" }, 404, cors);

      const q = (info.artist ? info.artist + " " : "") + info.title + " audio";
      const ids = env.YT_KEY ? await searchApi(q, env.YT_KEY, info.title) : await searchPage(q, info.title);
      if (!ids.length) return json({ error: "youtube" }, 404, cors);

      return json({ id: ids[0], ids: ids.slice(0, 4), title: info.title, artist: info.artist, img: info.img }, 200, {
        ...cors,
        "Cache-Control": "public, max-age=86400",
      });
    } catch (e) {
      return json({ error: "falha" }, 502, cors);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .trim();
}

function meta(html, prop) {
  const a = new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]*)"', "i").exec(html);
  if (a) return decode(a[1]);
  const b = new RegExp('<meta[^>]+content="([^"]*)"[^>]+property="' + prop + '"', "i").exec(html);
  return b ? decode(b[1]) : "";
}

async function spotifyInfo(id) {
  const r = await fetch("https://open.spotify.com/track/" + id, {
    headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
  });
  const html = await r.text();
  let title = meta(html, "og:title");
  const desc = meta(html, "og:description");
  const img = meta(html, "og:image");
  // og:description costuma vir como "Artista · Música · 2021" (ou "Artista · Song · 2021")
  let artist = desc ? desc.split(" · ")[0] : "";
  if (!title) {
    const o = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + id));
    if (o.ok) { const j = await o.json(); title = j.title || ""; }
  }
  if (artist && artist.toLowerCase() === title.toLowerCase()) artist = "";
  return { title, artist, img: /^https:\/\/i\.scdn\.co\//.test(img) ? img : "" };
}

function rank(items, songTitle) {
  const songBad = BAD.test(songTitle);
  const top = [], good = [], rest = [];
  for (const it of items) {
    const bad = !songBad && BAD.test(it.title);
    const topic = /- topic$/i.test(it.channel || "") || /official audio|\baudio\b/i.test(it.title);
    if (bad) rest.push(it); else if (topic) top.push(it); else good.push(it);
  }
  const seen = new Set(), out = [];
  for (const it of [...top, ...good, ...rest]) { if (!seen.has(it.id)) { seen.add(it.id); out.push(it.id); } }
  return out;
}

async function searchApi(q, key, songTitle) {
  const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=8&q=" +
    encodeURIComponent(q) + "&key=" + encodeURIComponent(key);
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  const items = (j.items || []).map((x) => ({ id: x.id && x.id.videoId, title: decode(x.snippet && x.snippet.title), channel: decode(x.snippet && x.snippet.channelTitle) }))
    .filter((x) => /^[\w-]{11}$/.test(x.id || ""));
  return rank(items, songTitle);
}

function collect(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.videoRenderer && node.videoRenderer.videoId) {
    const v = node.videoRenderer;
    const runs = (v.title && v.title.runs) || [];
    const ch = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text) || "";
    const len = (v.lengthText && v.lengthText.simpleText) || "";
    out.push({ id: v.videoId, title: runs.map((r) => r.text).join(""), channel: ch, len });
  }
  for (const k in node) collect(node[k], out);
}

async function searchPage(q, songTitle) {
  const r = await fetch("https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&sp=EgIQAQ%253D%253D", {
    headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8", "Cookie": "CONSENT=YES+1; SOCS=CAI" },
  });
  const html = await r.text();
  const m = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { return []; }
  const items = [];
  collect(data, items);
  // músicas normais têm entre 1 e 10 minutos; ignora vídeos longos (álbuns inteiros, mixes)
  const ok = items.filter((x) => {
    const p = (x.len || "").split(":").map(Number);
    if (p.length === 2 && p.every((n) => !isNaN(n))) return p[0] <= 10;
    return false;
  });
  return rank(ok.length ? ok : items, songTitle);
}
