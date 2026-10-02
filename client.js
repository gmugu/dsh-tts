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
      'action.plan.read': '朗读计划',
      'settings.engine': '语音合成服务',
      'settings.engine.local': '浏览器本地合成',
      'settings.engine.edge': 'Edge 在线语音（免密钥）',
      'settings.engine.azure': 'Azure 语音服务（官方接口）',
      'settings.engine.qwen': '千问 Token Plan（套餐额度）',
      'settings.qwen.hint': '使用宿主已配置的 QWEN_TOKEN_PLAN_CN_API_KEY（千问 Token 套餐密钥，非百炼），按字符消耗套餐额度，无需在浏览器填密钥。',
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
      'action.plan.read': 'Read plan aloud',
      'settings.engine': 'Speech service',
      'settings.engine.local': 'Browser speechSynthesis',
      'settings.engine.edge': 'Edge online voices (no key)',
      'settings.engine.azure': 'Azure Speech Service',
      'settings.engine.qwen': 'Qwen Token Plan (subscription quota)',
      'settings.qwen.hint': 'Uses the QWEN_TOKEN_PLAN_CN_API_KEY stored on the host (Qwen Token Plan subscription, not Bailian); characters count against the plan quota. No key needed in the browser.',
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

    /** Hard-cut fallback for a single segment that still exceeds the limit
     *  (no punctuation at all, e.g. a long URL) — used only as a last resort.
     *  Latin-heavy text is cut at a word boundary (space) instead of through
     *  the middle of a word. */
    function hardCut(piece, limit) {
      const out = [];
      while (piece.length > limit) {
        let cut = limit;
        if (/[A-Za-z]/.test(piece.slice(Math.max(0, limit - 30), limit))) {
          const space = piece.lastIndexOf(' ', limit);
          if (space > limit * 0.6) cut = space + 1;
        }
        out.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      if (piece !== '') out.push(piece);
      return out;
    }

    /** Split one overlong sentence at secondary boundaries: commas and — for
     *  Latin text — word spaces, so English is never cut mid-word. */
    function splitLongSentence(sentence, limit) {
      const parts = sentence.match(/[^,，、;;::——– ]+[,，、;;::——– ]*/g) ?? [sentence];
      const out = [];
      let buffer = '';
      for (const part of parts) {
        if (buffer !== '' && buffer.length + part.length > limit) {
          out.push(buffer);
          buffer = part;
        } else {
          buffer += part;
        }
      }
      if (buffer !== '') out.push(buffer);
      // No secondary punctuation either → hard cut.
      return out.flatMap((piece) => (piece.length > limit ? hardCut(piece, limit) : [piece]));
    }

    /** Placeholder shielding decimal points ("3.14", "v1.2.3") from being
     *  read as sentence terminators during the split. */
    const DECIMAL_SHIELD = '\u0001';
    const shieldDecimals = (text) => text.replace(/(\d)[.](\d)/g, `$1${DECIMAL_SHIELD}$2`);
    const unshieldDecimals = (text) => text.split(DECIMAL_SHIELD).join('.');

    /** Split long text into utterance-sized chunks, packing WHOLE sentences:
     *  primary boundaries are sentence terminators (。！？；!?;. and line
     *  breaks; a "." between digits is a decimal, NOT a terminator), never a
     *  hard cut mid-sentence; an overlong sentence first falls back to
     *  comma-level boundaries, and only a segment without any punctuation is
     *  hard-cut (Latin text at word boundaries). */
    function chunkText(text, limit = 200) {
      const chunks = [];
      let buffer = '';
      const sentences = shieldDecimals(text)
        .match(/[^。！？；!?;\n]+[。！？；!?;.]*\n*|\n+/g) ?? [shieldDecimals(text)];
      for (const sentence of sentences) {
        const pieces = sentence.length > limit ? splitLongSentence(sentence, limit) : [sentence];
        for (const piece of pieces) {
          if (buffer !== '' && buffer.length + piece.length > limit) {
            chunks.push(buffer);
            buffer = piece;
          } else {
            buffer += piece;
          }
        }
      }
      if (buffer !== '') chunks.push(buffer);
      return chunks
        .filter((chunk) => chunk.trim() !== '')
        .map(unshieldDecimals);
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
      volume: 100, rate: 100, pitch: 0,
    };

    // --- Auto-read switch: browser-local (per device), NOT host-persisted ----
    const AUTO_READ_KEY = 'dsh-tts.autoRead';

    function readAutoRead() {
      try {
        return window.localStorage.getItem(AUTO_READ_KEY) === '1';
      } catch {
        return false;
      }
    }

    function writeAutoRead(value) {
      try {
        window.localStorage.setItem(AUTO_READ_KEY, value ? '1' : '0');
      } catch { /* storage unavailable (private mode): in-memory only */ }
    }

    /** Live view over the settings form (Host-persisted) with an in-memory
     *  fallback; the autoRead flag is overlaid from localStorage. */
    function createSettingsStore(form) {
      const listeners = new Set();
      const notify = () => { for (const listener of listeners) listener(); };
      const memory = { ...DEFAULT_SETTINGS };
      let autoRead = readAutoRead();
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
          const base = stored === null ? memory : { ...DEFAULT_SETTINGS, ...stored };
          return { ...base, autoRead };
        },
        get status() { return live === null ? 'unavailable' : live.getSnapshot().status; },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set: (field, value) => {
          // The auto-read switch is a per-device preference: localStorage only.
          if (field === 'autoRead') {
            autoRead = Boolean(value);
            writeAutoRead(autoRead);
            notify();
            return;
          }
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

    /**
     * Qwen Token Plan TTS voices — the gateway rejects CosyVoice names
     * (Engine error 411); only this model's own set works (verified live).
     * All three support Chinese (Mandarin) and English.
     */
    const QWEN_VOICES = [
      { name: 'longanhuan_v3.6', label: '龙安欢 Longanhuan (女, 默认)' },
      { name: 'longanlingxin', label: '龙安凌心 Lingxin (女, 温暖)' },
      { name: 'longanlufeng', label: '龙安露锋 Lufeng (男, 明亮)' },
    ];
    const QWEN_AUTO_VOICE = 'longanhuan_v3.6';

    // ---------------------------------------------------------------------------
    // Engine layer — one interface, two implementations
    //
    // TtsEngine: {
    //   available: boolean
    //   speak(request: { text, lang, voice, volume, rate, pitch }, h: { onEnd, onError }) -> { cancel() }
    // }
    // ---------------------------------------------------------------------------

    // --- Shared, gesture-unlocked audio element ------------------------------
    //
    // iOS/WebKit autoplay policy: programmatic play() only works on an element
    // that has played once INSIDE a user gesture. Per-chunk `new Audio()` is
    // therefore always rejected on iOS PWA (auto-read dies instantly). Keep
    // ONE element, unlock it on the first pointer/key interaction with a
    // silent clip, and reuse it for every utterance afterwards.
    const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    let sharedAudio = null;
    let sharedCtx = null;
    let audioUnlocked = false;
    /** True while the shared element carries a playing/settling utterance. */
    let audioInUse = false;
    const unlockListeners = [];

    function sharedAudioElement() {
      if (sharedAudio === null) {
        sharedAudio = new Audio();
        sharedAudio.preload = 'auto';
      }
      return sharedAudio;
    }

    /** Lazily-created shared AudioContext for the PCM Web Audio sink. iOS
     *  keeps it suspended until a resume() inside a user gesture. */
    function sharedAudioContext() {
      if (sharedCtx === null) {
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (AC === undefined) return null;
        sharedCtx = new AC();
      }
      return sharedCtx;
    }

    /** Unlock the shared element inside the gesture it is called from.
     *  NEVER while speech is using the element: swapping src mid-playback
     *  would cut the utterance off. A blocked attempt retries on the next
     *  interaction until it succeeds. The AudioContext resumes here too —
     *  iOS requires the same gesture for Web Audio. */
    function unlockAudio() {
      const ctx = sharedAudioContext();
      if (ctx !== null && ctx.state === 'suspended') {
        ctx.resume().catch(() => { /* retry on the next gesture */ });
      }
      if (audioUnlocked || audioInUse || typeof window === 'undefined') return;
      const audio = sharedAudioElement();
      if (audio.currentSrc !== '' || !audio.paused) return;
      audio.src = SILENT_WAV;
      const played = audio.play();
      if (played !== undefined) {
        played.then(() => {
          // The element played once inside a gesture: blessed from now on.
          audioUnlocked = true;
          // Keep the gesture listeners while the AudioContext still needs a
          // resume; drop them once both channels are unlocked.
          const ctxSettled = sharedCtx === null || sharedCtx.state === 'running';
          if (ctxSettled) {
            for (const [type, listener] of unlockListeners) {
              window.removeEventListener(type, listener, { capture: true });
            }
            unlockListeners.length = 0;
          }
          // Speech may have claimed the element while this promise was in
          // flight — never pause/flush it then, that would cut the utterance.
          if (audioInUse) return;
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        }).catch(() => {
          // Rejected (gesture not accepted, e.g. pointerdown on some WebKit):
          // clean the source so a later attempt isn't blocked by the
          // currentSrc check — but only while the element is idle.
          if (audioInUse) return;
          audio.removeAttribute('src');
          audio.load();
        });
      }
    }

    if (typeof window !== 'undefined') {
      // Any first interaction (opening the PWA, tapping send, ...) unlocks.
      for (const type of ['pointerdown', 'touchend', 'keydown']) {
        const listener = unlockAudio;
        unlockListeners.push([type, listener]);
        window.addEventListener(type, listener, { once: false, capture: true });
      }
    }

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
                  // Shared, gesture-unlocked element (iOS autoplay policy).
                  const audio = sharedAudioElement();
                  audio.src = url;
                  /** Detach the element from this chunk and let the browser
                   *  close the audio output stream: pause, drop the source,
                   *  run load() to flush, revoke the blob URL. */
                  const release = () => {
                    audioInUse = false;
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();
                    URL.revokeObjectURL(url);
                    resolve();
                  };
                  current = {
                    stop() { audio.pause(); resolve(); },
                    drop() { release(); },
                  };
                  audio.onended = release;
                  audio.onerror = release;
                  audioInUse = true;
                  audio.play().catch((error) => {
                    if (error?.name === 'NotAllowedError') {
                      console.warn('[dsh-tts] 自动播放被系统拒绝：请先点击一次页面任意位置以解锁声音（iOS PWA 首次使用需要）');
                    }
                    release();
                  });
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

    /**
     * Sequential playback over a sliding prefetch window: keep `windowSize`
     * synthesis requests in flight ahead of the chunk currently playing.
     * Chunks play strictly in order; a synthesis failure aborts the run (the
     * caller decides whether to skip to the next message). Results are
     * wrapped so a queued promise never becomes an unhandled rejection when
     * playback is cancelled mid-window.
     */
    async function runPrefetchedPlayback(chunks, synthesize, windowSize, isCancelled, playChunk) {
      let nextIndex = 0;
      const inflight = [];
      const fill = () => {
        while (inflight.length < windowSize && nextIndex < chunks.length) {
          const index = nextIndex++;
          inflight.push(
            Promise.resolve()
              .then(() => synthesize(chunks[index]))
              .then((result) => ({ result }), (error) => ({ error })),
          );
        }
      };
      fill();
      while (inflight.length > 0) {
        const settled = await inflight.shift();
        fill();
        if (isCancelled()) return;
        if (settled.error !== undefined) throw settled.error;
        await playChunk(settled.result);
        if (isCancelled()) return;
      }
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
              /** Sliding prefetch window: keep `windowSize` synthesis requests
               *  in flight ahead of playback for extra scheduling margin. */
              const synthesize = (chunk) => azureSynthesizeChunk(chunk, options, controller.signal, auth);
              await runPrefetchedPlayback(chunks, synthesize, 2, () => cancelled, (blob) => new Promise((resolve) => {
                if (blob === null || blob.size === 0) { resolve(); return; }
                const url = URL.createObjectURL(blob);
                // Shared, gesture-unlocked element (iOS autoplay policy).
                const audio = sharedAudioElement();
                audio.src = url;
                /** Detach the element from this chunk and let the browser
                 *  close the audio output stream: pause, drop the source,
                 *  run load() to flush, revoke the blob URL. */
                const release = () => {
                  audioInUse = false;
                  audio.pause();
                  audio.removeAttribute('src');
                  audio.load();
                  URL.revokeObjectURL(url);
                  resolve();
                };
                current = {
                  stop() { audio.pause(); resolve(); },
                  drop() { release(); },
                };
                // Volume is already applied in the SSML prosody server-side;
                // setting audio.volume too would attenuate it twice.
                audio.onended = release;
                audio.onerror = release;
                audioInUse = true;
                audio.play().catch((error) => {
                  if (error?.name === 'NotAllowedError') {
                    console.warn('[dsh-tts] 自动播放被系统拒绝：请先点击一次页面任意位置以解锁声音（iOS PWA 首次使用需要）');
                  }
                  release();
                });
              }));
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

    // --- Qwen Token Plan engine (host-proxied SSE streaming) -----------------

    function base64ToBytes(b64) {
      const binary = atob(b64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }

    /** Detach the shared element and close the audio output stream. */
    const releaseSharedAudio = () => {
      audioInUse = false;
      const audio = sharedAudioElement();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };

    /**
     * Async iterator of MP3 byte pieces from the host's SSE passthrough.
     * The gateway emits sentence-begin / sentence-synthesis (base64 audio) /
     * sentence-end / final events; only the audio matters here. Measured:
     * first byte in ~0.65s, each piece ≈ 1.4s of audio.
     */
    async function* qwenSseAudioPieces(response) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let split;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = rawEvent.split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5))
            .join('\n');
          if (data === '' || data === '[DONE]') continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event?.code !== undefined && event?.code !== null) {
            throw new Error(`qwen-tts: ${event.code} ${event?.message ?? ''}`.trim());
          }
          const b64 = event?.output?.audio?.data;
          if (typeof b64 === 'string' && b64 !== '') yield base64ToBytes(b64);
        }
      }
    }

    /**
     * MediaSource sink: append MP3 pieces for gapless progressive playback
     * (Chromium/Firefox support audio/mpeg in MSE). Returns null where it is
     * unsupported — Safari/iOS — so the caller falls back to the sink below.
     */
    function createMseSink() {
      if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported?.('audio/mpeg')) return null;
      const mediaSource = new MediaSource();
      const audio = sharedAudioElement();
      const url = URL.createObjectURL(mediaSource);
      audio.src = url;
      audioInUse = true;
      let sourceBuffer = null;
      let queue = [];
      let ended = false;
      let failure = null;
      const flush = () => {
        if (failure !== null) return;
        if (sourceBuffer === null) return;
        if (queue.length === 0) {
          if (ended && !sourceBuffer.updating && mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream(); } catch { /* already ended */ }
          }
          return;
        }
        if (sourceBuffer.updating) return;
        try {
          sourceBuffer.appendBuffer(queue.shift());
        } catch (error) {
          failure = error;
        }
      };
      mediaSource.addEventListener('sourceopen', () => {
        try {
          sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
        } catch (error) {
          failure = error;
          return;
        }
        sourceBuffer.addEventListener('updateend', flush);
        flush();
        audio.play().catch((error) => {
          if (error?.name === 'NotAllowedError') {
            console.warn('[dsh-tts] 自动播放被系统拒绝：请先点击一次页面任意位置以解锁声音（iOS PWA 首次使用需要）');
          }
        });
      });
      return {
        append(piece) {
          if (failure !== null) return Promise.reject(failure);
          queue.push(piece);
          flush();
          return Promise.resolve();
        },
        finished() {
          ended = true;
          flush();
          return new Promise((resolve) => {
            audio.onended = () => { releaseSharedAudio(); URL.revokeObjectURL(url); resolve(); };
            audio.onerror = () => { releaseSharedAudio(); URL.revokeObjectURL(url); resolve(); };
          });
        },
        stop() {
          releaseSharedAudio();
          URL.revokeObjectURL(url);
        },
      };
    }

    /**
     * PCM Web Audio sink for the streaming engine: the gateway streams RAW
     * s16le PCM pieces, which have no inter-frame dependencies (unlike MP3,
     * whose bit reservoir made per-piece decoding sound rustly). Each piece
     * is converted to an AudioBuffer and scheduled sample-accurately at the
     * running playhead — gapless AND artifact-free. Bandwidth is ~48 KB/s.
     */
    function createPcmSink(sampleRate) {
      const ctx = sharedAudioContext();
      if (ctx === null) return null;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const sources = [];
      let stopped = false;
      let playheadEnd = 0;
      let sawAudio = false;
      let settled = false;
      let finishResolve = null;
      let finishReject = null;
      const finishedPromise = new Promise((resolve, reject) => { finishResolve = resolve; finishReject = reject; });
      audioInUse = true;

      /** Schedule one PCM piece; while the context is still suspended (no
       *  user gesture yet) the piece is parked until it runs. */
      const parked = [];
      const schedule = (bytes) => {
        const frames = Math.floor(bytes.byteLength / 2);
        if (frames === 0) return;
        const ints = new Int16Array(bytes.buffer, bytes.byteOffset, frames);
        const buffer = ctx.createBuffer(1, frames, sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) channel[i] = ints[i] / 32768;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        const startAt = Math.max(ctx.currentTime + 0.05, playheadEnd);
        source.start(startAt);
        sources.push(source);
        playheadEnd = startAt + buffer.duration;
        sawAudio = true;
      };

      const onState = () => {
        if (ctx.state !== 'running') return;
        for (const piece of parked.splice(0, parked.length)) schedule(piece);
        checkFinished();
      };
      ctx.addEventListener('statechange', onState);

      const checkFinished = () => {
        if (stopped || settled) return;
        if (parked.length > 0 || ctx.state !== 'running') return;
        if (playheadEnd <= ctx.currentTime + 0.05) {
          settled = true;
          audioInUse = false;
          try { gain.disconnect(); } catch { /* noop */ }
          if (sawAudio) finishResolve();
          else finishReject(new Error('qwen-tts: 未收到任何音频数据'));
        }
      };
      const finishTimer = setInterval(checkFinished, 500);

      return {
        append(piece) {
          if (stopped) return Promise.resolve();
          if (ctx.state === 'running') schedule(piece);
          else parked.push(piece);
          return Promise.resolve();
        },
        finished() {
          // The stream's end does not end the audio; resolve when the
          // playhead drains.
          return finishedPromise.finally(() => {
            clearInterval(finishTimer);
            ctx.removeEventListener('statechange', onState);
          });
        },
        stop() {
          if (stopped) return;
          stopped = true;
          settled = true;
          clearInterval(finishTimer);
          ctx.removeEventListener('statechange', onState);
          for (const source of sources) {
            try { source.stop(); } catch { /* already ended */ }
          }
          try { gain.disconnect(); } catch { /* noop */ }
          audioInUse = false;
          finishResolve();
        },
      };
    }

    /** Bytes of MP3 to buffer before the FIRST blob starts playing on the
     *  sequential sink (≈4s at 48 kbps). Starting on the first tiny piece
     *  caused rapid blob switches — each src swap costs a decode gap on
     *  Safari/iOS — heard as stutter at the beginning of playback. */
    const SEQUENCE_START_THRESHOLD_BYTES = 24576;

    /**
     * Sequential-blob sink (Safari/iOS fallback): buffer a few seconds of
     * audio before the first play; while it plays, later pieces accumulate
     * and the next switch plays everything received so far — few switches
     * total, so the per-switch decode gap is rarely audible.
     */
    function createSequenceSink() {
      const audio = sharedAudioElement();
      audioInUse = true;
      const pending = [];
      let pendingBytes = 0;
      let started = false;
      let stopped = false;
      let streamEnded = false;
      let idle = true;
      let finishResolve = null;
      const finishedPromise = new Promise((resolve) => { finishResolve = resolve; });

      const settleIfDone = () => {
        if (idle && pending.length === 0 && streamEnded) {
          releaseSharedAudio();
          finishResolve();
        }
      };

      const playNext = () => {
        if (stopped) return;
        if (pending.length === 0) {
          idle = true;
          settleIfDone();
          return;
        }
        idle = false;
        pendingBytes = 0;
        const blob = new Blob(pending.splice(0, pending.length), { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        audio.src = url;
        const advance = () => { URL.revokeObjectURL(url); playNext(); };
        audio.onended = advance;
        audio.onerror = advance;
        audio.play().catch((error) => {
          if (error?.name === 'NotAllowedError') {
            console.warn('[dsh-tts] 自动播放被系统拒绝：请先点击一次页面任意位置以解锁声音（iOS PWA 首次使用需要）');
          }
          advance();
        });
      };

      return {
        append(piece) {
          pending.push(piece);
          pendingBytes += piece.byteLength ?? piece.length ?? 0;
          // First play waits for the start threshold (or stream end) so the
          // opening is not chopped into tiny blobs; afterwards flush freely.
          if (!started && (pendingBytes >= SEQUENCE_START_THRESHOLD_BYTES || streamEnded)) {
            started = true;
            playNext();
          } else if (started && idle) {
            playNext();
          }
          return Promise.resolve();
        },
        async finished() {
          streamEnded = true;
          if (!started) {
            started = true;
            playNext();
          }
          settleIfDone();
          await finishedPromise;
        },
        stop() {
          stopped = true;
          releaseSharedAudio();
          finishResolve();
        },
      };
    }

    function createQwenEngine() {
      return {
        id: 'qwen',
        available: true,
        speak(request, handlers) {
          const text = stripMarkdown(request.text);
          if (text.trim() === '') { handlers.onEnd(); return { cancel() {} }; }
          const controller = new AbortController();
          let cancelled = false;
          let sink = null;
          (async () => {
            try {
              // Channel selection up front, because the CODEC depends on it:
              // - MSE (Chromium/Firefox): MP3, appended gaplessly.
              // - Web Audio (Safari/iOS): raw PCM, scheduled sample-accurate
              //   gapless (MP3 cannot be split per piece — bit reservoir).
              // - Sequential blobs (no Web Audio at all): MP3 element play.
              const useMse = typeof MediaSource !== 'undefined'
                && MediaSource.isTypeSupported?.('audio/mpeg') === true;
              const usePcm = !useMse && sharedAudioContext() !== null;
              // ONE streaming request for the whole text: the gateway splits
              // sentences itself (natural prosody) and streams audio pieces;
              // playback starts with the first piece (~1-2s).
              const response = await fetch('/dsh-tts/qwen-tts', {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text,
                  format: usePcm ? 'pcm' : 'mp3',
                  sample_rate: 24000,
                  voice: request.voice !== '' ? request.voice : QWEN_AUTO_VOICE,
                  rate: request.rate / 100,
                  volume: request.volume,
                  pitch: 1 + request.pitch / 100,
                }),
              });
              if (!response.ok) {
                let message = `HTTP ${response.status}`;
                try {
                  const body = await response.json();
                  if (body?.message !== undefined) message = String(body.message);
                  else if (body?.error !== undefined) message = String(body.error);
                } catch { /* non-JSON error body */ }
                throw new Error(`qwen-tts: ${message}`);
              }
              if (response.body === null) throw new Error('qwen-tts: 宿主未返回音频流');
              // The host DECLARES the actual codec in a response header —
              // the only reliable signal (PCM speech bytes often start with
              // an MP3-like 0xFF 0xFF, so sniffing would misfire). A missing
              // header means a stale host: fall back to MP3 blob playback.
              const actualFormat = response.headers.get('x-dsh-tts-format') ?? 'mp3';
              const pcmStream = usePcm && actualFormat === 'pcm';
              sink = useMse ? createMseSink() : pcmStream ? createPcmSink(24000) : createSequenceSink();
              if (usePcm && !pcmStream) {
                console.warn('[dsh-tts] 宿主未返回 PCM（未重启或旧版），降级为整段播放');
              }
              for await (const piece of qwenSseAudioPieces(response)) {
                if (cancelled) return;
                await sink.append(piece);
                if (cancelled) return;
              }
              if (cancelled) return;
              await sink.finished();
              if (!cancelled) handlers.onEnd();
            } catch (error) {
              if (!cancelled) handlers.onError(error);
            }
          })();
          return {
            cancel() {
              cancelled = true;
              controller.abort();
              sink?.stop();
            },
          };
        },
        cancel() {},
      };
    }

    function resolveEngine(id, settings) {
      if (id === 'local') return createLocalEngine();
      if (id === 'azure') return createAzureEngine(settings);
      if (id === 'qwen') return createQwenEngine();
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
        /** Queued auto-read items, played strictly in order. */
        this.queue = [];
        this.listeners = new Set();
      }

      subscribe(listener) {
        this.listeners.add(listener);
        listener(this.activeId);
        return () => this.listeners.delete(listener);
      }

      #publish() { for (const listener of this.listeners) listener(this.activeId); }

      /** Manual play: interrupt whatever runs and clear the pending queue. */
      start(messageId, text) {
        this.queue.length = 0;
        this.#stopInternal();
        if (text.trim() === '') return;
        this.#speakNow(messageId, text);
      }

      /** Auto-read: never interrupts — queued while something is playing. */
      enqueueAuto(messageId, text) {
        if (this.activeId === messageId) return;
        if (this.activeId !== null || this.queue.length > 0) {
          if (!this.queue.some((item) => item.messageId === messageId)) {
            this.queue.push({ messageId, text });
          }
          return;
        }
        this.#speakNow(messageId, text);
      }

      #speakNow(messageId, text) {
        const settings = this.settings.value;
        const engine = resolveEngine(settings.engine, this.settings);
        if (!engine.available) return false;
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
            onEnd: () => this.#advance(messageId),
            onError: (error) => {
              console.error('[dsh-tts]', error);
              this.#advance(messageId);
            },
          },
        );
        return true;
      }

      stop() {
        this.queue.length = 0;
        this.#stopInternal();
        this.#publish();
      }

      #stopInternal() {
        if (this.handle !== null) {
          this.handle.cancel();
          this.handle = null;
        }
        this.activeId = null;
      }

      /** A playback finished (end or error): continue with the next queued item.
       *  Skips past items whose engine turned unavailable mid-queue (e.g. the
       *  Azure key was cleared), otherwise the queue would stall forever. */
      #advance(messageId) {
        if (this.activeId !== messageId) return;
        this.activeId = null;
        this.handle = null;
        let next = this.queue.shift();
        while (next !== undefined && !this.#speakNow(next.messageId, next.text)) {
          next = this.queue.shift();
        }
        if (next !== undefined) return;
        this.#publish();
      }

      dispose() { this.queue.length = 0; this.#stopInternal(); this.listeners.clear(); }
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

    /** Whether any assistant node is still streaming (turn not finished). */
    function hasRunningAssistant(snapshot) {
      if (snapshot === null || typeof snapshot !== 'object') return false;
      const nodes = snapshot.nodes;
      if (nodes === undefined || typeof nodes.values !== 'function') return false;
      for (const node of nodes.values()) {
        if (node?.kind === 'assistant-step' && node.data?.status === 'running') return true;
      }
      return false;
    }

    /** Auto-read: speak the newest settled reply once its turn completes. */
    function watchAutoRead(chat, settings, controller) {
      const seen = new Set();
      let seeded = false;
      return chat.subscribe(() => {
        const snapshot = chat.getSnapshot();
        // First observation only registers the history already on screen —
        // enabling auto-read (or rebinding after a reconnect) never replays
        // old messages aloud.
        if (!seeded) {
          seeded = true;
          for (const message of settledMessages(snapshot)) seen.add(message.messageId);
          return;
        }
        if (!settings.value.autoRead) return;
        // A still-running assistant node means the turn is incomplete: reading
        // now would speak a partial reply and be interrupted by the next
        // settle. Wait for the turn to finish (its final event refires this).
        if (hasRunningAssistant(snapshot)) return;
        const messages = settledMessages(snapshot);
        const fresh = messages.filter((message) => !seen.has(message.messageId));
        for (const message of messages) seen.add(message.messageId);
        if (fresh.length === 0) return;
        const latest = fresh[fresh.length - 1];
        controller.enqueueAuto(latest.messageId, latest.text);
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
    // Speaker button + auto-read for presented plans (plan review card)
    // ---------------------------------------------------------------------------

    /** Plan reviews already auto-read. Persisted in localStorage: a pending
     *  review must not replay after every page reload / PWA relaunch — only
     *  once per device until it is answered or replaced. */
    const PLAN_AUTO_READ_SEEN_KEY = 'dsh-tts.planAutoReadSeen';

    function loadPlanAutoReadSeen() {
      try {
        return new Set(JSON.parse(window.localStorage.getItem(PLAN_AUTO_READ_SEEN_KEY) ?? '[]'));
      } catch {
        return new Set();
      }
    }

    function savePlanAutoReadSeen(set) {
      try {
        // Keep the most recent 50 identities.
        window.localStorage.setItem(PLAN_AUTO_READ_SEEN_KEY, JSON.stringify([...set].slice(-50)));
      } catch { /* storage unavailable: in-memory dedupe only */ }
    }

    /**
     * Invisible occupant of the plan review card: enqueues the presented
     * plan for auto-read when the switch is on. The visible button lives on
     * the preview pane's floating speaker instead, so this renders nothing.
     */
    function PlanReviewAutoRead({ review, requestKey, controller, settings }) {
      const text = typeof review?.plan === 'string' ? review.plan : '';
      const speakId = `plan-review:${requestKey ?? review?.callId ?? 'unknown'}`;

      // Auto-read the presented plan once PER DEVICE, when the switch is on.
      useEffect(() => {
        const seen = loadPlanAutoReadSeen();
        const isSeen = () => seen.has(speakId);
        if (text.trim() === '' || isSeen()) return undefined;
        const maybeEnqueue = () => {
          if (!settings.value.autoRead || isSeen()) return;
          seen.add(speakId);
          savePlanAutoReadSeen(seen);
          controller.enqueueAuto(speakId, text);
        };
        maybeEnqueue();
        const off = settings.subscribe(maybeEnqueue);
        return () => { off(); };
      }, [controller, settings, speakId, text]);

      return null;
    }

    // ---------------------------------------------------------------------------
    // Floating speak button inside each plan preview pane (all platforms)
    // ---------------------------------------------------------------------------

    const SPEAKER_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 8.5H3.5v7h3L11 19z" fill="currentColor" stroke="none"/><path d="M14.5 9.2a4 4 0 0 1 0 5.6"/><path d="M17 6.7a7.5 7.5 0 0 1 0 10.6"/></svg>';
    const STOP_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';

    /**
     * The plan preview pane body is ui-plan's exclusive keyed seat, and the
     * tab's context menu needs a right click — which mobile does not have.
     * So inject one small floating speaker button into every mounted
     * [data-plan-preview] pane (top-right corner). Panes mount/unmount with
     * the sidebar; a body-level MutationObserver adds buttons as panes
     * appear, and pane removal takes its button along (it is a child node).
     */
    /** Whether the controller is currently reading ANY plan: the auto-read
     *  path ids plans as `plan-review:<…>` while the overlay buttons use
     *  `plan-pane:<…>` — the playing state must cover both. */
    const planReading = (activeId) => typeof activeId === 'string'
      && (activeId.startsWith('plan-review:') || activeId.startsWith('plan-pane:'));

    function mountPlanSpeakOverlays(ctx, controller) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
      const t = ctx.locale.bind(NS);
      const buttons = new Set();

      const paint = (button) => {
        const playing = planReading(controller.activeId);
        button.innerHTML = playing ? STOP_SVG : SPEAKER_SVG;
        button.title = playing ? t('action.stop') : t('action.plan.read');
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(playing));
        button.style.color = playing ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)';
      };

      const paintAll = () => {
        for (const button of [...buttons]) {
          if (!button.isConnected) { buttons.delete(button); continue; }
          paint(button);
        }
      };

      const scan = () => {
        for (const pane of document.querySelectorAll('[data-plan-preview]')) {
          if (pane.querySelector('[data-dsh-tts-plan-speak]') !== null) continue;
          const key = pane.getAttribute('data-plan-preview') || 'plan';
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('data-dsh-tts-plan-speak', key);
          Object.assign(button.style, {
            position: 'absolute', top: '6px', right: '8px', zIndex: '5',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '28px', padding: '0', border: 'none', borderRadius: '7px',
            background: 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer',
            boxShadow: '0 0 0 1px var(--dsw-alias-border-l1)',
            WebkitTapHighlightColor: 'transparent',
          });
          button.__speakId = `plan-pane:${key}`;
          button.__pane = pane;
          button.addEventListener('click', () => {
            if (planReading(controller.activeId)) { controller.stop(); return; }
            const text = pane.innerText ?? '';
            if (text.trim() !== '') controller.start(button.__speakId, text);
          });
          // The pane is a plain <section>; anchor the float inside it.
          const position = getComputedStyle(pane).position;
          if (position === 'static') pane.style.position = 'relative';
          pane.appendChild(button);
          buttons.add(button);
          paint(button);
        }
      };

      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; scan(); });
      };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      scan();
      const off = controller.subscribe(paintAll);
      return () => {
        observer.disconnect();
        off();
        for (const button of buttons) button.remove();
        buttons.clear();
      };
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
        h('option', { value: 'qwen' }, t('settings.engine.qwen')),
        h('option', { value: 'local' }, t('settings.engine.local')));

      const qwenHint = value.engine === 'qwen'
        ? h('div', { style: HINT_STYLE }, t('settings.qwen.hint'))
        : null;

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
        : value.engine === 'qwen'
          ? QWEN_VOICES.map((voice) => h('option', { key: voice.name, value: voice.name }, voice.label))
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
        qwenHint,
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

      // One auto-read watcher per session. The chat binding is recreated by
      // connection resets / session rebinds — the old one goes silent, so a
      // stored watcher must be replaced when the live binding differs.
      const autoWatchers = new Map();
      ctx.effect(() => () => {
        for (const record of autoWatchers.values()) record.dispose();
        autoWatchers.clear();
      }, 'dsh-tts: auto-read watchers');

      /** Bind (or rebind) the watcher of one session to a live chat binding. */
      const ensureWatcher = (sessionId, chat) => {
        const previous = autoWatchers.get(sessionId);
        if (previous !== undefined && previous.chat === chat) return;
        previous?.dispose();
        autoWatchers.set(sessionId, { chat, dispose: watchAutoRead(chat, settings, controller) });
      };

      const chatOf = (sessionId) => {
        try {
          return ctx.uiConversation.binding(sessionId).target('chat');
        } catch {
          return undefined;
        }
      };

      // Primary binding path: the FOREGROUND session, subscribed as soon as it
      // opens — before any reply exists, so a conversation's FIRST reply is
      // auto-read too (the actions-row slot below only renders once some
      // finalized message exists, which used to skip the first reply).
      ctx.inject(['uiSession'], (scope) => {
        let lastSessionId;
        const sync = () => {
          const sessionId = scope.uiSession.current.getSnapshot()?.key;
          if (sessionId !== lastSessionId) {
            // Playback follows the foreground conversation: leaving a session
            // stops its speech (its stop button is no longer reachable) and
            // drops its queued items; the new session reads its own replies.
            controller.stop();
            lastSessionId = sessionId;
          }
          for (const [id, record] of autoWatchers) {
            if (id === sessionId) continue;
            record.dispose();
            autoWatchers.delete(id);
          }
          if (sessionId === undefined) return;
          const chat = chatOf(sessionId);
          if (chat !== undefined) ensureWatcher(sessionId, chat);
        };
        ctx.effect(() => scope.uiSession.current.subscribe(sync), 'dsh-tts: foreground session watcher');
        sync();
      });

      // Fallback binding path: also bind from the actions-row render (covers
      // clients without uiSession).
      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'dsh-tts',
        order: 20,
        locale: NS,
        inject: (sessionId) => {
          const chat = chatOf(sessionId);
          if (chat !== undefined) ensureWatcher(sessionId, chat);
          return { controller, chat };
        },
      }, SpeakAction));

      // Auto-read hook on presented plans (plan review card); renders nothing.
      ctx.slots.inject('conversation.plan-review.actions', () => ctx.slots.register({
        name: 'conversation.plan-review.actions',
        id: 'dsh-tts',
        order: 30,
        locale: NS,
        inject: () => ({ controller, settings }),
      }, PlanReviewAutoRead));

      // Floating speak/stop button inside every plan preview pane (works on
      // desktop and mobile alike — no context menu needed).
      ctx.effect(() => mountPlanSpeakOverlays(ctx, controller), 'dsh-tts: plan speak overlays');

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
