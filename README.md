# dsh-tts

A [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) UI plugin
that reads assistant replies aloud in the Web GUI.

## Features

- **Speaker button** on every finalized assistant message's action row (next to
  like/dislike): one click reads the message, click again to stop.
- **Three engines**, switchable in Settings → TTS 朗读:
  - **Edge online voices** (default): Microsoft Edge read-aloud free endpoint,
    neural voices (晓晓, 云希, Aria, Guy, …) — no API key required.
  - **Azure Speech Service**: the official
    `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` REST API
    with your own resource key — enter region + key in settings (free F0 tier
    includes 0.5M neural characters/month). Same neural voice catalog.
  - **Browser speechSynthesis**: offline, system voices.
- **Settings page** (persisted on the host): speech service, voice (or auto by
  message language), volume, rate, pitch, auto-read of new replies, and a test
  playback button.
- **Auto-read**: optionally start reading each reply automatically once it
  settles; the speaker button stops it at any time.
- Long text is split into sentence chunks; only one message plays at a time.
- A cloud TTS engine interface is reserved: implement another `TtsEngine`
    (see `createEdgeEngine` in `client.js`) and add it to `resolveEngine`.

## Install

Install as a Cordis bundle from this package's directory (or from a registry):

```
dsh plugin install dsh-tts
```

## Notes

- The Edge endpoint is a free, undocumented service without an SLA. If it
  starts refusing connections, switch the service back to browser
  speechSynthesis in settings; errors are reported in the browser console.
- Azure mode stores the key in the Host settings document (server side) and
  sends it straight from the browser to the Azure endpoint over HTTPS.

## License

MIT
