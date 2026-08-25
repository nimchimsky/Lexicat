import { query } from "./db";
import { HttpError } from "./http";

export const GENDER_OPTIONS = [
  "dona",
  "home",
  "no_binari",
  "altre",
  "prefereixo_no_dir_ho",
] as const;

export const EDUCATION_OPTIONS = [
  "sense_estudis",
  "primaris",
  "secundaris",
  "fp",
  "universitaris",
  "postgrau",
  "prefereixo_no_dir_ho",
] as const;

export type Gender = (typeof GENDER_OPTIONS)[number];
export type EducationLevel = (typeof EDUCATION_OPTIONS)[number];

export interface PlayerProfile {
  age: number | null;
  gender: Gender | null;
  birthPlace: string | null;
  residencePlace: string | null;
  educationLevel: EducationLevel | null;
  languagesCount: number | null;
  nativeCatalan: boolean | null;
}

export type PlayerProfileInput = PlayerProfile;

function nullableText(value: unknown, field: string, maxLength = 120): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} invàlid`);
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > maxLength) throw new HttpError(400, `${field} massa llarg`);
  return text;
}

function nullableInteger(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} fora de rang`);
  }
  return n;
}

function nullableChoice<T extends readonly string[]>(
  value: unknown,
  field: string,
  options: T,
): T[number] | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !options.includes(value)) {
    throw new HttpError(400, `${field} invàlid`);
  }
  return value as T[number];
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "boolean") throw new HttpError(400, `${field} invàlid`);
  return value;
}

export function normalizeProfileInput(input: Record<string, unknown>): PlayerProfileInput {
  return {
    age: nullableInteger(input.age, "L’edat", 1, 120),
    gender: nullableChoice(input.gender, "El gènere", GENDER_OPTIONS) as Gender | null,
    birthPlace: nullableText(input.birthPlace, "El lloc de naixement"),
    residencePlace: nullableText(input.residencePlace, "El lloc de residència"),
    educationLevel: nullableChoice(
      input.educationLevel,
      "El nivell d’estudis",
      EDUCATION_OPTIONS,
    ) as EducationLevel | null,
    languagesCount: nullableInteger(input.languagesCount, "El nombre de llengües", 1, 100),
    nativeCatalan: nullableBoolean(input.nativeCatalan, "El català nadiu"),
  };
}

export async function getPlayerProfile(playerId: string): Promise<PlayerProfile> {
  const res = await query<{
    age: number | null;
    gender: Gender | null;
    birth_place: string | null;
    residence_place: string | null;
    education_level: EducationLevel | null;
    languages_count: number | null;
    native_catalan: boolean | null;
  }>(
    `SELECT age, gender, birth_place, residence_place, education_level,
            languages_count, native_catalan
     FROM player_profiles WHERE player_id = $1`,
    [playerId],
  );
  const row = res.rows[0];
  return {
    age: row?.age ?? null,
    gender: row?.gender ?? null,
    birthPlace: row?.birth_place ?? null,
    residencePlace: row?.residence_place ?? null,
    educationLevel: row?.education_level ?? null,
    languagesCount: row?.languages_count ?? null,
    nativeCatalan: row?.native_catalan ?? null,
  };
}

export async function updatePlayerProfile(
  playerId: string,
  input: Record<string, unknown>,
): Promise<PlayerProfile> {
  const profile = normalizeProfileInput(input);
  await query(
    `INSERT INTO player_profiles
       (player_id, age, gender, birth_place, residence_place, education_level,
        languages_count, native_catalan, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (player_id) DO UPDATE SET
       age = EXCLUDED.age,
       gender = EXCLUDED.gender,
       birth_place = EXCLUDED.birth_place,
       residence_place = EXCLUDED.residence_place,
       education_level = EXCLUDED.education_level,
       languages_count = EXCLUDED.languages_count,
       native_catalan = EXCLUDED.native_catalan,
       updated_at = now()`,
    [
      playerId,
      profile.age,
      profile.gender,
      profile.birthPlace,
      profile.residencePlace,
      profile.educationLevel,
      profile.languagesCount,
      profile.nativeCatalan,
    ],
  );
  return profile;
}
