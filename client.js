window.__ModuleLoader__.load({
  id: 'dsh-tts',
  factory(require) {
    const React = require('react');
    const { useState, useEffect } = React;
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-tts';
    /** Settings namespace on the Host settings document (equals the row id). */
    const SETTINGS_NAMESPACE = 'dsh-tts';
    const zh = {
      'nav': 'TTS 朗读',
      'action.read': '朗读',
      'action.stop': '停止朗读',
      'settings.engine': '语音合成服务',
      'settings.engine.local': '浏览器本地合成',
      'settings.engine.edge': 'Edge 在线语音（免密钥）',
      'settings.engine.azure': 'Azure 语音服务（官方接口）',
      'settings.azure.region': 'Azure 区域 (Region)',
      'settings.azure.key': 'Azure 密钥 (Key)',
      'settings.azure.hint': '在 Azure Portal 的语音资源“密钥和终结点”页获取；区域填资源所在区域（如 eastus、southeastasia）。免费层 F0 每月含 50 万字符 neural 配额。',
      'settings.azure.missing': '尚未配置 Azure 区域或密钥，Azure 引擎暂不可用。',
      'settings.voice': '音色',
      'settings.voice.auto': '自动（按消息语言）',
      'settings.volume': '音量',
      'settings.rate': '语速',
      'settings.pitch': '音调',
      'settings.autoRead': '自动朗读新回复',
      'settings.autoRead.hint': '助手回复完成后自动开始朗读；点击小喇叭可随时停止。',
      'settings.test': '测试播放',
      'settings.test.stop': '停止测试',
      'settings.unavailable': '设置暂不可用（未连接宿主），当前显示默认值。',
      'test.sentence': '你好，这是一条语音朗读测试。Hello, this is a speech test.',
    };
    const en = {
      'nav': 'TTS Read Aloud',
      'action.read': 'Read aloud',
      'action.stop': 'Stop reading',
      'settings.engine': 'Speech service',
      'settings.engine.local': 'Browser speechSynthesis',
      'settings.engine.edge': 'Edge online voices (no key)',
      'settings.engine.azure': 'Azure Speech Service',
      'settings.azure.region': 'Azure region',
      'settings.azure.key': 'Azure key',
      'settings.azure.hint': "Get both from your Speech resource's “Keys and Endpoint” page in the Azure portal (region e.g. eastus, southeastasia). The free F0 tier includes 0.5M neural characters per month.",
      'settings.azure.missing': 'Azure region/key not configured yet; the Azure engine is unavailable.',
      'settings.voice': 'Voice',
      'settings.voice.auto': 'Auto (by message language)',
      'settings.volume': 'Volume',
      'settings.rate': 'Rate',
      'settings.pitch': 'Pitch',
      'settings.autoRead': 'Auto-read new replies',
      'settings.autoRead.hint': 'Start reading automatically when an assistant reply settles; the speaker button stops it.',
      'settings.test': 'Test playback',
      'settings.test.stop': 'Stop test',
      'settings.unavailable': 'Settings are unavailable (host not connected); defaults are shown.',
      'test.sentence': 'Hello, this is a speech test. 你好，这是一条语音朗读测试。',
    };

    // ---------------------------------------------------------------------------
    // Text preparation
    // ---------------------------------------------------------------------------

    /** Light Markdown cleanup so the voice reads prose, not markup. */
    function stripMarkdown(text) {
      return text
        .replace(/^\s*```[^\n]*$/gm, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_~]{1,3}/g, '')
        .replace(/^\s*\|[-:|\s]+\|\s*$/gm, '')
        .replace(/\|/g, ', ')
        .replace(/^\s*([-*_]\s*){3,}$/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
    }

    /** Split long text into utterance-sized chunks. */
    function chunkText(text, limit = 200) {
      const chunks = [];
      let buffer = '';
      const sentences = text.match(/[^。！？；!?;.]+[。！？；!?;.]*\s*|\n+/g) ?? [text];
      for (const sentence of sentences) {
        let piece = sentence;
        while (piece.length > limit) {
          if (buffer !== '') { chunks.push(buffer); buffer = ''; }
          chunks.push(piece.slice(0, limit));
          piece = piece.slice(limit);
        }
        if (buffer.length + piece.length > limit && buffer !== '') {
          chunks.push(buffer);
          buffer = piece;
        } else {
          buffer += piece;
        }
      }
      if (buffer !== '') chunks.push(buffer);
      return chunks.filter((chunk) => chunk.trim() !== '');
    }

    /** Rough language pick: any CJK char -> zh, otherwise en. */
    function detectLang(text) {
      return /[\u3000-\u9fff\uff00-\uffef]/.test(text) ? 'zh' : 'en';
    }

    function escapeXml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    // ---------------------------------------------------------------------------
    // Settings (persisted on the Host document via ctx.configForms)
    // ---------------------------------------------------------------------------

    const DEFAULT_SETTINGS = {
      engine: 'edge', voice: '', azureRegion: '', azureKey: '',
      volume: 100, rate: 100, pitch: 0, autoRead: false,
    };

    /** Live view over the settings form (Host-persisted) with an in-memory fallback. */
    function createSettingsStore(form) {
      const listeners = new Set();
      const notify = () => { for (const listener of listeners) listener(); };
      const memory = { ...DEFAULT_SETTINGS };
      let live = form;
      let off = live === null ? () => {} : live.subscribe(notify);
      return {
        dispose: () => { off(); listeners.clear(); },
        /** Attach or replace the Host settings form (late configForms injection). */
        attach(next) {
          off();
          live = next;
          off = live.subscribe(notify);
          notify();
        },
        get value() {
          const stored = live?.getSnapshot().value ?? null;
          return stored === null ? memory : { ...DEFAULT_SETTINGS, ...stored };
        },
        get status() { return live === null ? 'unavailable' : live.getSnapshot().status; },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set: (field, value) => {
          memory[field] = value;
          if (live !== null) {
            live.set(field, value).catch((error) => {
              // Persisted writes go to the Host settings document; surface a
              // rejection (e.g. value outside the registered schema) instead
              // of silently dropping it — roll the field back to the stored
              // value so the UI does not pretend it was saved.
              console.warn(`[dsh-tts] 设置“${field}”保存到宿主失败:`, error);
              try {
                memory[field] = (live.getSnapshot().value ?? DEFAULT_SETTINGS)[field];
              } catch { /* keep optimistic value if re-read fails */ }
              notify();
            });
          }
          notify();
        },
      };
    }

    // ---------------------------------------------------------------------------
    // Voice catalogs
    // ---------------------------------------------------------------------------

    /**
     * Curated Microsoft neural voices (ShortName -> display label). The same
     * ShortNames serve both the Edge read-aloud endpoint and the official
     * Azure Speech service, so both engines share this catalog.
     */
    const NEURAL_VOICES = [
      { name: 'zh-CN-XiaoxiaoNeural', label: '晓晓 Xiaoxiao (zh-CN, 女)' },
      { name: 'zh-CN-XiaoyiNeural', label: '晓伊 Xiaoyi (zh-CN, 女)' },
      { name: 'zh-CN-XiaochenNeural', label: '晓辰 Xiaochen (zh-CN, 女)' },
      { name: 'zh-CN-YunxiNeural', label: '云希 Yunxi (zh-CN, 男)' },
      { name: 'zh-CN-YunjianNeural', label: '云健 Yunjian (zh-CN, 男)' },
      { name: 'zh-CN-YunyangNeural', label: '云扬 Yunyang (zh-CN, 男)' },
      { name: 'zh-CN-YunzeNeural', label: '云泽 Yunze (zh-CN, 男)' },
      { name: 'zh-HK-HiuMaanNeural', label: '曉曼 HiuMaan (zh-HK, 女)' },
      { name: 'zh-TW-HsiaoChenNeural', label: '曉臻 HsiaoChen (zh-TW, 女)' },
      { name: 'en-US-AriaNeural', label: 'Aria (en-US, 女)' },
      { name: 'en-US-JennyNeural', label: 'Jenny (en-US, 女)' },
      { name: 'en-US-AvaNeural', label: 'Ava (en-US, 女)' },
      { name: 'en-US-GuyNeural', label: 'Guy (en-US, 男)' },
      { name: 'en-US-AndrewNeural', label: 'Andrew (en-US, 男)' },
      { name: 'en-GB-SoniaNeural', label: 'Sonia (en-GB, 女)' },
      { name: 'ja-JP-NanamiNeural', label: 'Nanami (ja-JP, 女)' },
      { name: 'ko-KR-SunHiNeural', label: 'SunHi (ko-KR, 女)' },
    ];

    /** Auto voice per language family for the neural voice engines. */
    const NEURAL_AUTO_VOICE = {
      zh: 'zh-CN-XiaoxiaoNeural',
      en: 'en-US-AriaNeural',
      ja: 'ja-JP-NanamiNeural',
      ko: 'ko-KR-SunHiNeural',
    };

    // ---------------------------------------------------------------------------
    // Engine layer — one interface, two implementations
    //
    // TtsEngine: {
    //   available: boolean
    //   speak(request: { text, lang, voice, volume, rate, pitch }, h: { onEnd, onError }) -> { cancel() }
    // }
    // ---------------------------------------------------------------------------

    function createLocalEngine() {
      const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
      return {
        id: 'local',
        available: supported,
        speak(request, handlers) {
          const synth = window.speechSynthesis;
          synth.cancel();
          const text = stripMarkdown(request.text);
          const chunks = chunkText(text);
          if (chunks.length === 0) { handlers.onEnd(); return { cancel() {} }; }
          const langTag = request.lang === 'zh' ? 'zh-CN' : 'en-US';
          const volume = Math.min(1, Math.max(0, request.volume / 100));
          const rate = Math.min(10, Math.max(0.1, request.rate / 100));
          const pitch = Math.min(2, Math.max(0, (request.pitch + 50) / 50));
          const voices = synth.getVoices();
          const chosen = request.voice !== ''
            ? voices.find((v) => v.name === request.voice)
            : voices.find((v) => v.lang === langTag);
          let cancelled = false;
          const speakNext = () => {
            if (cancelled) return;
            const chunk = chunks.shift();
            if (chunk === undefined) { handlers.onEnd(); return; }
            const utterance = new SpeechSynthesisUtterance(chunk);
            utterance.lang = chosen?.lang ?? langTag;
            if (chosen !== undefined) utterance.voice = chosen;
            utterance.volume = volume;
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.onend = speakNext;
            utterance.onerror = (event) => {
              if (cancelled) return;
              cancelled = true;
              handlers.onError(new Error(`speechSynthesis error: ${event.error}`));
            };
            synth.speak(utterance);
          };
          speakNext();
          return {
            cancel() { cancelled = true; synth.cancel(); },
          };
        },
        cancel() { if (supported) window.speechSynthesis.cancel(); },
      };
    }

    // --- Edge read-aloud engine (same protocol as the edge-tts project) ------

    /**
     * Trusted client token — copied byte-for-byte from the working reference
     * client. NOTE: it differs from the official Edge token in one character
     * (...91D6F4 vs ...91F6F4); the endpoint's admission rules treat them
     * differently, and this is the one that connects from mainland networks.
     */
    const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
    const EDGE_WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
    const EDGE_GEC_VERSION = '1-133.0.3065.51';
    const WIN_EPOCH_SECONDS = 11644473600;
    /** Token + shared URL cached within the 300-second DRM window (as the reference client does). */
    let edgeUrlCache = { url: '', expiresAt: 0 };

    /**
     * Connection URL whose Sec-MS-GEC token matches the reference Edge client:
     * ticks = (unixSeconds + WIN_EPOCH) floored to 300s, as a string with 7 zeros appended.
     */
    async function edgeConnectionUrl() {
      if (edgeUrlCache.url !== '' && Date.now() < edgeUrlCache.expiresAt) {
        return edgeUrlCache.url;
      }
      let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH_SECONDS;
      const remainder = ticks % 300;
      const expiresAt = Date.now() + (300 - remainder) * 1000;
      ticks = ticks - remainder + '0000000';
      const bytes = new TextEncoder().encode(`${ticks}${EDGE_TOKEN}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const gec = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
      const url = `${EDGE_WSS}?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${gec}`
        + `&Sec-MS-GEC-Version=${EDGE_GEC_VERSION}`;
      edgeUrlCache = { url, expiresAt };
      return url;
    }

    /** Signed prosody values in the format the Edge endpoint expects (+0% / +0Hz). */
    function edgeProsody(volume, rate, pitch) {
      const fmtVolume = `${volume >= 100 ? '+' : ''}${volume - 100}%`;
      const fmtRate = `${rate >= 100 ? '+' : ''}${rate - 100}%`;
      const fmtPitch = `${pitch >= 0 ? '+' : ''}${pitch}Hz`;
      return `volume="${fmtVolume}" rate="${fmtRate}" pitch="${fmtPitch}"`;
    }

    /**
     * ONE shared WebSocket, reused across utterances within the 300-second DRM
     * window — the endpoint rejects extra connections bearing the same token,
     * so a socket per request fails (this mirrors the reference client, which
     * keeps `voiceSocket` alive and reuses it for every utterance).
     */
    const edgeSocketState = {
      socket: null,
      windowExpiresAt: 0,
      /** handler set by the in-flight request; gets audio frames and turn events */
      active: null,
    };

    function edgeDropSocket() {
      const state = edgeSocketState;
      state.active = null;
      if (state.socket !== null) {
        const socket = state.socket;
        state.socket = null;
        try { socket.close(); } catch { /* already closed */ }
      }
      state.windowExpiresAt = 0;
    }

    /** Open (or reuse) the shared socket; resolves once it is open. */
    function edgeEnsureSocket() {
      const state = edgeSocketState;
      if (state.socket !== null && state.socket.readyState === WebSocket.OPEN) {
        return Promise.resolve(state.socket);
      }
      edgeDropSocket();
      // Byte-for-byte the reference client's URL: no ConnectionId parameter.
      return edgeConnectionUrl().then((base) => new Promise((resolve, reject) => {
        const socket = new WebSocket(base);
        socket.binaryType = 'arraybuffer';
        const timeout = setTimeout(() => {
          reject(new Error('edge-tts: 连接超时（网络被拦截或端点不可达）'));
          edgeDropSocket();
        }, 12000);
        socket.onopen = () => {
          clearTimeout(timeout);
          state.socket = socket;
          state.windowExpiresAt = edgeUrlCache.expiresAt;
          resolve(socket);
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          edgeDropSocket();
          reject(new Error('edge-tts: WebSocket 被拒绝（本机网络到微软接口直连不通，或连接数超限）'));
        };
        socket.onclose = () => {
          clearTimeout(timeout);
          const wasCurrent = state.socket === socket;
          // Capture the in-flight handler BEFORE dropping: edgeDropSocket
          // nulls state.active, and the awaiting chunk must learn about the
          // loss instead of hanging until its 15-second timeout.
          const active = state.active;
          edgeDropSocket();
          if (wasCurrent && active !== null) active.onConnectionLost?.();
        };
        socket.onmessage = (event) => {
          const active = state.active;
          if (active === null) return;
          if (typeof event.data === 'string') {
            if (event.data.includes('Path:turn.end')) active.onTurnEnd();
            return;
          }
          const frame = new Uint8Array(event.data);
          const headerLength = (frame[0] << 8) | frame[1];
          const header = new TextDecoder().decode(frame.slice(2, 2 + headerLength));
          if (header.includes('Path:audio')) active.onAudio(frame.slice(2 + headerLength));
        };
      }));
    }

    /** Send one SSML request over the shared socket and collect its MP3 parts. */
    function edgeSynthesizeChunk(text, options, signal) {
      return edgeEnsureSocket().then((socket) => new Promise((resolve, reject) => {
        const state = edgeSocketState;
        const parts = [];
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          state.active = null;
          if (error !== undefined) reject(error);
          else resolve(parts);
        };
        const timeout = setTimeout(() => {
          // A stalled turn desyncs the shared socket (its late turn.end would
          // be misattributed to the next request) — drop it.
          edgeDropSocket();
          finish(new Error('edge-tts: timed out waiting for audio'));
        }, 15000);
        state.active = {
          onAudio: (audio) => { parts.push(audio); },
          onTurnEnd: () => {
            clearTimeout(timeout);
            finish();
          },
          onConnectionLost: () => {
            clearTimeout(timeout);
            finish(new Error('edge-tts: connection lost mid-utterance'));
          },
        };
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          finish(new Error('edge-tts: cancelled'));
        });
        const requestId = crypto.randomUUID().replace(/-/g, '');
        socket.send(`X-RequestId:${requestId}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
          + JSON.stringify({
            context: {
              synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } },
            },
          }));
        const langTag = options.lang === 'zh' ? 'zh-CN' : 'en-US';
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langTag}'>`
          + `<voice name='${options.voice}'><prosody ${edgeProsody(options.volume, options.rate, options.pitch)}>${escapeXml(text)}</prosody></voice></speak>`;
        socket.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}Z\r\nPath:ssml\r\n\r\n${ssml}`);
      }));
    }

    function createEdgeEngine() {
      return {
        id: 'edge',
        available: typeof WebSocket !== 'undefined' && typeof crypto !== 'undefined' && crypto.subtle !== undefined,
        speak(request, handlers) {
          const text = stripMarkdown(request.text);
          const chunks = chunkText(text);
          if (chunks.length === 0) { handlers.onEnd(); return { cancel() {} }; }
          const lang = request.lang;
          const voice = request.voice !== ''
            ? request.voice
            : (NEURAL_AUTO_VOICE[lang] ?? NEURAL_AUTO_VOICE.en);
          const options = { lang, voice, volume: request.volume, rate: request.rate, pitch: request.pitch };
          const controller = new AbortController();
          let cancelled = false;
          let current = null;
          /** Seconds from now until the next 300-second DRM window begins. */
          const msToNextWindow = () => {
            const ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH_SECONDS;
            return ((300 - (ticks % 300)) + 2) * 1000;
          };
          (async () => {
            try {
              /** Synthesize one chunk with the same retry-once policy as before. */
              const synthesize = async (chunk) => {
                let retried = false;
                let parts;
                try {
                  parts = await edgeSynthesizeChunk(chunk, options, controller.signal);
                } catch (error) {
                  if (cancelled || retried || !(error instanceof Error) || !error.message.includes('edge-tts:')) throw error;
                  retried = true;
                  const rejected = error.message.includes('WebSocket 被拒绝');
                  if (rejected) {
                    // Connect rejection: the token window's admission is burned —
                    // wait for the next 300-second window and retry once.
                    const wait = msToNextWindow();
                    console.warn(`[dsh-tts] Edge 连接被限流，${Math.round(wait / 1000)} 秒后（下个窗口）自动重试一次`);
                    edgeDropSocket();
                    await new Promise((resolve) => setTimeout(resolve, wait));
                  } else {
                    // Transient mid-stream failure: a fresh connection usually
                    // re-admits immediately (the burned slot frees on close).
                    console.warn('[dsh-tts] Edge 连接中断，正在重连重试');
                    edgeDropSocket();
                    await new Promise((resolve) => setTimeout(resolve, 800));
                  }
                  if (cancelled) throw new Error('edge-tts: cancelled');
                  parts = await edgeSynthesizeChunk(chunk, options, controller.signal);
                }
                return parts;
              };
              /** Prefetch pipeline: synthesize chunk i+1 while chunk i plays. */
              let pending = synthesize(chunks[0]);
              for (let index = 0; index < chunks.length; index++) {
                if (cancelled) { pending.catch(() => {}); return; }
                const parts = await pending;
                if (cancelled) return;
                if (index + 1 < chunks.length) {
                  // Rotate the shared socket when the DRM window rolled over.
                  if (edgeSocketState.socket !== null && Date.now() >= edgeSocketState.windowExpiresAt) {
                    edgeDropSocket();
                  }
                  pending = synthesize(chunks[index + 1]);
                } else {
                  pending = null;
                }
                if (parts.length === 0) continue;
                const blob = new Blob(parts, { type: 'audio/mpeg' });
                const url = URL.createObjectURL(blob);
                if (cancelled) { URL.revokeObjectURL(url); pending?.catch(() => {}); return; }
                await new Promise((resolve) => {
                  const audio = new Audio(url);
                  current = {
                    stop() { audio.pause(); resolve(); },
                    // Pause BEFORE revoking: revoking the blob URL alone does
                    // not interrupt an already-buffered/playing element.
                    drop() { audio.pause(); audio.src = ''; URL.revokeObjectURL(url); resolve(); },
                  };
                  audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
                  audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
                  audio.play().catch(() => { URL.revokeObjectURL(url); resolve(); });
                });
                current = null;
              }
              if (!cancelled) handlers.onEnd();
            } catch (error) {
              if (!cancelled) handlers.onError(error);
            }
          })();
          return {
            cancel() {
              cancelled = true;
              controller.abort();
              current?.drop();
            },
          };
        },
        cancel() {
          // A cancelled utterance leaves the shared socket mid-turn; drop it so
          // the next request starts from a clean connection.
          edgeDropSocket();
        },
      };
    }

    // --- Azure Speech engine (official REST API, key + region) --------------

    /** Common Azure Speech regions for the datalist suggestions. */
    const AZURE_REGIONS = [
      'eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'centralus',
      'southcentralus', 'northcentralus', 'canadacentral', 'brazilsouth',
      'westeurope', 'northeurope', 'uksouth', 'francecentral',
      'germanywestcentral', 'norwayeast', 'swedencentral', 'switzerlandnorth',
      'eastasia', 'southeastasia', 'japaneast', 'koreacentral',
      'centralindia', 'australiaeast', 'uaenorth', 'southafricanorth',
    ];

    /** TTS REST endpoint of one region, as used by the official SDK. */
    function azureEndpoint(region) {
      const slug = String(region).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      return `https://${slug}.tts.speech.microsoft.com/cognitiveservices/v1`;
    }

    /** Synthesize one chunk via the Azure REST API; resolves to an audio Blob. */
    async function azureSynthesizeChunk(text, options, signal, auth) {
      const langTag = options.lang === 'zh' ? 'zh-CN' : 'en-US';
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langTag}'>`
        + `<voice name='${options.voice}'><prosody ${edgeProsody(options.volume, options.rate, options.pitch)}>${escapeXml(text)}</prosody></voice></speak>`;
      const response = await fetch(azureEndpoint(auth.region), {
        method: 'POST',
        signal,
        headers: {
          'Ocp-Apim-Subscription-Key': auth.key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        },
        body: ssml,
      });
      if (!response.ok) {
        const detail = response.status === 401 || response.status === 403
          ? '（密钥无效，或密钥与区域不匹配）'
          : response.status === 429 ? '（配额用尽或请求过于频繁）' : '';
        throw new Error(`azure-tts: HTTP ${response.status} ${response.statusText} ${detail}`.trim());
      }
      return response.blob();
    }

    function createAzureEngine(settings) {
      return {
        id: 'azure',
        get available() {
          const value = settings.value;
          return value.azureRegion.trim() !== '' && value.azureKey.trim() !== '';
        },
        speak(request, handlers) {
          const value = settings.value;
          const auth = { region: value.azureRegion, key: value.azureKey };
          if (auth.region.trim() === '' || auth.key.trim() === '') {
            handlers.onError(new Error('azure-tts: 区域或密钥未配置，请先在设置中填写 Azure Region 与 Key'));
            return { cancel() {} };
          }
          const text = stripMarkdown(request.text);
          const chunks = chunkText(text);
          if (chunks.length === 0) { handlers.onEnd(); return { cancel() {} }; }
          const voice = request.voice !== ''
            ? request.voice
            : (NEURAL_AUTO_VOICE[request.lang] ?? NEURAL_AUTO_VOICE.en);
          const options = { lang: request.lang, voice, volume: request.volume, rate: request.rate, pitch: request.pitch };
          const controller = new AbortController();
          let cancelled = false;
          let current = null;
          (async () => {
            try {
              /** Prefetch pipeline: synthesize chunk i+1 while chunk i plays. */
              const synthesize = (chunk) => azureSynthesizeChunk(chunk, options, controller.signal, auth);
              let pending = synthesize(chunks[0]);
              for (let index = 0; index < chunks.length; index++) {
                if (cancelled) { pending.catch(() => {}); return; }
                const blob = await pending;
                if (cancelled) return;
                pending = index + 1 < chunks.length ? synthesize(chunks[index + 1]) : null;
                if (blob === null || blob.size === 0) continue;
                const url = URL.createObjectURL(blob);
                await new Promise((resolve) => {
                  const audio = new Audio(url);
                  current = {
                    stop() { audio.pause(); resolve(); },
                    // Pause BEFORE revoking: revoking the blob URL alone does
                    // not interrupt an already-buffered/playing element.
                    drop() { audio.pause(); audio.src = ''; URL.revokeObjectURL(url); resolve(); },
                  };
                  audio.volume = Math.min(1, Math.max(0, options.volume / 100));
                  audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
                  audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
                  audio.play().catch(() => { URL.revokeObjectURL(url); resolve(); });
                });
                current = null;
              }
              if (!cancelled) handlers.onEnd();
            } catch (error) {
              if (!cancelled) handlers.onError(error);
            }
          })();
          return {
            cancel() {
              cancelled = true;
              controller.abort();
              current?.drop();
            },
          };
        },
        cancel() {},
      };
    }

    function resolveEngine(id, settings) {
      if (id === 'local') return createLocalEngine();
      if (id === 'azure') return createAzureEngine(settings);
      return createEdgeEngine();
    }

    // ---------------------------------------------------------------------------
    // Playback controller — one message at a time, buttons stay in sync
    // ---------------------------------------------------------------------------

    class TtsController {
      constructor(settings) {
        this.settings = settings;
        this.activeId = null;
        this.handle = null;
        this.listeners = new Set();
      }

      subscribe(listener) {
        this.listeners.add(listener);
        listener(this.activeId);
        return () => this.listeners.delete(listener);
      }

      #publish() { for (const listener of this.listeners) listener(this.activeId); }

      start(messageId, text) {
        if (this.activeId === messageId) return;
        this.#stopInternal();
        if (text.trim() === '') return;
        const settings = this.settings.value;
        const engine = resolveEngine(settings.engine, this.settings);
        if (!engine.available) return;
        this.activeId = messageId;
        this.#publish();
        this.handle = engine.speak(
          {
            text,
            lang: detectLang(text),
            voice: settings.voice,
            volume: settings.volume,
            rate: settings.rate,
            pitch: settings.pitch,
          },
          {
            onEnd: () => this.#finish(messageId),
            onError: (error) => {
              console.error('[dsh-tts]', error);
              this.#finish(messageId);
            },
          },
        );
      }

      stop() { this.#stopInternal(); this.#publish(); }

      #stopInternal() {
        if (this.handle !== null) {
          this.handle.cancel();
          this.handle = null;
        }
        this.activeId = null;
      }

      #finish(messageId) {
        if (this.activeId !== messageId) return;
        this.activeId = null;
        this.handle = null;
        this.#publish();
      }

      dispose() { this.#stopInternal(); this.listeners.clear(); }
    }

    // ---------------------------------------------------------------------------
    // Chat snapshot reading
    // ---------------------------------------------------------------------------

    /** Speakable text of one finalized assistant message, from the chat snapshot. */
    function messageText(snapshot, messageId) {
      if (snapshot === null || typeof snapshot !== 'object') return '';
      const nodes = snapshot.nodes;
      if (nodes === undefined || typeof nodes.values !== 'function') return '';
      for (const node of nodes.values()) {
        if (node?.kind !== 'assistant-step') continue;
        const data = node.data;
        const blocks = data?.finalNode?.messageId === messageId
          ? (data.finalNode.blocks ?? data.blocks)
          : undefined;
        if (blocks === undefined) continue;
        return blocks
          .filter((block) => block?.kind === 'text')
          .map((block) => block.text)
          .join('\n');
      }
      return '';
    }

    function useMessageText(chat, messageId) {
      const [text, setText] = useState(() => messageText(chat?.getSnapshot(), messageId));
      useEffect(() => {
        setText(messageText(chat?.getSnapshot(), messageId));
        if (chat === undefined) return undefined;
        return chat.subscribe(() => setText(messageText(chat.getSnapshot(), messageId)));
      }, [chat, messageId]);
      return text;
    }

    /** Every settled assistant message (newest last) with non-empty text. */
    function settledMessages(snapshot) {
      if (snapshot === null || typeof snapshot !== 'object') return [];
      const nodes = snapshot.nodes;
      if (nodes === undefined || typeof nodes.values !== 'function') return [];
      const found = [];
      for (const node of nodes.values()) {
        if (node?.kind !== 'assistant-step' || node.data?.status !== 'settled') continue;
        const messageId = node.data?.finalNode?.messageId;
        if (messageId === undefined) continue;
        const text = (node.data.finalNode.blocks ?? [])
          .filter((block) => block?.kind === 'text')
          .map((block) => block.text)
          .join('\n');
        if (text.trim() !== '') found.push({ messageId, text });
      }
      return found;
    }

    /** Auto-read: speak the newest settled reply once it lands. */
    function watchAutoRead(chat, settings, controller) {
      const seen = new Set();
      return chat.subscribe(() => {
        if (!settings.value.autoRead) return;
        const messages = settledMessages(chat.getSnapshot());
        const fresh = messages.filter((message) => !seen.has(message.messageId));
        for (const message of messages) seen.add(message.messageId);
        if (fresh.length === 0) return;
        const latest = fresh[fresh.length - 1];
        controller.start(latest.messageId, latest.text);
      });
    }

    // ---------------------------------------------------------------------------
    // Speaker button (assistant message action row)
    // ---------------------------------------------------------------------------

    const SPEAKER_ICON = h('svg', {
      viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true,
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    },
      h('path', { d: 'M11 5 6.5 8.5H3.5v7h3L11 19z', fill: 'currentColor', stroke: 'none' }),
      h('path', { d: 'M14.5 9.2a4 4 0 0 1 0 5.6' }),
      h('path', { d: 'M17 6.7a7.5 7.5 0 0 1 0 10.6' }));

    const STOP_ICON = h('svg', {
      viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true,
      fill: 'currentColor',
    }, h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 1.5 }));

    function actionButtonStyles(playing) {
      return {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, padding: 0, border: 'none', borderRadius: 6,
        background: 'transparent',
        color: playing ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
      };
    }

    function SpeakAction({ messageId, controller, chat, t }) {
      const [playing, setPlaying] = useState(false);
      const text = useMessageText(chat, messageId);

      useEffect(() => controller.subscribe((activeId) => setPlaying(activeId === messageId)),
        [controller, messageId]);

      if (text.trim() === '') return null;

      return h('button', {
        type: 'button',
        onClick: () => (playing ? controller.stop() : controller.start(messageId, text)),
        title: playing ? t('action.stop') : t('action.read'),
        'aria-label': playing ? t('action.stop') : t('action.read'),
        'aria-pressed': playing,
        style: actionButtonStyles(playing),
        onMouseEnter: (event) => { event.currentTarget.style.color = 'var(--dsw-alias-label-primary)'; },
        onMouseLeave: (event) => {
          event.currentTarget.style.color = playing
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-label-tertiary)';
        },
      }, playing ? STOP_ICON : SPEAKER_ICON);
    }

    // ---------------------------------------------------------------------------
    // Settings page
    // ---------------------------------------------------------------------------

    const ROW_STYLE = {
      display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 0',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
    };
    const LABEL_STYLE = { color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 };
    const HINT_STYLE = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 };
    const CONTROL_STYLE = {
      color: 'var(--dsw-alias-label-primary)', fontSize: 13,
      background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6,
      padding: '6px 8px', width: '100%', maxWidth: 320,
    };
    const PRIMARY_BUTTON_STYLE = {
      color: 'var(--dsw-alias-button-primary-fill)', cursor: 'pointer',
      fontSize: 13, fontWeight: 500,
      background: 'transparent',
      border: '1px solid var(--dsw-alias-brand-primary)', borderRadius: 6,
      padding: '6px 14px',
    };

    function row(labelKey, control, hintKey, t) {
      return h('div', { key: labelKey, style: ROW_STYLE },
        h('label', { style: LABEL_STYLE }, t(labelKey)),
        control,
        hintKey === undefined ? null : h('span', { style: HINT_STYLE }, t(hintKey)));
    }

    function useLocalVoices() {
      const [voices, setVoices] = useState([]);
      useEffect(() => {
        if (!('speechSynthesis' in window)) return undefined;
        const read = () => setVoices(window.speechSynthesis.getVoices());
        read();
        window.speechSynthesis.addEventListener('voiceschanged', read);
        return () => window.speechSynthesis.removeEventListener('voiceschanged', read);
      }, []);
      return voices;
    }

    function TtsSection({ settings, controller, t }) {
      const [, force] = useState(0);
      useEffect(() => settings.subscribe(() => force((n) => n + 1)), [settings]);
      const [testing, setTesting] = useState(false);
      const value = settings.value;
      const localVoices = useLocalVoices();

      useEffect(() => controller.subscribe((activeId) => setTesting(activeId === 'settings-test')),
        [controller]);

      const write = (field, next) => settings.set(field, next);

      const engineSelect = h('select', {
        style: CONTROL_STYLE, value: value.engine,
        onChange: (event) => write('engine', event.target.value),
      },
        h('option', { value: 'edge' }, t('settings.engine.edge')),
        h('option', { value: 'azure' }, t('settings.engine.azure')),
        h('option', { value: 'local' }, t('settings.engine.local')));

      const azureRows = value.engine === 'azure' ? [
        row('settings.azure.region', h('div', null,
          h('input', {
            type: 'text', list: 'dsh-tts-azure-regions', style: CONTROL_STYLE,
            value: value.azureRegion, placeholder: 'eastus',
            onChange: (event) => write('azureRegion', event.target.value.trim()),
          }),
          h('datalist', { id: 'dsh-tts-azure-regions' },
            AZURE_REGIONS.map((region) => h('option', { key: region, value: region }))),
        ), 'settings.azure.hint', t),
        row('settings.azure.key', h('input', {
          type: 'password', style: CONTROL_STYLE, autoComplete: 'off',
          value: value.azureKey, placeholder: '00000000000000000000000000000000',
          onChange: (event) => write('azureKey', event.target.value.trim()),
        }), undefined, t),
      ] : [];

      const azureMissing = value.engine === 'azure'
        && (value.azureRegion.trim() === '' || value.azureKey.trim() === '')
        ? h('div', { style: { ...HINT_STYLE, color: 'var(--dsw-alias-label-secondary)' } }, t('settings.azure.missing'))
        : null;

      const voiceOptions = value.engine === 'local'
        ? localVoices.map((voice) => h('option', { key: voice.name, value: voice.name },
          `${voice.name} (${voice.lang})`))
        : NEURAL_VOICES.map((voice) => h('option', { key: voice.name, value: voice.name }, voice.label));
      const voiceSelect = h('select', {
        style: CONTROL_STYLE, value: value.voice,
        onChange: (event) => write('voice', event.target.value),
      },
        h('option', { value: '' }, t('settings.voice.auto')),
        voiceOptions);

      const slider = (field, min, max, unit) => h('input', {
        type: 'range', min, max, step: 1, value: value[field],
        style: { width: '100%', maxWidth: 320, accentColor: 'var(--dsw-alias-brand-primary)' },
        onChange: (event) => write(field, Number(event.target.value)),
      });

      const autoSwitch = h('button', {
        type: 'button', role: 'switch', 'aria-checked': value.autoRead,
        onClick: () => write('autoRead', !value.autoRead),
        style: {
          width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
          border: '1px solid var(--dsw-alias-border-l2)', padding: 0,
          display: 'inline-flex', alignItems: 'center',
          justifyContent: value.autoRead ? 'flex-end' : 'flex-start',
          background: value.autoRead ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
          transition: 'background 0.15s, justify-content 0.15s',
        },
      }, h('span', {
        style: {
          width: 16, height: 16, borderRadius: '50%', margin: '0 2px', display: 'inline-block',
          background: value.autoRead ? '#ffffff' : 'var(--dsw-alias-label-tertiary)',
        },
      }));

      const testButton = h('button', {
        type: 'button', style: PRIMARY_BUTTON_STYLE,
        onClick: () => {
          if (testing) { controller.stop(); return; }
          controller.start('settings-test', t('test.sentence'));
        },
      }, testing ? t('settings.test.stop') : t('settings.test'));

      return h('div', null,
        settings.status === 'ready' ? null : h('div', { style: HINT_STYLE }, t('settings.unavailable')),
        row('settings.engine', engineSelect, undefined, t),
        ...azureRows,
        azureMissing,
        row('settings.voice', voiceSelect, undefined, t),
        row('settings.volume', h('div', null, slider('volume', 0, 100), h('span', { style: HINT_STYLE }, `${value.volume}%`)), undefined, t),
        row('settings.rate', h('div', null, slider('rate', 50, 200), h('span', { style: HINT_STYLE }, `${value.rate}%`)), undefined, t),
        row('settings.pitch', h('div', null, slider('pitch', -50, 50), h('span', { style: HINT_STYLE }, `${value.pitch > 0 ? '+' : ''}${value.pitch}`)), undefined, t),
        row('settings.autoRead', autoSwitch, 'settings.autoRead.hint', t),
        row('settings.test', testButton, undefined, t));
    }

    // ---------------------------------------------------------------------------
    // Plugin entry
    // ---------------------------------------------------------------------------

    // 'configForms' is optional and injected lazily below: the core (speaker
    // button + settings page with in-memory fallback) activates without it.
    const inject = ['slots', 'locale', 'sessions', 'uiConversation'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tts: dictionaries');

      const settings = createSettingsStore(null);
      ctx.effect(() => () => settings.dispose(), 'dsh-tts: settings store');
      ctx.inject(['configForms'], (scope) => {
        try {
          settings.attach(scope.configForms.get(SETTINGS_NAMESPACE));
        } catch (error) {
          console.warn('[dsh-tts] settings form unavailable, using in-memory settings', error);
        }
      });

      const controller = new TtsController(settings);
      ctx.effect(() => () => controller.dispose(), 'dsh-tts: playback controller');

      // One auto-read watcher per session, reused across slot remounts.
      const autoWatchers = new Map();
      ctx.effect(() => () => {
        for (const dispose of autoWatchers.values()) dispose();
        autoWatchers.clear();
      }, 'dsh-tts: auto-read watchers');

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'dsh-tts',
        order: 20,
        locale: NS,
        inject: (sessionId) => {
          let chat;
          try {
            chat = ctx.uiConversation.binding(sessionId).target('chat');
          } catch {
            chat = undefined;
          }
          if (chat !== undefined && !autoWatchers.has(sessionId)) {
            autoWatchers.set(sessionId, watchAutoRead(chat, settings, controller));
          }
          return { controller, chat };
        },
      }, SpeakAction));

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'tts',
        order: 40,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS,
        inject: () => ({ settings, controller }),
      }, TtsSection));
    }

    return { inject, apply };
  },
});
