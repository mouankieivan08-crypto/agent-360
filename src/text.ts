// Numéros de téléphone, gabarits de messages et détection de désinscription.

/**
 * Normalise un numéro en format international sans « + » (ex. 242061234567).
 * Les numéros locaux reçoivent l'indicatif par défaut.
 */
export function normalizePhone(raw: string, defaultCountryCode: string): string | null {
  let s = raw.trim();
  const hasPlus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = s.slice(2);
  else if (!hasPlus && !s.startsWith(defaultCountryCode)) {
    s = defaultCountryCode + s;
  }
  // Un numéro international fait entre 8 et 15 chiffres (E.164).
  if (s.length < 8 || s.length > 15) return null;
  return s;
}

export type TemplateVars = Record<string, string | null | undefined>;

/**
 * Rend un gabarit :
 *  - {{entreprise}}, {{contact}}, {{prenom}}, {{secteur}}, {{ville}} sont remplacés ;
 *  - {Bonjour|Salut|Bonne journée} choisit une variante au hasard (évite les messages identiques).
 * Retourne aussi les variables manquantes pour que l'agent puisse corriger.
 */
export function renderTemplate(
  template: string,
  vars: TemplateVars,
  random: () => number = Math.random,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  let text = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key.toLowerCase()];
    if (v === undefined || v === null || v.trim() === "") {
      missing.add(key);
      return "";
    }
    return v.trim();
  });
  text = text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, options: string) => {
    const choices = options.split("|");
    return choices[Math.floor(random() * choices.length)] ?? "";
  });
  // Nettoie les espaces laissés par une variable vide (« Bonjour  , » -> « Bonjour, »).
  // (on garde l'espace français avant ? ! : ;)
  text = text
    .replace(/[ \t]+([,.])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, missing: [...missing] };
}

const OPT_OUT_PATTERNS = [
  /^\s*stop\s*[.!]*\s*$/i,
  /\b(d[ée]sinscri|d[ée]sabonn)/i,
  /\b(arr[êe]te[zr]?|cessez)\b.{0,30}\b(m['’ ]?[ée]crire|message|contacter|spam)/i,
  /\bne\s+(m['’ ]?[ée]cri|me\s+contact|me\s+d[ée]range)\w*\s+plus\b/i,
  /\b(supprime[zr]?|retire[zr]?)\b.{0,20}\bnum[ée]ro\b/i,
  /\bc['’ ]?est\s+du\s+spam\b/i,
];

/** Le prospect demande-t-il explicitement à ne plus être contacté ? */
export function isOptOut(text: string): boolean {
  return OPT_OUT_PATTERNS.some((re) => re.test(text));
}

/** Découpe un long texte en messages WhatsApp lisibles. */
export function splitForWhatsApp(text: string, max = 3500): string[] {
  const out: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    current = para;
    while (current.length > max) {
      out.push(current.slice(0, max));
      current = current.slice(max);
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
