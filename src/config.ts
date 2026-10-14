// Lecture de la configuration depuis .env (voir .env.example).

try {
  process.loadEnvFile(".env");
} catch {
  // Pas de fichier .env : on se contente des variables d'environnement.
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

function int(name: string, fallback: number): number {
  const v = Number.parseInt(str(name, ""), 10);
  return Number.isFinite(v) ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name, "").toLowerCase();
  if (v === "") return fallback;
  return ["1", "true", "oui", "yes", "on"].includes(v);
}

function hhmm(name: string, fallback: string): { h: number; m: number } {
  const [h, m] = str(name, fallback).split(":").map((x) => Number.parseInt(x, 10));
  return { h: h ?? 0, m: m ?? 0 };
}

const digits = (s: string) => s.replace(/\D/g, "");

export const config = {
  agentName: str("AGENT_NAME", "Ndeko"),
  ownerName: str("OWNER_NAME", "Boss"),
  businessName: str("BUSINESS_NAME", "mon agence"),

  // Numéros (format international, chiffres seulement) autorisés à piloter l'agent.
  // Vide = tu pilotes l'agent depuis la discussion « Moi (Vous) » de ton propre WhatsApp.
  ownerNumbers: str("OWNER_NUMBERS", "")
    .split(",")
    .map(digits)
    .filter(Boolean),
  defaultCountryCode: digits(str("DEFAULT_COUNTRY_CODE", "242")),
  timezone: str("TIMEZONE", "Africa/Brazzaville"),
  currency: str("CURRENCY", "FCFA"),

  // Objectif initial (modifiable ensuite en parlant à l'agent).
  goalAmount: int("GOAL_AMOUNT", 5_000_000),
  goalDeadline: str("GOAL_DEADLINE", "2026-12-31"),
  goalStart: str("GOAL_START", "2026-01-01"),

  // Claude
  model: str("CLAUDE_MODEL", "claude-opus-5-5"),
  effort: str("CLAUDE_EFFORT", "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  webSearch: bool("WEB_SEARCH", true),
  webSearchCountry: str("WEB_SEARCH_COUNTRY", "CG"),
  webSearchCity: str("WEB_SEARCH_CITY", "Brazzaville"),

  // Transcription des notes vocales (API compatible Whisper : Groq, OpenAI...). Optionnel.
  sttUrl: str("STT_URL", "https://api.groq.com/openai/v1/audio/transcriptions"),
  sttApiKey: str("STT_API_KEY", ""),
  sttModel: str("STT_MODEL", "whisper-large-v3-turbo"),

  // Prospection : garde-fous anti-bannissement WhatsApp.
  dailySendLimit: int("DAILY_SEND_LIMIT", 25),
  minGapSeconds: int("MIN_GAP_SECONDS", 120),
  maxGapSeconds: int("MAX_GAP_SECONDS", 420),
  sendStart: hhmm("SEND_WINDOW_START", "08:30"),
  sendEnd: hhmm("SEND_WINDOW_END", "17:30"),
  // Jours d'envoi : 1 = lundi ... 7 = dimanche.
  sendDays: str("SEND_DAYS", "1,2,3,4,5,6")
    .split(",")
    .map((d) => Number.parseInt(d, 10))
    .filter((d) => d >= 1 && d <= 7),

  // Rituels du coach (heure locale).
  morningBrief: hhmm("MORNING_BRIEF", "07:45"),
  eveningCheckin: hhmm("EVENING_CHECKIN", "19:30"),
  // Revue hebdo : jour (1-7) et heure.
  weeklyReviewDay: int("WEEKLY_REVIEW_DAY", 7),
  weeklyReview: hhmm("WEEKLY_REVIEW", "18:00"),

  dataDir: str("DATA_DIR", "./data"),
  authDir: str("WA_AUTH_DIR", "./auth"),
  // Si renseigné : connexion par code d'appairage au lieu du QR code.
  pairingNumber: digits(str("WA_PAIRING_NUMBER", "")),
};

export type Config = typeof config;
