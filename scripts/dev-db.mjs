// Gestor del Postgres local SENSE Docker.
//
// Fa servir `embedded-postgres`: binaris oficials de PostgreSQL descarregats
// per npm (node_modules/@embedded-postgres/windows-x64) i executats com a
// procés fill. Les dades viuen a `.pgdata/` (ignorat per git).
//
// Ús:
//   npm run db         # arrenca el servidor en segon pla i espera que escolti
//   npm run db:stop    # aturada neta
//   npm run db:status  # estat del servidor
//   npm run db:reset   # atura i ESBORRA les dades (.pgdata)
//
// La connexió es deriva de DATABASE_URL (.env), igual que la resta del projecte.

import "dotenv/config";

import net from "node:net";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, ".pgdata");
// initdb exigeix el directori de dades buit: el clúster viu a .pgdata/data i
// els fitxers de runtime (log/pid/stop) a .pgdata/.
const PGDATA = path.join(DATA_DIR, "data");
const PID_FILE = path.join(DATA_DIR, "server.pid");
const STOP_FILE = path.join(DATA_DIR, "server.stop");
const LOG_FILE = path.join(DATA_DIR, "server.log");
const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 30_000;

function connectionConfig() {
  const fallback = {
    user: "pompeu",
    password: "pompeu",
    port: 5433,
    database: "pompeu",
    host: "localhost",
  };
  const cs = process.env.DATABASE_URL;
  if (!cs) return fallback;
  try {
    const url = new URL(cs);
    return {
      user: url.username || fallback.user,
      password: url.password || fallback.password,
      port: url.port ? Number(url.port) : fallback.port,
      database: decodeURIComponent(url.pathname.slice(1)) || fallback.database,
      host: url.hostname || fallback.host,
    };
  } catch {
    return fallback;
  }
}

const CFG = connectionConfig();

function logStream() {
  return fs.openSync(LOG_FILE, "a");
}

function tailLog(n = 15) {
  try {
    const lines = fs.readFileSync(LOG_FILE, "utf8").trimEnd().split("\n");
    return lines.slice(-n).join("\n");
  } catch {
    return "";
  }
}

async function makePg() {
  return new EmbeddedPostgres({
    databaseDir: PGDATA,
    // Locale C + UTF8: mateix comportament que postgres:17-alpine. Sense això,
    // Windows crearia el clúster en WIN1252 i les migracions (contenen θ, ç…)
    // fallarien amb "has no equivalent in encoding".
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    user: CFG.user,
    password: CFG.password,
    port: CFG.port,
    persistent: true,
    onLog: (msg) => fs.appendFileSync(LOG_FILE, msg),
    onError: (msg) => fs.appendFileSync(LOG_FILE, String(msg)),
  });
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function canConnectAsApp() {
  const { Client } = await import("pg");
  const client = new Client({
    host: CFG.host,
    port: CFG.port,
    user: CFG.user,
    password: CFG.password,
    database: "postgres",
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function isRunning() {
  if (!(await isPortOpen(CFG.port))) return false;
  return canConnectAsApp();
}

async function createDatabaseIfMissing(dbName) {
  const { Client } = await import("pg");
  const client = new Client({
    host: CFG.host,
    port: CFG.port,
    user: CFG.user,
    password: CFG.password,
    database: "postgres",
  });
  try {
    await client.connect();
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (res.rowCount === 0) {
      const quoted = `"${dbName.replaceAll('"', '""')}"`;
      await client.query(`CREATE DATABASE ${quoted}`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function schemaIsSetUp() {
  const { Client } = await import("pg");
  const client = new Client({
    host: CFG.host,
    port: CFG.port,
    user: CFG.user,
    password: CFG.password,
    database: CFG.database,
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    const res = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'players'",
    );
    return res.rowCount > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function cmdStart() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.rm(STOP_FILE, { force: true });

  if (await isRunning()) {
    console.log(`Postgres ja és en marxa a localhost:${CFG.port} (dades: ${DATA_DIR}).`);
    return;
  }
  if (await isPortOpen(CFG.port)) {
    console.error(`El port ${CFG.port} està ocupat per un altre servei que no és aquest Postgres.`);
    process.exit(1);
  }

  await fsp.appendFile(LOG_FILE, `\n--- npm run db (${new Date().toISOString()}) ---\n`);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
    detached: true,
    stdio: ["ignore", logStream(), logStream()],
    windowsHide: true,
    cwd: ROOT,
  });
  child.unref();

  const startedAt = Date.now();
  const firstRun = !fs.existsSync(path.join(PGDATA, "PG_VERSION"));
  console.log(firstRun ? "Inicialitzant el clúster Postgres (només el primer cop)…" : "Arrencant Postgres…");

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    await sleep(400);
    if (child.exitCode !== null && child.exitCode !== 0) {
      console.error(`El servidor no ha arrencat (codi ${child.exitCode}). Últimes línies del log:\n${tailLog()}`);
      process.exit(1);
    }
    if (await isRunning()) {
      const setupHint = (await schemaIsSetUp()) ? "" : "\nBuit de nou: executa ara `npm run db:setup`.";
      console.log(`Postgres en marxa: postgres://${CFG.user}:***@localhost:${CFG.port}/${CFG.database}${setupHint}`);
      return;
    }
  }
  console.error(`Temps d'espera esgotat. Últimes línies del log:\n${tailLog()}`);
  process.exit(1);
}

async function cmdStop() {
  if (!(await isPortOpen(CFG.port))) {
    await cleanRuntimeFiles();
    console.log("Postgres no era en marxa.");
    return;
  }
  await fsp.writeFile(STOP_FILE, String(Date.now()));
  console.log("Aturant Postgres…");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(300);
    if (!(await isPortOpen(CFG.port))) {
      await cleanRuntimeFiles();
      console.log("Postgres aturat.");
      return;
    }
  }
  // El procés supervisor no respon: matem l'arbre per PID.
  const pid = Number(await fsp.readFile(PID_FILE, "utf8").catch(() => "0"));
  if (pid > 0) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { windowsHide: true });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
    }
    await sleep(1500);
  }
  await cleanRuntimeFiles();
  console.log("Postgres aturat (forçat).");
}

async function cmdStatus() {
  if (await isRunning()) {
    console.log(`En marxa: postgres://${CFG.user}:***@localhost:${CFG.port}/${CFG.database}`);
    return;
  }
  if (await isPortOpen(CFG.port)) {
    console.log(`El port ${CFG.port} està ocupat per un altre servei.`);
    return;
  }
  console.log("Aturat.");
}

async function cmdReset() {
  await cmdStop();
  await fsp.rm(DATA_DIR, { recursive: true, force: true });
  console.log("Dades esborrades (.pgdata). La propera arrencada recrearà el clúster.");
}

async function cmdServe() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.rm(STOP_FILE, { force: true });

  const pg = await makePg();

  if (!fs.existsSync(path.join(PGDATA, "PG_VERSION"))) {
    await pg.initialise();
    await fsp.appendFile(LOG_FILE, "Clúster inicialitzat.\n");
  }
  await pg.start();
  await createDatabaseIfMissing(CFG.database);

  await fsp.writeFile(PID_FILE, String(process.pid));
  console.log(`[dev-db] Postgres escoltant a localhost:${CFG.port} (pid ${process.pid})`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await pg.stop();
    } catch {
      /* ja mort */
    }
    await cleanRuntimeFiles();
    console.log("[dev-db] Aturat netament.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const watcher = setInterval(() => {
    if (fs.existsSync(STOP_FILE)) {
      clearInterval(watcher);
      void shutdown();
    }
  }, 300);
  watcher.unref?.();
}

async function cleanRuntimeFiles() {
  await fsp.rm(PID_FILE, { force: true }).catch(() => {});
  await fsp.rm(STOP_FILE, { force: true }).catch(() => {});
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const command = process.argv[2] ?? "start";
if (command === "start") await cmdStart();
else if (command === "stop") await cmdStop();
else if (command === "status") await cmdStatus();
else if (command === "reset") await cmdReset();
else if (command === "serve") await cmdServe();
else {
  console.error(`Ordre desconeguda: ${command}. Ús: start | stop | status | reset | serve`);
  process.exit(1);
}
