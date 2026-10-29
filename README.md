# Voice Activity Detection for Javascript

[![npm vad-web](https://img.shields.io/npm/v/@ricky0123/vad-web?color=blue&label=%40ricky0123%2Fvad-web&style=flat-square)](https://www.npmjs.com/package/@ricky0123/vad-web)
[![npm vad-react](https://img.shields.io/npm/v/@ricky0123/vad-react?color=blue&label=%40ricky0123%2Fvad-react&style=flat-square)](https://www.npmjs.com/package/@ricky0123/vad-react)
[![Become a Sponsor](https://img.shields.io/static/v1?label=Become%20a%20Sponsor&message=%E2%9D%A4&logo=GitHub&style=flat&color=d42f2d)](https://github.com/sponsors/ricky0123)

> Run callbacks on segments of audio with user speech in a few lines of code

This package aims to provide an accurate, user-friendly voice activity detector (VAD) that runs in the browser. By using this package, you can prompt the user for microphone permissions, start recording audio, send segments of audio with speech to your server for processing, or show an animation or indicator when the user is speaking.

Links:
- [Project landing page](https://www.vad.ricky0123.com), where you can see a live demo in action.
- Ask a question or share what you've built on [Discord](https://discord.gg/4WPeGEaSpF)!
- Browse the [documentation](https://docs.vad.ricky0123.com/), the source code of which is located in the ./docs directory.

Under the hood, these packages run [Silero VAD](https://github.com/snakers4/silero-vad) [[1]](#1) using [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/tree/main/js/web) / [ONNX Runtime Node.js](https://github.com/microsoft/onnxruntime/tree/main/js/node). Thanks a lot to them for making this possible.


## Buildvoc Memex voice deployment

This fork also carries the standalone Whisper/Memex voice integration under `voice-test/`. The authoritative deployment branch is **`staging`**.

### Agent deployment rules

- Deploy only the voice stack from this repository. Do not modify HedgeDoc, nodeBook, or the abandoned `android-debug` / port `:8767` path.
- Live voice directory: `/data/projects/whisper/voice-test`
- Whisper API dependency: `127.0.0.1:8765`
- Voice service: `whisper-voice-test.service`
- Voice UI: `http://192.168.1.142:8766/voice/`
- Health check: `http://192.168.1.142:8766/health`
- HedgeDoc used by the browser extension: `http://192.168.1.142:8180`
- Chrome package: `voice-test/extensions/chrome/`
- Firefox package: `voice-test/extensions/firefox/`
- Preserve machine-local files outside `voice-test/`, including `/data/projects/whisper/common_vocabulary.txt`.
- Back up the live files before replacing them. Restart only `whisper-voice-test.service` for voice-app changes.

### Deploy on G3

```bash
cd /data/projects

if [ ! -d vad-sync/.git ]; then
  git clone -b staging https://github.com/buildvoc/vad.git vad-sync
else
  git -C vad-sync fetch origin
  git -C vad-sync checkout staging
  git -C vad-sync pull --ff-only origin staging
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p /backups/builds/vad-voice-"$STAMP"
cp -a /data/projects/whisper/voice-test/.   /backups/builds/vad-voice-"$STAMP"/

rsync -a --delete   --exclude='__pycache__'   --exclude='*.pyc'   --exclude='whisper-voice-test.service'   /data/projects/vad-sync/voice-test/   /data/projects/whisper/voice-test/

python3 -m py_compile /data/projects/whisper/voice-test/app.py

sudo systemctl restart whisper-voice-test.service
sudo systemctl is-active whisper-voice-test.service
curl -sS http://192.168.1.142:8766/health
```

The repository copy of `whisper-voice-test.service` is reference material. Do not overwrite the installed unit blindly; the live unit may contain machine-specific bind or environment settings.

If the health check fails:

```bash
sudo systemctl status whisper-voice-test.service --no-pager -l
sudo journalctl -u whisper-voice-test.service -n 100 --no-pager
ss -ltnp | grep ':8766'
```

### Browser extensions

For Chrome/Chromium, use `voice-test/extensions/chrome/`. Open `chrome://extensions`, enable Developer mode, then **Load unpacked** or **Reload**.

For Firefox testing, use `voice-test/extensions/firefox/`. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select its `manifest.json`.

The legacy `voice-test/extension/` directory is retained for compatibility; new deployments should use the browser-specific directories above.

### Current voice-note format

The current voice backend includes the v116 HedgeDoc CriticMarkup integration. Conversation messages are stored as directly adjacent CriticMarkup comments:

```text
{>>@hp: question<<}{>>@memex: answer<<}
```

Keep this format intact when deploying; do not convert voice conversation turns back to the older custom HTML-marker format.

## Sponsorship

Please consider [sponsoring](https://github.com/sponsors/ricky0123) this project if you have found it useful!


## Quick Start

To use the VAD via a script tag in the browser, include the following script tags:

```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/bundle.min.js"></script>
<script>
  async function main() {
    const myvad = await vad.MicVAD.new({
      onSpeechStart: () => {
        console.log("Speech start detected")
      },
      onSpeechEnd: (audio) => {
        // do something with `audio` (Float32Array of audio samples at sample rate 16000)...
      },
      onnxWASMBasePath:
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
      baseAssetPath:
        "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/",
    })
    myvad.start()
  }
  main()
</script>
```

Documentation for bundling the voice activity detector for the browser or using it in node or React projects can be found on [docs.vad.ricky0123.com](https://docs.vad.ricky0123.com).

## Cool projects using this library

- [lonestone/micdrop](https://github.com/lonestone/micdrop)

## References

<a id="1">[1]</a>
Silero Team. (2021).
Silero VAD: pre-trained enterprise-grade Voice Activity Detector (VAD), Number Detector and Language Classifier.
GitHub, GitHub repository, https://github.com/snakers4/silero-vad, hello@silero.ai.
