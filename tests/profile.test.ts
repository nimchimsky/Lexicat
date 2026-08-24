import { describe, expect, it } from "vitest";
import { normalizeProfileInput } from "../lib/server/profile";

describe("perfil opcional", () => {
  it("accepta el perfil complet i normalitza els textos", () => {
    expect(normalizeProfileInput({
      age: "42",
      gender: "dona",
      birthPlace: "  Girona   ",
      residencePlace: "Barcelona",
      educationLevel: "universitaris",
      languagesCount: 3,
      nativeCatalan: true,
    })).toEqual({
      age: 42,
      gender: "dona",
      birthPlace: "Girona",
      residencePlace: "Barcelona",
      educationLevel: "universitaris",
      languagesCount: 3,
      nativeCatalan: true,
    });
  });

  it("permet deixar tots els camps buits", () => {
    expect(normalizeProfileInput({
      age: "",
      gender: "",
      birthPlace: "",
      residencePlace: null,
      educationLevel: "",
      languagesCount: "",
      nativeCatalan: null,
    })).toEqual({
      age: null,
      gender: null,
      birthPlace: null,
      residencePlace: null,
      educationLevel: null,
      languagesCount: null,
      nativeCatalan: null,
    });
  });

  it("rebutja valors fora de rang o opcions desconegudes", () => {
    expect(() => normalizeProfileInput({ age: 121 })).toThrow();
    expect(() => normalizeProfileInput({ gender: "desconegut" })).toThrow();
    expect(() => normalizeProfileInput({ languagesCount: 0 })).toThrow();
  });
});
