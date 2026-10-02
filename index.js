/**
 * Host half of the dsh-tts bundle.
 *
 * Declares the persisted TTS settings schema and registers it with the Host
 * settings document; the Client module owns the speaker button, the settings
 * page, and the engines. Settings fields are read through
 * `ctx.configForms.get('dsh-tts')` on the client.
 *
 * For the Qwen Token Plan engine this half also serves one HTTP route that
 * proxies the token-plan TTS gateway as an SSE stream: the subscription key
 * never reaches the browser (the gateway rejects browser preflight anyway),
 * and sentence audio pieces are relayed to the client as they arrive.
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

/** Settings namespace (equals the Loader row id). */
export const SETTINGS_NAMESPACE = 'dsh-tts';

/** Host dependencies: the web server carries the qwen TTS proxy route. */
export const inject = ['webServer'];

/** Qwen Token Plan TTS gateway (subscription key `sk-sp-…`, NOT Bailian). */
const QWEN_TTS_ENDPOINT = 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const QWEN_TTS_MODEL = 'qwen-audio-3.0-tts-plus';

/** Persisted TTS preferences (see the settings page for their meaning). */
export const Config = z.object({
  /** TTS engine: browser speechSynthesis, Edge read-aloud, Azure Speech, or Qwen Token Plan. */
  engine: z.union(['local', 'edge', 'azure', 'qwen']).default('edge').volatile(),
  /** Preferred voice ShortName; '' picks by message language. */
  voice: z.string().default('').volatile(),
  /** Azure Speech region (e.g. eastus, southeastasia); engine 'azure' only. */
  azureRegion: z.string().default('').volatile(),
  /** Azure Speech resource key (Ocp-Apim-Subscription-Key); engine 'azure' only. */
  azureKey: z.string().default('').volatile(),
  /** Credential ref holding the Qwen Token Plan subscription key; engine 'qwen' only. */
  qwenApiKeyEnv: z.string().role('credential-ref').default('QWEN_TOKEN_PLAN_CN_API_KEY').volatile(),
  /** Playback volume, 0–100. */
  volume: z.number().default(100).volatile(),
  /** Speech rate as a percentage, 50–200. */
  rate: z.number().default(100).volatile(),
  /** Pitch adjustment: local maps to 0–2 pitch, Edge to ±Hz. -50–50. */
  pitch: z.number().default(0).volatile(),
  // NOTE: the auto-read switch deliberately lives in the browser's
  // localStorage (client.js), not here — it is a per-device preference.
});

/** Read a small JSON request body with a hard size cap. */
function readJsonBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const clamp = (value, low, high, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(high, Math.max(low, num)) : fallback;
};

/** Resolve the Qwen Token Plan key: credentials service first, then env. */
async function resolveQwenKey(ctx, config) {
  const raw = typeof config.qwenApiKeyEnv?.get === 'function'
    ? config.qwenApiKeyEnv.get()
    : config.qwenApiKeyEnv;
  const ref = credentialRef(raw);
  const credentials = ctx.get('credentials');
  if (credentials !== undefined) {
    const record = await credentials.resolve(ref);
    if (record?.value !== undefined && record.value !== '') return record.value;
  }
  const ambient = process.env[ref.name];
  return ambient !== undefined && ambient !== '' ? ambient : undefined;
}

export function apply(ctx, config) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-tts/qwen-tts',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'bad-request' });
        return;
      }
      const text = String(body?.text ?? '').slice(0, 8000);
      if (text.trim() === '') {
        sendJson(res, 400, { error: 'empty-text' });
        return;
      }
      // Voices are opaque gateway tokens; allow only a safe charset.
      const voice = /^[A-Za-z0-9_.-]{1,64}$/.test(String(body?.voice ?? ''))
        ? String(body.voice)
        : 'longanhuan_v3.6';
      const input = {
        text,
        voice,
        // The browser picks the codec: mp3 for MSE/blob playback, raw pcm
        // for the Web Audio path (PCM has no inter-frame dependencies, so
        // per-piece scheduling is gapless and artifact-free).
        format: ['mp3', 'pcm', 'wav'].includes(body?.format) ? body.format : 'mp3',
        sample_rate: [8000, 12000, 16000, 22050, 24000, 44100, 48000].includes(Number(body?.sample_rate))
          ? Number(body.sample_rate)
          : 24000,
        rate: clamp(body?.rate, 0.5, 2.0, 1.0),
        volume: Math.round(clamp(body?.volume, 0, 100, 100)),
        pitch: clamp(body?.pitch, 0.5, 2.0, 1.0),
      };

      let apiKey;
      try {
        apiKey = await resolveQwenKey(ctx, config);
      } catch (error) {
        ctx.logger?.warn?.('[dsh-tts] qwen credential resolve failed', error);
      }
      if (apiKey === undefined) {
        sendJson(res, 503, { error: 'credential-missing', message: 'QWEN_TOKEN_PLAN_CN_API_KEY 未在宿主凭据库或环境变量中配置' });
        return;
      }

      /** Map one non-OK gateway response to a readable JSON error. */
      const sendGatewayError = (status, detail) => {
        const message = String(detail ?? '').slice(0, 500);
        if (status === 401 || status === 403) {
          sendJson(res, 502, { error: 'invalid-key', message: `千问 Token Plan 密钥被拒绝 (HTTP ${status}): ${message}` });
        } else if (status === 429) {
          sendJson(res, 502, { error: 'rate-limited', message: '千问 Token Plan 限流或额度不足' });
        } else if (message.includes('411') || message.includes('Engine error')) {
          sendJson(res, 502, { error: 'voice-not-supported', message: `音色「${voice}」不属于 ${QWEN_TTS_MODEL}: ${message}` });
        } else {
          sendJson(res, 502, { error: 'gateway-error', message: `HTTP ${status}: ${message}` });
        }
      };

      // SSE passthrough (the only mode): the gateway streams sentence audio
      // as base64 SSE events; relay them to the browser as they arrive so
      // playback can start with the first fragment. The client's fetch abort
      // destroys the request, which aborts the upstream call.
      {
        const upstream = new AbortController();
        req.on('close', () => upstream.abort());
        // IDLE guard, not an overall cap: a long synthesis (an 8000-char
        // text streams for many minutes) must not be killed at a fixed
        // deadline — only a stalled connection is.
        let idle = setTimeout(() => upstream.abort(), 120000);
        const bumpIdle = () => {
          clearTimeout(idle);
          idle = setTimeout(() => upstream.abort(), 120000);
        };
        try {
          const response = await fetch(QWEN_TTS_ENDPOINT, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'X-DashScope-SSE': 'enable',
            },
            body: JSON.stringify({ model: QWEN_TTS_MODEL, input }),
            signal: upstream.signal,
          });
          if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => '');
            clearTimeout(idle);
            sendGatewayError(response.status, detail);
            return;
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no',
            // Authoritative codec declaration: the client plays PCM pieces
            // through Web Audio and MP3 through MSE/blobs — byte sniffing
            // cannot tell them apart (PCM speech often starts 0xFF 0xFF).
            'x-dsh-tts-format': input.format,
          });
          const reader = response.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bumpIdle();
              res.write(value);
            }
          } finally {
            clearTimeout(idle);
            res.end();
          }
        } catch (error) {
          clearTimeout(idle);
          if (!res.headersSent) {
            sendJson(res, 502, { error: 'gateway-unreachable', message: `千问 Token Plan 网关调用失败: ${String(error?.message ?? error)}` });
          } else {
            res.end();
          }
        }
      }
    },
  }), 'dsh-tts: qwen token-plan tts route');
}
