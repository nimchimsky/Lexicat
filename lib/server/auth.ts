// Identitat persistent: comptes lleugers amb enllaç màgic i sessió en galeta.
// L'identificador del jugador és estable entre visites i dispositius (§8.1):
// sense això no hi ha rànquing acumulat ni interval que s'estrenyi.

import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import { query, getPool } from "./db";
import { HttpError } from "./http";

export const SESSION_COOKIE = "lexicat_session";
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAGIC_TTL_MS = 15 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{64}$/i;
const MAX_EMAIL_LENGTH = 320;

type Client = PoolClient;

function sha256(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Crea un token d'enllaç màgic per a un correu. Retorna el token en clar. */
export async function createMagicToken(email: string, ip: string | null): Promise<string> {
  if (typeof email !== "string") throw new HttpError(400, "Correu invàlid");
  const emailNorm = email.trim().toLowerCase();
  if (emailNorm.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    throw new HttpError(400, "Correu invàlid");
  }
  // Cap de reutilització de tokens pendents: cada petició en genera un de nou,
  // però es poden acumular; la poda dels caducats és feina del sweep (cron).
  const token = randomToken();
  await query(
    `INSERT INTO auth_tokens (id, email, token_hash, expires_at, created_ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [crypto.randomUUID(), emailNorm, sha256(token), new Date(Date.now() + MAGIC_TTL_MS), ip]
  );
  return token;
}

/**
 * Insereix la sessió DINS d'una transacció i retorna el token en clar.
 * La galeta NO es posa aquí: qui crida ho fa després del COMMIT, així una
 * caiguda a mitja operació mai deixa un token consumit sense sessió (ni a
 * l'inrevés).
 */
async function insertSessionTx(client: Client, playerId: string): Promise<string> {
  const sessionToken = randomToken();
  await client.query(
    `INSERT INTO sessions (id, player_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), playerId, sha256(sessionToken), new Date(Date.now() + SESSION_TTL_MS)]
  );
  return sessionToken;
}

async function setSessionCookie(sessionToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });
}

/**
 * Canvia el token per una sessió nova. Si la sessió actual és d'un CONVIDAT
 * (jugador sense correu), el correu nou s'assigna AL MATEIX jugador: tot el
 * seu historial de partides i respostes es conserva (identitat persistent,
 * §8.1). Si no, crea o reutilitza el jugador d'aquest correu.
 *
 * Tot passa en UNA transacció (consumició del token, upgrade del convidat,
 * jugador i sessió): o entra del tot, o no entra i el token continua vàlid.
 */
export async function redeemMagicToken(token: string): Promise<{ playerId: string; hasNickname: boolean }> {
  // Els tokens generats són sempre 32 bytes hexadecimals. Rebutjar qualsevol
  // altra mida abans de calcular-ne el hash evita entrades arbitràriament grans
  // i fa que els enllaços malformats fallin com a validació, no a la DB.
  if (!TOKEN_RE.test(token)) throw new HttpError(400, "Enllaç invàlid o caducat");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const res = await client.query<{ id: string; email: string }>(
      `UPDATE auth_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING id, email`,
      [sha256(token)]
    );
    if (res.rowCount === 0) throw new HttpError(400, "Enllaç invàlid o caducat");
    const email = res.rows[0].email;

    // 1) Upgrade de convidat: mateixa fila, mateix historial.
    const current = await currentPlayer();
    if (current && current.email === null) {
      // L'UPDATE pot topar amb l'UNIQUE(email) si aquest correu ja pertany a
      // un compte. Aïllem l'intent en un savepoint: PostgreSQL deixa tota la
      // transacció en estat d'error després d'un 23505 fins que es desfà el
      // savepoint, i sense això el flux normal de login de sota no s'executa.
      await client.query("SAVEPOINT guest_upgrade");
      let claim: { rowCount: number | null };
      try {
        claim = await client.query<{ id: string }>(
          `UPDATE players SET email = $2 WHERE id = $1 AND email IS NULL AND deleted_at IS NULL
           RETURNING id`,
          [current.id, email]
        );
        await client.query("RELEASE SAVEPOINT guest_upgrade");
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT guest_upgrade");
        await client.query("RELEASE SAVEPOINT guest_upgrade");
        if ((e as { code?: string }).code !== "23505") throw e;
        claim = { rowCount: 0 };
      }
      if (claim.rowCount !== 0) {
        const t = await insertSessionTx(client, current.id);
        await client.query("COMMIT");
        await setSessionCookie(t);
        return { playerId: current.id, hasNickname: false }; // triarà sobrenom de debò
      }
      // Correu ja agafat per un altre compte: cau al flux normal (sessió nova).
    }

    const player = await client.query<{ id: string; nickname: string | null; deleted_at: Date | null }>(
      `INSERT INTO players (id, email)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, nickname, deleted_at`,
      [crypto.randomUUID(), email]
    );
    const p = player.rows[0];
    if (p.deleted_at) throw new HttpError(409, "Aquest compte està esborrat. Fes-ne un de nou.");

    const t = await insertSessionTx(client, p.id);
    await client.query("COMMIT");
    await setSessionCookie(t);
    return { playerId: p.id, hasNickname: p.nickname !== null };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Sessió de CONVIDAT: jugador sense correu amb identitat persistent a la
 * galeta (180 dies, SESSION_TTL_MS). Pot jugar tot, entrar als rànquings i,
 * si més tard entra amb correu, conservar tot l'historial (redeemMagicToken
 * fa l'upgrade).
 */
export async function createGuestSession(): Promise<{ playerId: string }> {
  const existing = await currentPlayer();
  if (existing) return { playerId: existing.id };

  const playerId = crypto.randomUUID();
  const suffix = crypto.randomBytes(4).toString("hex");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO players (id, email, nickname) VALUES ($1, NULL, $2)`,
      [playerId, `convidat-${suffix}`]
    );
    const t = await insertSessionTx(client, playerId);
    await client.query("COMMIT");
    await setSessionCookie(t);
    return { playerId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Jugador de la sessió actual, si n'hi ha un de vàlid i no esborrat. */
export async function currentPlayer(): Promise<{ id: string; email: string | null; nickname: string | null } | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const res = await query<{ id: string; email: string | null; nickname: string | null }>(
    `SELECT p.id, p.email::text AS email, p.nickname
     FROM sessions s JOIN players p ON p.id = s.player_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND p.deleted_at IS NULL`,
    [sha256(raw)]
  );
  return res.rows[0] ?? null;
}

export async function requirePlayer(): Promise<{ id: string; email: string | null; nickname: string | null }> {
  const p = await currentPlayer();
  if (!p) throw new HttpError(401, "Sessió requerida");
  return p;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    await query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(raw)]);
  }
  jar.delete(SESSION_COOKIE);
}

export async function setNickname(playerId: string, nickname: string): Promise<void> {
  const nick = String(nickname ?? "").trim().toLowerCase().slice(0, 24);
  if (!/^[a-z0-9·àèéíïóòúüç_-]{3,24}$/.test(nick)) {
    throw new HttpError(400, "El sobrenom ha de tenir 3–24 caràcters (lletres, xifres, - o _)");
  }
  try {
    await query(`UPDATE players SET nickname = $2 WHERE id = $1`, [playerId, nick]);
  } catch (e) {
    // unique_violation: sobrenom ja agafat (mai per text del missatge, que
    // varia entre versions de pg i drivers).
    if ((e as { code?: string }).code === "23505") {
      throw new HttpError(409, "Aquest sobrenom ja està agafat");
    }
    throw e;
  }
}

/** Poda sessions i tokens caducats (feina del sweep programat). */
export async function purgeExpiredAuthArtifacts(): Promise<void> {
  await query(`DELETE FROM sessions WHERE expires_at < now()`);
  await query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'`);
}

/**
 * Eliminació GDPR: la fila del jugador queda pseudonimitzada (correu i sobrenom
 * fora) i les respostes es conserven lligades només a l'identificador opac —
 * és el que el text de /privadesa explica. Les dades derivades de la identitat
 * (progrés del mapa, memòria d'exposicions, standings i perfil) s'esborren.
 * Tot en una transacció: una caiguda a mig camí mai deixa un compte mig
 * anonimitzat. El bloqueig del jugador impedeix que una partida nova arrenqui
 * mentre s'esborra.
 */
export async function deleteAccount(playerId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const own = await client.query(
      `SELECT id FROM players WHERE id = $1 FOR UPDATE`,
      [playerId]
    );
    if (own.rowCount === 0) throw new HttpError(404, "Jugador no trobat");
    await client.query(`DELETE FROM sessions WHERE player_id = $1`, [playerId]);
    await client.query(
      `DELETE FROM auth_tokens WHERE email = (SELECT email FROM players WHERE id = $1)`,
      [playerId]
    );
    await client.query(`DELETE FROM player_standings WHERE player_id = $1`, [playerId]);
    await client.query(`DELETE FROM player_profiles WHERE player_id = $1`, [playerId]);
    // Dades derivades d'una identitat que s'està pseudonimitzant: el mapa
    // guanyat i la memòria de refredament no tenen sentit sense el compte.
    await client.query(`DELETE FROM player_regions WHERE player_id = $1`, [playerId]);
    await client.query(`DELETE FROM item_exposure WHERE player_id = $1`, [playerId]);
    await client.query(
      `UPDATE players SET
         email = NULL,
         nickname = 'esborrat-' || left($2, 8),
         deleted_at = now()
       WHERE id = $1`,
      [playerId, crypto.randomUUID()]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
