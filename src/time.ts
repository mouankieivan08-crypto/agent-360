// Petits utilitaires de fuseau horaire, sans dépendance externe.

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function partsIn(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAYS[map.weekday ?? "Mon"] ?? 1,
  };
}

/** Date locale (YYYY-MM-DD) dans le fuseau donné. */
export function localDay(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes écoulées depuis minuit, heure locale. */
export function localMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * Convertit une heure locale « 2026-10-15T09:00 » (sans fuseau) en Date UTC.
 * Une chaîne qui porte déjà un fuseau (Z ou +01:00) est respectée telle quelle.
 */
export function parseLocal(input: string, timeZone: string): Date | null {
  const s = input.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const [y, mo, d, h = "09", mi = "00"] = m.slice(1);
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Décalage du fuseau à cet instant (gère l'heure d'été si le fuseau en a une).
  const p = partsIn(new Date(asUtc), timeZone);
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(asUtc - (shown - asUtc));
}

/** Affichage lisible en français : « mer. 15/10 09:00 ». */
export function formatLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
