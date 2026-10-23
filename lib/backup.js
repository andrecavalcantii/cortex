// Backup automático com Git: alguns segundos depois de cada mudança, faz commit da pasta cerebro/
// e, se houver repositório remoto (GitHub), envia com push. Ative com:  npm run backup -- <url do repo>
const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const DELAY = Number(process.env.BACKUP_DELAY_MS) || 20000;
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const state = { enabled: false, remote: "", lastCommit: null, lastPush: null, error: "" };
let timer = null, running = false, again = false;

const git = (...args) => new Promise((ok, fail) =>
  execFile("git", args, { cwd: store.ROOT, env, windowsHide: true }, (err, stdout, stderr) =>
    err ? fail(Object.assign(err, { stderr: String(stderr) })) : ok(String(stdout).trim())));

async function init() {
  state.enabled = fs.existsSync(path.join(store.ROOT, ".git"));
  if (!state.enabled) return state;
  state.remote = await git("remote", "get-url", "origin").catch(() => "");
  const last = await git("log", "-1", "--format=%cI").catch(() => "");
  state.lastCommit = last || null;
  return state;
}

function message() {
  const n = store.all().length;
  return `córtex: ${n} nós · ${new Date().toLocaleString("pt-BR")}`;
}

async function run() {
  if (running) { again = true; return; }
  running = true;
  try {
    await git("add", "-A");
    const changed = await git("diff", "--cached", "--quiet").then(() => false, () => true);
    if (changed) {
      await git("commit", "-q", "-m", message());
      state.lastCommit = new Date().toISOString();
    }
    if (state.remote && changed) {
      await git("push", "-q", "origin", "HEAD");
      state.lastPush = new Date().toISOString();
    }
    state.error = "";
  } catch (e) {
    state.error = (e.stderr || e.message || "").split("\n").filter(Boolean).slice(-1)[0] || "falha no git";
    console.warn("  [backup] " + state.error);
  } finally {
    running = false;
    if (again) { again = false; schedule(); }
  }
}

function schedule() {
  if (!state.enabled) return;
  clearTimeout(timer);
  timer = setTimeout(run, DELAY);
}

// Ao fechar o servidor (Ctrl+C), salva o que estiver pendente.
function flushSync() {
  if (!state.enabled || !timer) return;
  clearTimeout(timer);
  try {
    const opts = { cwd: store.ROOT, env, stdio: "ignore", windowsHide: true };
    execFileSync("git", ["add", "-A"], opts);
    execFileSync("git", ["commit", "-q", "-m", message()], opts);
    if (state.remote) execFileSync("git", ["push", "-q", "origin", "HEAD"], { ...opts, timeout: 15000 });
  } catch { /* nada para salvar, ou sem rede: o próximo início envia */ }
}

module.exports = { init, schedule, run, flushSync, state };
