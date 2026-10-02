/**
 * Host half of the dsh-tts bundle.
 *
 * Declares the persisted TTS settings schema and registers it with the Host
 * settings document; the Client module owns the speaker button, the settings
 * page, and the engines. Settings fields are read through
 * `ctx.configForms.get('dsh-tts')` on the client.
 */
import z from '@deepseek-ai/schemastery';

/** Settings namespace (equals the Loader row id). */
export const SETTINGS_NAMESPACE = 'dsh-tts';

/** Persisted TTS preferences (see the settings page for their meaning). */
export const Config = z.object({
  /** TTS engine: browser speechSynthesis, Edge read-aloud, or Azure Speech. */
  engine: z.union(['local', 'edge', 'azure']).default('edge').volatile(),
  /** Preferred voice ShortName; '' picks by message language. */
  voice: z.string().default('').volatile(),
  /** Azure Speech region (e.g. eastus, southeastasia); engine 'azure' only. */
  azureRegion: z.string().default('').volatile(),
  /** Azure Speech resource key (Ocp-Apim-Subscription-Key); engine 'azure' only. */
  azureKey: z.string().default('').volatile(),
  /** Playback volume, 0–100. */
  volume: z.number().default(100).volatile(),
  /** Speech rate as a percentage, 50–200. */
  rate: z.number().default(100).volatile(),
  /** Pitch adjustment: local maps to 0–2 pitch, Edge to ±Hz. -50–50. */
  pitch: z.number().default(0).volatile(),
  // NOTE: the auto-read switch deliberately lives in the browser's
  // localStorage (client.js), not here — it is a per-device preference.
});

export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
}
