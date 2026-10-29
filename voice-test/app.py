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

# WIKI_HEDGEDOC_MERMAID_THREAD_V117
# HedgeDoc note format:
# - one YAML frontmatter
# - one Mermaid conversation flow
# - rounded @hp / @memex nodes
# - updates append new nodes inside the existing Mermaid block
# - raw note updates are read from /api/v2/notes/<alias>/content

_MERMAID_THREAD_MARKER_V117 = '<!-- MEMEX_WIKI_MERMAID_THREAD_V117 -->'
_MERMAID_TURN_MARKER_V117 = '%% MEMEX_WIKI_TURN_V117'


def _mermaid_escape_v117(value):
    return (
        str(value or '')
        .replace('&', '&amp;')
        .replace('"', '&quot;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
    )


def _mermaid_inline_v117(value, limit=4000):
    return _mermaid_escape_v117(
        ' '.join(str(value or '').replace('\r', ' ').replace('\n', ' ').split())[:limit]
    )


def _mermaid_answer_v117(value):
    """Convert ordinary Wiki Markdown into safe Mermaid HTML-label text."""
    source = str(value or '').replace('\r\n', '\n').replace('\r', '\n')
    rendered = []

    for raw in source.split('\n'):
        stripped = raw.strip()

        if not stripped:
            rendered.append('')
            continue

        bullet = False
        if stripped.startswith(('- ', '* ')):
            bullet = True
            stripped = stripped[2:].strip()

        safe = _mermaid_escape_v117(stripped)
        safe = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', safe)
        safe = re.sub(r'__(.+?)__', r'<b>\1</b>', safe)
        safe = re.sub(r'`([^`]+)`', r'<code>\1</code>', safe)

        if bullet:
            safe = '• ' + safe

        rendered.append(safe)

    compact = []
    blank = False
    for line in rendered:
        if line:
            compact.append(line)
            blank = False
        elif not blank:
            compact.append('')
            blank = True

    while compact and not compact[-1]:
        compact.pop()

    return '<br/>'.join(compact)


def _yaml_quote_v117(value):
    return '"' + str(value or '').replace('\\', '\\\\').replace('"', '\\"').replace(
        '\r', ' '
    ).replace('\n', ' ') + '"'


def _mermaid_turn_nodes_v117(index, question, answer, turn_sha):
    hp = _mermaid_inline_v117(question, _WIKI_NOTE_MAX_QUESTION_V110)
    memex = _mermaid_answer_v117(answer)

    return (
        f'    {_MERMAID_TURN_MARKER_V117} {turn_sha}\n'
        f'    HP{index}("🟨 <b>@hp</b><br/>{hp}")\n\n'
        f'    M{index}("🟦 <b>@memex</b><br/><br/>{memex}")\n'
    )


def _build_mermaid_note_v117(note_title, created_iso, input_mode, question, answer, turn_sha):
    return (
        '---\n'
        'type: document\n'
        'okf_type: Concept\n'
        f'title: {_yaml_quote_v117(note_title)}\n'
        'description: "Conversation captured from Memex Wiki Ask responses."\n'
        'tags: [memex, wiki, conversation]\n'
        'status: draft\n'
        'sources: []\n'
        'provenance: "CriticMarkup conversation generated from Ask Wiki responses."\n'
        f'created: {_yaml_quote_v117(created_iso)}\n'
        'source: "Memex Wiki"\n'
        f'input_mode: {_yaml_quote_v117(input_mode)}\n'
        '---\n\n'
        f'# {note_title}\n\n'
        '## Conversation\n\n'
        f'{_MERMAID_THREAD_MARKER_V117}\n'
        '```mermaid\n'
        '%%{init: {\n'
        '  "flowchart": {\n'
        '    "useMaxWidth": true,\n'
        '    "htmlLabels": true,\n'
        '    "curve": "linear",\n'
        '    "nodeSpacing": 28,\n'
        '    "rankSpacing": 34,\n'
        '    "wrappingWidth": 900\n'
        '  },\n'
        '  "themeVariables": {\n'
        '    "fontSize": "16px"\n'
        '  }\n'
        '}}%%\n'
        'flowchart TB\n\n'
        + _mermaid_turn_nodes_v117(1, question, answer, turn_sha)
        + '\n'
        '    HP1 --> M1\n\n'
        '    classDef hp fill:#fff6d6,stroke:#e5aa00,stroke-width:2px,color:#222\n'
        '    classDef memex fill:#eaf5ff,stroke:#3194dc,stroke-width:2px,color:#222\n\n'
        '    class HP1 hp\n'
        '    class M1 memex\n\n'
        '    linkStyle default stroke:#7a7a7a,stroke-width:2px\n'
        '```\n'
    )


def _append_mermaid_turn_v117(markdown, question, answer, turn_sha):
    if _MERMAID_THREAD_MARKER_V117 not in markdown:
        raise HTTPException(
            status_code=409,
            detail='Existing note is not a Mermaid v117 conversation; create a new HedgeDoc note',
        )

    duplicate_marker = f'{_MERMAID_TURN_MARKER_V117} {turn_sha}'
    if duplicate_marker in markdown:
        return markdown, True

    indexes = [
        int(value)
        for value in re.findall(r'(?m)^\s*HP(\d+)\s*\(', markdown)
    ]
    if not indexes:
        raise HTTPException(
            status_code=409,
            detail='Mermaid conversation contains no @hp turn nodes',
        )

    previous = max(indexes)
    index = previous + 1

    anchor = '    linkStyle default stroke:#7a7a7a,stroke-width:2px'
    if anchor not in markdown:
        raise HTTPException(
            status_code=409,
            detail='Mermaid conversation update anchor is missing',
        )

    addition = (
        _mermaid_turn_nodes_v117(index, question, answer, turn_sha)
        + f'\n    M{previous} --> HP{index}\n'
        + f'    HP{index} --> M{index}\n\n'
        + f'    class HP{index} hp\n'
        + f'    class M{index} memex\n\n'
    )

    return markdown.replace(anchor, addition + anchor, 1), False


@app.post('/api/wiki-note')
async def create_or_update_wiki_hedgedoc_note_v117(payload: dict):
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

    base_url, token, public_url = _hedgedoc_config_v110()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace('+00:00', 'Z')
    answer_sha = hashlib.sha256(answer.encode('utf-8')).hexdigest()
    turn_sha = hashlib.sha256(
        (question + '\0' + answer).encode('utf-8')
    ).hexdigest()[:20]

    token_headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'text/markdown',
    }
    markdown_headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json',
        'Content-Type': 'text/markdown',
    }

    action = 'created'
    created_iso = now_iso
    duplicate = False

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
                    base_url + f'/api/v2/notes/{alias}/content',
                    headers=token_headers,
                )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail='HedgeDoc raw note lookup failed'
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
                    f'HedgeDoc raw note lookup failed: HTTP {check.status_code}: '
                    f'{check.text[:500]}'
                ),
            )

        existing_content = check.text
        created_iso = original_created or now_iso
        markdown, duplicate = _append_mermaid_turn_v117(
            existing_content,
            question,
            answer,
            turn_sha,
        )

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

        markdown = _build_mermaid_note_v117(
            note_title,
            created_iso,
            input_mode,
            question,
            answer,
            turn_sha,
        )

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
        'thread_format': 'mermaid-v117',
        'duplicate': bool(duplicate),
    }
