// Assistant d'installation : pose quelques questions et écrit le fichier .env.
// Lancé automatiquement par DEMARRER.bat / demarrer.sh au premier démarrage (ou : npm run setup).

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { normalizePhone } from "./text.ts";

// File d'attente des lignes saisies : rien n'est perdu si plusieurs réponses arrivent d'un coup (copier-coller).
const rl = createInterface({ input: stdin });
const pending: string[] = [];
let waiting: ((line: string | null) => void) | null = null;
let inputClosed = false;
rl.on("line", (line) => {
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(line);
  } else pending.push(line);
});
rl.on("close", () => {
  inputClosed = true;
  waiting?.(null);
});

const ask = async (question: string, fallback = ""): Promise<string> => {
  stdout.write(fallback ? `${question} [${fallback}] : ` : `${question} : `);
  const line =
    pending.shift() ?? (inputClosed ? null : await new Promise<string | null>((resolve) => (waiting = resolve)));
  if (line === null) {
    console.log("\nInstallation interrompue.");
    process.exit(1);
  }
  if (!stdin.isTTY) stdout.write(`${line}\n`);
  return line.trim() || fallback;
};
const yes = (answer: string) => /^(o|oui|y|yes)/i.test(answer);

async function checkKey(apiKey: string): Promise<"ok" | "invalid" | "no_credit" | "offline" | string> {
  try {
    await new Anthropic({ apiKey }).messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 64,
      messages: [{ role: "user", content: "Réponds juste OK." }],
    });
    return "ok";
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return "invalid";
    if (e instanceof Anthropic.APIConnectionError) return "offline";
    if (e instanceof Anthropic.APIError && /credit|billing|balance/i.test(e.message)) return "no_credit";
    return e instanceof Error ? e.message : String(e);
  }
}

console.log("\n=== Installation de ton agent WhatsApp ===\n");

if (existsSync(".env") && !yes(await ask("Une configuration existe déjà. La refaire ? (o/n)", "n"))) {
  rl.close();
  process.exit(0);
}

// 1. Clé Claude
console.log("1/5  Clé API Claude : https://console.anthropic.com > API Keys > Create Key");
let apiKey = "";
while (!apiKey) {
  const key = await ask("     Colle ta clé (elle commence par sk-ant-)");
  if (!key.startsWith("sk-ant-")) {
    console.log("     Ce n'est pas une clé Claude. Réessaie.");
    continue;
  }
  stdout.write("     Vérification... ");
  const status = await checkKey(key);
  if (status === "ok") {
    console.log("clé valide ✅");
    apiKey = key;
  } else if (status === "invalid") {
    console.log("clé refusée ❌ (vérifie que tu l'as copiée en entier)");
  } else if (status === "offline") {
    console.log("pas d'internet, je garde la clé sans la vérifier.");
    apiKey = key;
  } else if (status === "no_credit") {
    console.log("clé valide mais pas de crédit ❌");
    console.log("     Ajoute un petit crédit sur console.anthropic.com > Billing (l'agent consomme très peu).");
    if (yes(await ask("     Continuer quand même et ajouter le crédit plus tard ? (o/n)", "o"))) apiKey = key;
  } else {
    console.log(`erreur inattendue : ${status}`);
    if (yes(await ask("     Garder cette clé quand même ? (o/n)", "n"))) apiKey = key;
  }
}

// 2. Prénom
const ownerName = await ask("\n2/5  Ton prénom (l'agent t'appellera comme ça)", "Boss");

// 3. Modèle
console.log("\n3/5  Cerveau de l'agent :");
console.log("     1) Économique : Claude Haiku, environ 1 $ par mois (recommandé pour démarrer)");
console.log("     2) Premium    : Claude Opus, plus fin mais environ 20 à 40 $ par mois");
const model = (await ask("     Ton choix", "1")) === "2" ? "claude-opus-5-5" : "claude-haiku-5-5";

// 4. WhatsApp
console.log("\n4/5  WhatsApp");
let agentPhone: string | null = null;
while (!agentPhone) {
  const raw = await ask("     Numéro WhatsApp que l'agent va utiliser (ex. 06 123 45 67 ou +242061234567)");
  agentPhone = normalizePhone(raw, "242");
  if (!agentPhone) console.log("     Numéro invalide, réessaie.");
}
let ownerNumbers = "";
if (!yes(await ask("     C'est ton numéro WhatsApp perso ? (o/n)", "o"))) {
  const mine = normalizePhone(await ask("     Ton numéro perso (pour parler à l'agent)"), "242");
  ownerNumbers = mine ?? "";
}

// 5. Vocaux
console.log("\n5/5  Notes vocales (optionnel) : clé gratuite sur https://console.groq.com > API Keys");
const sttKey = await ask("     Colle ta clé Groq, ou appuie sur Entrée pour passer", "");

rl.close();

// Écriture du .env à partir du modèle commenté.
const values: Record<string, string> = {
  ANTHROPIC_API_KEY: apiKey,
  OWNER_NAME: ownerName,
  CLAUDE_MODEL: model,
  CLAUDE_EFFORT: "medium",
  WA_PAIRING_NUMBER: agentPhone,
  OWNER_NUMBERS: ownerNumbers,
  STT_API_KEY: sttKey,
};
const template = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
const lines = template.split("\n").map((line) => {
  const m = /^([A-Z_]+)=/.exec(line);
  if (m && m[1] && m[1] in values) {
    const v = values[m[1]]!;
    delete values[m[1]];
    return `${m[1]}=${v}`;
  }
  return line;
});
for (const [k, v] of Object.entries(values)) lines.push(`${k}=${v}`);
writeFileSync(".env", lines.join("\n"));

console.log(`
✅ Configuration enregistrée.

Au démarrage, un CODE à 8 caractères va s'afficher. Sur le téléphone du numéro +${agentPhone} :
WhatsApp > Appareils connectés > Connecter un appareil > « Connecter avec un numéro de téléphone » > tape le code.
${ownerNumbers ? `Ensuite, écris à l'agent depuis ton numéro perso (+${ownerNumbers}).` : "Ensuite, parle à l'agent dans la discussion « Moi (Vous) » de ton WhatsApp."}
`);
