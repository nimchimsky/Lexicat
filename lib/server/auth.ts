// Identitat persistent: comptes lleugers amb enllaç màgic i sessió en galeta.
// L'identificador del jugador és estable entre visites i dispositius (§8.1):
// sense això no hi ha rànquing acumulat ni interval que s'estrenyi.

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { query } from "./db";
import { HttpError } from "./http";

export const SESSION_COOKIE = "lexicat_session";
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAGIC_TTL_MS = 15 * 60 * 1000;

function sha256(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Crea un token d'enllaç màgic per a un correu. Retorna el token en clar. */
export async function createMagicToken(email: string, ip: string | null): Promise<string> {
  const emailNorm = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) throw new Error("Correu invàlid");
  const token = randomToken();
  await query(
    `INSERT INTO auth_tokens (id, email, token_hash, expires_at, created_ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [crypto.randomUUID(), emailNorm, sha256(token), new Date(Date.now() + MAGIC_TTL_MS), ip]
  );
  return token;
}

/**
 * Canvia el token per una sessió nova. Si la sessió actual és d'un CONVIDAT
 * (jugador sense correu), el correu nou s'assigna AL MATEIX jugador: tot el
 * seu historial de partides i respostes es conserva (identitat persistent,
 * §8.1). Si no, crea o reutilitza el jugador d'aquest correu.
 */
export async function redeemMagicToken(token: string): Promise<{ playerId: string; hasNickname: boolean }> {
  const res = await query<{ id: string; email: string }>(
    `UPDATE auth_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING id, email`,
    [sha256(token)]
  );
  if (res.rowCount === 0) throw new HttpError(400, "Enllaç invàlit o caducat");
  const email = res.rows[0].email;

  // 1) Upgrade de convidat: mateixa fila, mateix historial.
  const current = await currentPlayer();
  if (current && current.email === null) {
    const claim = await query<{ id: string }>(
      `UPDATE players SET email = $2 WHERE id = $1 AND email IS NULL AND deleted_at IS NULL
       RETURNING id`,
      [current.id, email]
    );
    if (claim.rowCount !== 0) {
      return { playerId: current.id, hasNickname: false }; // triarà sobrenom de debò
    }
    // Correu ja agafat per un altre compte: cau al flux normal (sessió nova).
  }

  const player = await query<{ id: string; nickname: string | null; deleted_at: Date | null }>(
    `INSERT INTO players (id, email)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, nickname, deleted_at`,
    [crypto.randomUUID(), email]
  );
  const p = player.rows[0];
  if (p.deleted_at) throw new HttpError(409, "Aquest compte està esborrat. Fes-ne un de nou.");

  await issueSession(p.id);
  return { playerId: p.id, hasNickname: p.nickname !== null };
}

async function issueSession(playerId: string): Promise<void> {
  const sessionToken = randomToken();
  await query(
    `INSERT INTO sessions (id, player_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), playerId, sha256(sessionToken), new Date(Date.now() + SESSION_TTL_MS)]
  );
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
 * Sessió de CONVIDAT: jugador sense correu amb identitat persistent a la
 * galeta (1 any). Pot jugar tot, entrar als rànquings i, si més tard entra
 * amb correu, conservar tot l'historial (redeemMagicToken fa l'upgrade).
 */
export async function createGuestSession(): Promise<{ playerId: string }> {
  const existing = await currentPlayer();
  if (existing) return { playerId: existing.id };

  const playerId = crypto.randomUUID();
  const suffix = crypto.randomBytes(4).toString("hex");
  await query(
    `INSERT INTO players (id, email, nickname) VALUES ($1, NULL, $2)`,
    [playerId, `convidat-${suffix}`]
  );
  await issueSession(playerId);
  return { playerId };
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
  const nick = nickname.trim().toLowerCase().slice(0, 24);
  if (!/^[a-z0-9·àèéíïóòúüç_-]{3,24}$/.test(nick)) {
    throw new HttpError(400, "El sobrenom ha de tenir 3–24 caràcters (lletres, xifres, - o _)");
  }
  try {
    await query(`UPDATE players SET nickname = $2 WHERE id = $1`, [playerId, nick]);
  } catch (e) {
    if (String(e).includes("players_nickname_key")) throw new HttpError(409, "Aquest sobrenom ja està agafat");
    throw e;
  }
}

/**
 * Eliminació GDPR: la fila del jugador queda anonimitzada (correu i sobrenom
 * fora), les respostes ja entrada al calibratge es conserven deslligades de
 * qualsevol persona identificable.
 */
export async function deleteAccount(playerId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE player_id = $1`, [playerId]);
  await query(`DELETE FROM auth_tokens WHERE email = (SELECT email FROM players WHERE id = $1)`, [playerId]);
  await query(`DELETE FROM player_standings WHERE player_id = $1`, [playerId]);
  await query(`DELETE FROM player_profiles WHERE player_id = $1`, [playerId]);
  await query(
    `UPDATE players SET
       email = NULL,
       nickname = 'esborrat-' || left($2, 8),
       deleted_at = now()
     WHERE id = $1`,
    [playerId, crypto.randomUUID()]
  );
}
