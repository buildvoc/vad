"""Standalone voice-loop iframe demo. No HedgeDoc integration or dependencies."""
from pathlib import Path
from collections import deque
import hashlib
import os
import re
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parent
WHISPER_URL = "http://127.0.0.1:8765/transcribe"
MAX_AUDIO_BYTES = 25 * 1024 * 1024

# TERMINAL_SPEAK_API_V073: small in-memory LAN queue consumed by the open :8766 browser page.
TERMINAL_SPEAK_API_V073 = True
TERMINAL_SPEAK_MESSAGES = deque(maxlen=100)
TERMINAL_SPEAK_SEQ = 0
TERMINAL_SPEAK_MAX_CHARS = 12000

app = FastAPI(title="Whisper Voice Iframe Test")


@app.get("/", include_in_schema=False)
async def parent_page():
    return FileResponse(ROOT / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/voice/", include_in_schema=False)
async def iframe_page():
    return FileResponse(ROOT / "voice.html", headers={"Cache-Control": "no-store"})


@app.get("/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get("http://127.0.0.1:8765/health")
            response.raise_for_status()
            upstream = response.json()
        return {"status": "ok", "whisper": upstream}
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Whisper API unavailable") from exc


def demo_reply(transcript: str) -> str:
    """Explicitly simulated replies; replace with real RAG after voice-loop testing."""
    t = transcript.strip().lower().rstrip(".!?")
    if not t:
        return "I couldn't hear any words. Please try again."
    if any(word in t for word in ("hello", "good morning", "hi there")):
        return "Hello! I can hear you. Ask me something else to test the next turn."
    if "what can you do" in t or "who are you" in t:
        return "I'm an isolated two-way voice test. Whisper recognises your words, and your browser speaks my reply."
    if "how are you" in t:
        return "I'm working well. The microphone, transcription, and speech loop are all being tested."
    if "what is the next step" in t:
        return "After testing, we can connect this interface to the Memex chat API."
    return f"I heard: {transcript}. You can speak again after this reply."


@app.post("/api/speak")
async def terminal_speak(request: Request):
    """Queue text for speech in any open :8766 voice page with Speaking ON."""
    global TERMINAL_SPEAK_SEQ
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="JSON body required") from exc
    text = str(payload.get("text") or "").strip() if isinstance(payload, dict) else ""
    if not text:
        raise HTTPException(status_code=400, detail="Non-empty text required")
    if len(text) > TERMINAL_SPEAK_MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"Text exceeds {TERMINAL_SPEAK_MAX_CHARS} characters")
    TERMINAL_SPEAK_SEQ += 1
    item = {"seq": TERMINAL_SPEAK_SEQ, "text": text}
    TERMINAL_SPEAK_MESSAGES.append(item)
    return {"ok": True, **item}


@app.get("/api/speak")
async def terminal_speak_poll(after: int = 0):
    """Return queued terminal speech newer than the browser's last sequence."""
    messages = [item for item in TERMINAL_SPEAK_MESSAGES if item["seq"] > after]
    return {"messages": messages, "latest": TERMINAL_SPEAK_SEQ}


@app.post("/api/turn")
async def turn(file: UploadFile = File(...)):
    if not (file.content_type or "").startswith("audio/"):
        raise HTTPException(status_code=415, detail="Audio file required")
    try:
        audio = await file.read(MAX_AUDIO_BYTES + 1)
    finally:
        await file.close()
    if not audio:
        raise HTTPException(status_code=400, detail="Empty audio")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio exceeds 25 MB limit")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=5.0)) as client:
            response = await client.post(
                WHISPER_URL,
                files={"file": (file.filename or "speech.webm", audio, file.content_type)},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Whisper transcription failed") from exc

    transcript = str(payload.get("text") or "").strip()
    return {"text": transcript, "reply": demo_reply(transcript), "mode": "demo"}

# WHISPER_COMMON_VOCABULARY_API_V091
from pathlib import Path as _VocabularyPath
_VOCABULARY_FILE_V091 = _VocabularyPath('/data/projects/whisper/common_vocabulary.txt')
_VOCABULARY_MAX_CHARS_V091 = 3000

def _normalise_vocabulary_v091(value):
    lines = []
    seen = set()
    for raw in str(value or '').replace('\r', '').split('\n'):
        line = ' '.join(raw.strip().split())
        if not line or line in seen:
            continue
        seen.add(line)
        lines.append(line)
    text = '\n'.join(lines)
    if len(text) > _VOCABULARY_MAX_CHARS_V091:
        text = text[:_VOCABULARY_MAX_CHARS_V091].rsplit('\n', 1)[0]
    return text

@app.get('/api/vocabulary')
async def get_common_vocabulary_v091():
    try:
        text = _VOCABULARY_FILE_V091.read_text(encoding='utf-8') if _VOCABULARY_FILE_V091.exists() else ''
    except OSError:
        text = ''
    return {'text': _normalise_vocabulary_v091(text)}

@app.post('/api/vocabulary')
async def set_common_vocabulary_v091(payload: dict):
    text = _normalise_vocabulary_v091(payload.get('text', ''))
    _VOCABULARY_FILE_V091.parent.mkdir(parents=True, exist_ok=True)
    _VOCABULARY_FILE_V091.write_text(text + ('\n' if text else ''), encoding='utf-8')
    return {'ok': True, 'text': text}



# STANDARD_PROMPTS_API_V109
_STANDARD_PROMPTS_FILE_V109 = Path('/data/projects/whisper/standard_prompts.txt')
_STANDARD_PROMPTS_MAX_CHARS_V109 = 6000
_STANDARD_PROMPTS_MAX_LINE_V109 = 300
_STANDARD_PROMPTS_DEFAULT_V109 = '\n'.join([
    'Tell me about Memex Wiki',
    'How does Ask Wiki work?',
    'What is the current Whisper setup?',
    'How does Android Firefox voice work?',
    'What ports are used by the Memex services?',
    'What is the current llama.cpp configuration?',
    'Summarize the latest Memex project status',
    'What issues are still unresolved?',
    'Show the current voice conversation flow',
])

def _normalise_standard_prompts_v109(value):
    lines = []
    seen = set()
    for raw in str(value or '').replace('\r', '').split('\n'):
        line = ' '.join(raw.strip().split())
        if not line:
            continue
        line = line[:_STANDARD_PROMPTS_MAX_LINE_V109].rstrip()
        if not line or line in seen:
            continue
        seen.add(line)
        lines.append(line)

    text = '\n'.join(lines)
    if len(text) > _STANDARD_PROMPTS_MAX_CHARS_V109:
        text = text[:_STANDARD_PROMPTS_MAX_CHARS_V109].rsplit('\n', 1)[0]
    return text

@app.get('/api/standard-prompts')
async def get_standard_prompts_v109():
    try:
        if _STANDARD_PROMPTS_FILE_V109.exists():
            text = _STANDARD_PROMPTS_FILE_V109.read_text(encoding='utf-8')
        else:
            text = _STANDARD_PROMPTS_DEFAULT_V109
    except OSError:
        text = _STANDARD_PROMPTS_DEFAULT_V109
    return {'text': _normalise_standard_prompts_v109(text)}

@app.post('/api/standard-prompts')
async def set_standard_prompts_v109(payload: dict):
    text = _normalise_standard_prompts_v109(payload.get('text', ''))
    try:
        _STANDARD_PROMPTS_FILE_V109.parent.mkdir(parents=True, exist_ok=True)
        _STANDARD_PROMPTS_FILE_V109.write_text(text + ('\n' if text else ''), encoding='utf-8')
    except OSError as exc:
        raise HTTPException(status_code=500, detail='Standard prompts save failed') from exc
    return {'ok': True, 'text': text}


# WIKI_HEDGEDOC_NOTE_API_V110
_HEDGEDOC_ENV_DEFAULT_V110 = Path('/data/projects/hedgedoc/.env')
_HEDGEDOC_PUBLIC_URL_V110 = 'http://192.168.1.142:8180'
_WIKI_NOTE_MAX_QUESTION_V110 = 4000
_WIKI_NOTE_MAX_ANSWER_V110 = 120000


def _read_env_values_v110(path: Path):
    values = {}
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError:
        return values

    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def _hedgedoc_config_v110():
    values = dict(os.environ)

    candidates = []
    pointer = values.get('HD2_ENV_FILE')
    if pointer:
        candidates.append(Path(pointer))
    candidates.append(_HEDGEDOC_ENV_DEFAULT_V110)

    for candidate in candidates:
        file_values = _read_env_values_v110(candidate)
        for key, value in file_values.items():
            values.setdefault(key, value)

        nested = file_values.get('HD2_ENV_FILE')
        if nested:
            nested_path = Path(nested)
            if not nested_path.is_absolute():
                nested_path = candidate.parent / nested_path
            for key, value in _read_env_values_v110(nested_path).items():
                values.setdefault(key, value)

    base_url = (
        values.get('HD2_URL')
        or values.get('HD_BASE_URL')
        or values.get('HEDGEDOC_URL')
        or ''
    ).strip().rstrip('/')
    token = (values.get('HD2_TOKEN') or '').strip()
    public_url = (
        values.get('HEDGEDOC_PUBLIC_URL')
        or values.get('HD_PUBLIC_URL')
        or _HEDGEDOC_PUBLIC_URL_V110
    ).strip().rstrip('/')

    if not base_url:
        raise HTTPException(status_code=503, detail='HedgeDoc v2 URL is not configured')
    if not token:
        raise HTTPException(status_code=503, detail='HD2_TOKEN is not configured')
    return base_url, token, public_url


def _slug_v110(value: str):
    text = str(value or '').lower()
    text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    return text[:48] or 'response'


def _one_line_v110(value, limit=1000):
    return ' '.join(str(value or '').replace('\r', ' ').replace('\n', ' ').split())[:limit]


def _markdown_inline_v110(value, limit=1000):
    return _one_line_v110(value, limit).replace('`', "'")


# WIKI_HEDGEDOC_CRITIC_THREAD_V116
# SpecDoc staging-compatible CriticMarkup conversation thread.
# One note, one YAML frontmatter, adjacent comments form one thread.
@app.post('/api/wiki-note')
async def create_or_update_wiki_hedgedoc_note_v116(payload: dict):
    question = str(payload.get('question') or '').strip()
    answer = str(payload.get('answer') or '').strip()
    input_mode = _one_line_v110(payload.get('input_mode') or 'wiki', 80)
    response_id = _one_line_v110(payload.get('response_id') or '', 160)
    requested_alias = _one_line_v110(payload.get('alias') or '', 180)
    original_created = _one_line_v110(payload.get('created') or '', 80)

    if not question:
        raise HTTPException(status_code=400, detail='Question is required')
    if not answer:
        raise HTTPException(status_code=400, detail='Wiki answer is required')
    if len(question) > _WIKI_NOTE_MAX_QUESTION_V110:
        raise HTTPException(status_code=413, detail='Question is too long')
    if len(answer) > _WIKI_NOTE_MAX_ANSWER_V110:
        raise HTTPException(status_code=413, detail='Wiki answer is too long')

    def critic_safe_v116(value):
        return (
            str(value)
            .replace('{>>', '{ >>')
            .replace('<<}', '<< }')
        )

    base_url, token, public_url = _hedgedoc_config_v110()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace('+00:00', 'Z')
    answer_sha = hashlib.sha256(answer.encode('utf-8')).hexdigest()

    token_headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json',
    }
    markdown_headers = {
        **token_headers,
        'Content-Type': 'text/markdown',
    }

    critic_pair = (
        f'{{>>@hp: {critic_safe_v116(question)}<<}}'
        f'{{>>@memex: {critic_safe_v116(answer)}<<}}'
    )

    action = 'created'
    created_iso = now_iso

    if requested_alias:
        if not re.fullmatch(r'memex-wiki-[a-z0-9-]{1,170}', requested_alias):
            raise HTTPException(status_code=400, detail='Invalid Memex Wiki note alias')

        alias = requested_alias
        action = 'updated'

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(15.0, connect=5.0)
            ) as client:
                check = await client.get(
                    base_url + f'/api/v2/notes/{alias}',
                    headers=token_headers,
                )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail='HedgeDoc note lookup failed'
            ) from exc

        if check.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail='Existing Memex Wiki note was not found'
            )
        if not check.is_success:
            raise HTTPException(
                status_code=502,
                detail=(
                    f'HedgeDoc lookup failed: HTTP {check.status_code}: '
                    f'{check.text[:500]}'
                ),
            )

        try:
            existing = check.json()
        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail='HedgeDoc lookup returned invalid JSON'
            ) from exc

        existing_content = str(existing.get('content') or '')
        metadata = existing.get('metadata') or {}
        created_iso = original_created or _one_line_v110(
            metadata.get('createdAt') or metadata.get('created') or '',
            80,
        ) or now_iso

        if '<!-- MEMEX_WIKI_CRITIC_THREAD_V116 -->' not in existing_content:
            raise HTTPException(
                status_code=409,
                detail=(
                    'Existing note is not a v116 CriticMarkup conversation; '
                    'reload the voice page and create a new HedgeDoc note'
                ),
            )

        markdown = existing_content.rstrip()

        duplicate = markdown.endswith(critic_pair)
        if not duplicate:
            markdown += critic_pair
        markdown += '\n'

    else:
        alias = (
            'memex-wiki-'
            + now.strftime('%Y%m%d-%H%M%S')
            + '-'
            + _slug_v110(question)
            + '-'
            + answer_sha[:8]
        )

        title_question = _one_line_v110(question, 140)
        note_title = f'Memex Wiki conversation — {title_question}'
        yaml_title = note_title.replace('\\', '\\\\').replace('"', '\\"')

        markdown = (
            '---\n'
            'type: document\n'
            'okf_type: Concept\n'
            f'title: "{yaml_title}"\n'
            'description: ""\n'
            'tags: []\n'
            'status: draft\n'
            'sources: []\n'
            '---\n\n'
            f'# {note_title}\n\n'
            '> **Memex Wiki provenance:** CriticMarkup conversation generated '
            'from Ask Wiki responses.\n'
            f'> **Created:** `{created_iso}`\n'
            '> **Source:** `Memex Wiki`\n'
            f'> **Input mode:** `{_markdown_inline_v110(input_mode, 80)}`\n\n'
            '## Conversation\n\n'
            '<!-- MEMEX_WIKI_CRITIC_THREAD_V116 -->\n'
            + critic_pair
            + '\n'
        )
        duplicate = False

    route_path = f'/api/v2/notes/{alias}'
    method = 'PUT' if action == 'updated' else 'POST'

    if not (action == 'updated' and duplicate):
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=5.0)
            ) as client:
                response = await client.request(
                    method,
                    base_url + route_path,
                    headers=markdown_headers,
                    content=markdown.encode('utf-8'),
                )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail='HedgeDoc note publish request failed'
            ) from exc

        if not response.is_success:
            raise HTTPException(
                status_code=502,
                detail=(
                    f'HedgeDoc publish failed: HTTP {response.status_code}: '
                    f'{response.text[:500]}'
                ),
            )

    return {
        'ok': True,
        'action': action,
        'alias': alias,
        'url': f'{public_url}/n/{alias}',
        'created': created_iso,
        'updated': now_iso if action == 'updated' else None,
        'answer_sha256': answer_sha,
        'response_id': response_id,
        'thread_format': 'critic-markup-v116',
        'duplicate': bool(duplicate),
    }
