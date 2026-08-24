"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlayerProfile } from "@/lib/server/profile";

const GENDER_LABELS: Record<string, string> = {
  dona: "Dona",
  home: "Home",
  no_binari: "No binari",
  altre: "Altra identitat",
  prefereixo_no_dir_ho: "Prefereixo no dir-ho",
};

const EDUCATION_LABELS: Record<string, string> = {
  sense_estudis: "Sense estudis",
  primaris: "Estudis primaris",
  secundaris: "Estudis secundaris",
  fp: "Formació professional",
  universitaris: "Estudis universitaris",
  postgrau: "Postgrau",
  prefereixo_no_dir_ho: "Prefereixo no dir-ho",
};

export default function ProfileForm({ initialProfile }: { initialProfile: PlayerProfile }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof PlayerProfile>(field: K, value: PlayerProfile[K]) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No s’ha pogut desar el perfil");
      setProfile(data.profile);
      setMessage("Perfil desat.");
      router.refresh();
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="profile-grid">
        <label>
          Edat
          <input
            type="number"
            min={1}
            max={120}
            inputMode="numeric"
            value={profile.age ?? ""}
            onChange={(e) => setField("age", e.target.value === "" ? null : Number(e.target.value))}
          />
        </label>

        <label>
          Gènere
          <select
            value={profile.gender ?? ""}
            onChange={(e) => setField("gender", (e.target.value || null) as PlayerProfile["gender"])}
          >
            <option value="">No ho he indicat</option>
            {Object.entries(GENDER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label>
          Lloc de naixement
          <input
            type="text"
            maxLength={120}
            autoComplete="country-name"
            value={profile.birthPlace ?? ""}
            onChange={(e) => setField("birthPlace", e.target.value || null)}
          />
        </label>

        <label>
          Lloc de residència
          <input
            type="text"
            maxLength={120}
            autoComplete="address-level2"
            value={profile.residencePlace ?? ""}
            onChange={(e) => setField("residencePlace", e.target.value || null)}
          />
        </label>

        <label>
          Nivell d’estudis
          <select
            value={profile.educationLevel ?? ""}
            onChange={(e) => setField("educationLevel", (e.target.value || null) as PlayerProfile["educationLevel"])}
          >
            <option value="">No ho he indicat</option>
            {Object.entries(EDUCATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <label>
          Nombre de llengües
          <input
            type="number"
            min={1}
            max={100}
            inputMode="numeric"
            value={profile.languagesCount ?? ""}
            onChange={(e) => setField("languagesCount", e.target.value === "" ? null : Number(e.target.value))}
          />
        </label>

        <label>
          Català nadiu
          <select
            value={profile.nativeCatalan === null ? "" : profile.nativeCatalan ? "yes" : "no"}
            onChange={(e) => setField("nativeCatalan", e.target.value === "" ? null : e.target.value === "yes")}
          >
            <option value="">No ho he indicat</option>
            <option value="yes">Sí</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>

      <p className="form-help">Tots aquests camps són opcionals i només els pots veure tu.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="btn" disabled={busy} type="submit">
        {busy ? "Guardant…" : "Desa el perfil"}
      </button>
    </form>
  );
}
