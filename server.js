// Córtex — servidor local. Rode com:  node server.js   e abra http://localhost:3333
const http = require("http");
const fs = require("fs");
const path = require("path");

require("./lib/env"); // antes de tudo: CORTEX_DIR e PORT vêm do .env

const store = require("./lib/store");
const claude = require("./lib/claude");
const backup = require("./lib/backup");
const PORT = Number(process.env.PORT) || 3333;
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

store.reindex();

// Avisa a página quando os arquivos mudam (inclusive quando o Claude edita via MCP ou Claude Code)
const clients = new Set();
let watchTimer = null;
fs.watch(store.DIR, () => {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => clients.forEach(res => res.write("data: changed\n\n")), 150);
  backup.schedule();
});
backup.init().then(() => backup.schedule()); // salva o que mudou com o servidor desligado
["SIGINT", "SIGTERM"].forEach(sig => process.on(sig, () => { backup.flushSync(); process.exit(0); }));

const send = (res, code, data) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
const body = req => new Promise((ok, fail) => {
  let s = "";
  req.on("data", c => { s += c; if (s.length > 2e6) { fail(new Error("corpo grande demais")); req.destroy(); } });
  req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
});

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const [, resource, id] = parts;
  const m = req.method;
  const routes = {
    "GET status": () => send(res, 200, { apiKey: claude.hasKey(), model: claude.model(), dir: store.ROOT, count: store.all().length, backup: backup.state }),
    "GET nodes": () => send(res, 200, id ? (store.get(id) || {}) : store.all()),
    "POST nodes": async () => send(res, 201, store.create(await body(req))),
    "PUT nodes": async () => { const n = store.update(id, await body(req)); return n ? send(res, 200, n) : send(res, 404, { error: "nó não encontrado" }); },
    "DELETE nodes": () => send(res, store.remove(id) ? 200 : 404, { ok: true }),
    "POST link": async () => { const b = await body(req); return send(res, store.link(String(b.a), String(b.b), b.on !== false) ? 200 : 400, { ok: true }); },
    "GET claude-md": () => send(res, 200, { text: store.reindex(), path: path.join(store.ROOT, "CLAUDE.md") }),
    "POST chat": async () => send(res, 200, await claude.chat((await body(req)).messages || [])),
    "POST organize": async () => send(res, 201, await claude.organize(String((await body(req)).text || "").slice(0, 8000))),
    "GET events": () => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("data: hello\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    }
  };
  const handler = routes[`${m} ${resource}`];
  if (!handler) return send(res, 404, { error: "rota inexistente" });
  try { await handler(); }
  catch (e) { send(res, e.status || 500, { error: e.message, code: e.code }); }
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  const file = path.join(PUB, path.normalize(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("não encontrado"); }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Córtex rodando em  http://localhost:${PORT}`);
  console.log(`  Pasta do cérebro:  ${store.ROOT}`);
  console.log(`  Chat com Claude:   ${claude.hasKey() ? "ativo (" + claude.model() + ")" : "desligado — coloque ANTHROPIC_API_KEY no arquivo .env"}`);
  setTimeout(() => console.log(`  Backup Git:        ${backup.state.enabled ? "ativo" + (backup.state.remote ? " → " + backup.state.remote : " (só local)") : "desligado — rode  npm run backup"}\n`), 300);
});
