// Transcription des notes vocales WhatsApp via une API compatible Whisper (Groq, OpenAI...).

import type { Config } from "./config.ts";

export type Transcriber = (audio: Buffer, mimetype: string) => Promise<string | null>;

export function makeTranscriber(cfg: Config): Transcriber | null {
  if (!cfg.sttApiKey) return null;
  return async (audio, mimetype) => {
    const ext = mimetype.includes("ogg") ? "ogg" : mimetype.includes("mp4") ? "m4a" : mimetype.includes("mpeg") ? "mp3" : "ogg";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimetype.split(";")[0] }), `vocal.${ext}`);
    form.append("model", cfg.sttModel);
    form.append("language", "fr");
    const res = await fetch(cfg.sttUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.sttApiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.error(`Transcription échouée (${res.status}) : ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  };
}
