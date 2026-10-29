'use strict';

// HedgeDoc View-mode reader. Runs in all :8180 frames, but activates only in
// the renderer iframe of a /n/... note view. No HedgeDoc source changes.
(() => {
  const ROOT_SELECTOR = '[data-word-count-target]';
  const CONTROL_ID = 'whisper-hedgedoc-view-reader-controls';
  const HIGHLIGHT_ATTR = 'data-whisper-reader-active';
  const FROM_HERE_ATTR = 'data-whisper-reader-from-here';
  const MAX_UTTERANCE_CHARS = 320;
  const MAX_SECTION_CONTEXT_CHARS = 5200;
  const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,figcaption,pre';
  const CODE_MODE_KEY = 'whisper-reader-code-mode';
  const SCROLL_LOCK_KEY = 'whisper-reader-scroll-lock';

  let speaking = false;
  let paused = false;
  let cancelled = false;
  let chunks = [];
  let chunkIndex = 0;
  let activeChunkIndex = -1;
  let activeNode = null;
  let speechEpoch = 0;
  let fromHereArmed = false;
  let codeMode = localStorage.getItem(CODE_MODE_KEY) === 'read' ? 'read' : 'skip';
  let autoScroll = localStorage.getItem(SCROLL_LOCK_KEY) !== 'off';

  function isTopNoteView() {
    try {
      const path = window.top.location.pathname;
      return /^\/n\/[^/]+\/?$/.test(path);
    } catch (_) {
      return false;
    }
  }

  function isReadableRendererFrame() {
    if (window === window.top) return false;
    if (!isTopNoteView()) return false;
    return Boolean(document.querySelector(ROOT_SELECTOR));
  }

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function visible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function headingLevel(node) {
    if (!(node instanceof HTMLElement)) return null;
    const match = /^H([1-6])$/.exec(node.tagName);
    return match ? Number(match[1]) : null;
  }

  function isCodeBlock(node) {
    return node instanceof HTMLElement && node.tagName === 'PRE';
  }

  function splitLongText(text) {
    const clean = normalize(text);
    if (!clean) return [];
    const sentenceParts = clean.match(/[^.!?]+[.!?]+(?:[”'\"]+)?|[^.!?]+$/g) || [clean];
    const out = [];
    for (const sentence of sentenceParts) {
      const s = normalize(sentence);
      if (!s) continue;
      if (s.length <= MAX_UTTERANCE_CHARS) {
        out.push(s);
        continue;
      }
      const words = s.split(' ');
      let buf = '';
      for (const word of words) {
        const candidate = buf ? `${buf} ${word}` : word;
        if (candidate.length > MAX_UTTERANCE_CHARS && buf) {
          out.push(buf);
          buf = word;
        } else {
          buf = candidate;
        }
      }
      if (buf) out.push(buf);
    }
    return out;
  }

  function splitCodeText(text) {
    const raw = String(text || '').replace(/\r/g, '').trim();
    if (!raw) return [];
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    const out = ['Code block.'];
    for (const line of lines) {
      const spoken = line
        .replace(/=>/g, ' arrow ')
        .replace(/!==/g, ' not triple equals ')
        .replace(/===/g, ' triple equals ')
        .replace(/!=/g, ' not equals ')
        .replace(/==/g, ' double equals ')
        .replace(/&&/g, ' and ')
        .replace(/\|\|/g, ' or ')
        .replace(/\{/g, ' open brace ')
        .replace(/\}/g, ' close brace ')
        .replace(/\[/g, ' open bracket ')
        .replace(/\]/g, ' close bracket ')
        .replace(/\(/g, ' open parenthesis ')
        .replace(/\)/g, ' close parenthesis ')
        .replace(/;/g, ' semicolon ')
        .replace(/:/g, ' colon ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!spoken) continue;
      out.push(...splitLongText(spoken));
    }
    return out;
  }

  function shouldSkipNestedDuplicate(node) {
    if (!(node instanceof HTMLElement)) return true;
    if (node.tagName === 'P' && node.closest('li,blockquote,td,th')) return true;
    if (node.tagName === 'PRE' && node.closest('pre') !== node) return true;
    return false;
  }

  function collectChunks(root, options = {}) {
    const effectiveCodeMode = options.codeMode || codeMode;
    const nodes = [...root.querySelectorAll(BLOCK_SELECTOR)]
      .filter((el) => visible(el))
      .filter((el) => !el.closest(`#${CONTROL_ID}`))
      .filter((el) => !el.closest('nav,button,summary,[role="button"]'))
      .filter((el) => !shouldSkipNestedDuplicate(el));

    const result = [];
    let currentHeading = null;
    let currentHeadingLevel = null;

    for (const node of nodes) {
      const level = headingLevel(node);
      if (level !== null) {
        currentHeading = node;
        currentHeadingLevel = level;
      }

      const code = isCodeBlock(node);
      if (code && effectiveCodeMode === 'skip') continue;

      const text = node.innerText || node.textContent || '';
      const parts = code ? splitCodeText(text) : splitLongText(text);
      for (const part of parts) {
        result.push({
          text: part,
          node,
          sectionHeading: currentHeading,
          sectionLevel: currentHeadingLevel,
          kind: code ? 'code' : level !== null ? 'heading' : 'text',
          rate: code ? 0.78 : 1,
        });
      }
    }
    return result;
  }

  function clearHighlight() {
    try {
      if (window.CSS?.highlights) CSS.highlights.delete('whisper-reader-spoken');
    } catch (_) {}
    if (activeNode instanceof HTMLElement) activeNode.removeAttribute(HIGHLIGHT_ATTR);
    activeNode = null;
  }

  function findNormalizedRange(node, targetText) {
    if (!(node instanceof HTMLElement)) return null;
    const target = normalize(targetText);
    if (!target) return null;

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        const parent = textNode.parentElement;
        if (!parent || parent.closest('script,style,noscript')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let normalizedText = '';
    const map = [];
    let pendingSpace = null;
    let textNode;
    while ((textNode = walker.nextNode())) {
      const raw = textNode.nodeValue || '';
      for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        if (/\s/.test(ch)) {
          if (normalizedText && !normalizedText.endsWith(' ')) pendingSpace = {node: textNode, offset: i};
          continue;
        }
        if (pendingSpace) {
          normalizedText += ' ';
          map.push(pendingSpace);
          pendingSpace = null;
        }
        normalizedText += ch;
        map.push({node: textNode, offset: i});
      }
    }

    const start = normalizedText.indexOf(target);
    if (start < 0) return null;
    const endIndex = start + target.length - 1;
    const first = map[start];
    const last = map[endIndex];
    if (!first || !last) return null;

    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, Math.min(last.offset + 1, (last.node.nodeValue || '').length));
    return range;
  }

  function setHighlight(node, spokenText = '') {
    clearHighlight();
    if (!(node instanceof HTMLElement)) return;
    activeNode = node;

    let exactTextHighlight = false;
    try {
      if (window.CSS?.highlights && typeof Highlight !== 'undefined') {
        const range = findNormalizedRange(node, spokenText);
        if (range) {
          CSS.highlights.set('whisper-reader-spoken', new Highlight(range));
          exactTextHighlight = true;
        }
      }
    } catch (_) {}

    if (!exactTextHighlight) node.setAttribute(HIGHLIGHT_ATTR, 'true');
    if (autoScroll) node.scrollIntoView({block: 'center', behavior: 'smooth'});
  }

  function setStatus(text) {
    const el = document.getElementById(`${CONTROL_ID}-status`);
    if (el) el.textContent = text;
  }

  function updateControlLabels() {
    const controls = document.getElementById(CONTROL_ID);
    if (!controls) return;
    const code = controls.querySelector('[data-action="code"]');
    const scroll = controls.querySelector('[data-action="scroll"]');
    const fromHere = controls.querySelector('[data-action="from-here"]');
    if (code) code.textContent = codeMode === 'skip' ? 'Code: Skip' : 'Code: Read';
    if (scroll) scroll.textContent = autoScroll ? '🔒 Scroll' : '🔓 Scroll';
    if (fromHere) fromHere.textContent = fromHereArmed ? '📍 Click text…' : '📍 From here';
  }

  function ensureChunks(options = {}) {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return false;
    if (!chunks.length || options.rebuild) chunks = collectChunks(root);
    return chunks.length > 0;
  }

  function stopReading(status = 'Stopped', keepQueue = false) {
    speechEpoch += 1;
    cancelled = true;
    speaking = false;
    paused = false;
    window.speechSynthesis.cancel();
    clearHighlight();
    activeChunkIndex = -1;
    if (!keepQueue) {
      chunks = [];
      chunkIndex = 0;
    }
    setStatus(status);
  }

  function speakNext() {
    if (cancelled || paused) return;
    if (chunkIndex >= chunks.length) {
      speaking = false;
      clearHighlight();
      activeChunkIndex = -1;
      setStatus('Finished');
      return;
    }

    const itemIndex = chunkIndex;
    const item = chunks[chunkIndex++];
    activeChunkIndex = itemIndex;
    const epoch = speechEpoch;
    setHighlight(item.node, item.text);

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = document.documentElement.lang || 'en-GB';
    utterance.rate = item.rate || 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      if (epoch !== speechEpoch) return;
      const section = item.sectionHeading ? normalize(item.sectionHeading.textContent) : 'Introduction';
      setStatus(`${section} · ${itemIndex + 1}/${chunks.length}`);
    };
    utterance.onend = () => {
      if (epoch !== speechEpoch) return;
      speakNext();
    };
    utterance.onerror = (event) => {
      if (epoch !== speechEpoch || cancelled || event.error === 'canceled' || event.error === 'interrupted') return;
      stopReading(`Speech error: ${event.error || 'unknown'}`);
    };
    window.speechSynthesis.speak(utterance);
  }

  function restartAt(targetIndex, status = 'Reading…') {
    if (!ensureChunks()) {
      setStatus('No readable text found');
      return;
    }
    const target = Math.max(0, Math.min(targetIndex, chunks.length - 1));
    speechEpoch += 1;
    const epoch = speechEpoch;
    window.speechSynthesis.cancel();
    cancelled = false;
    paused = false;
    speaking = true;
    chunkIndex = target;
    activeChunkIndex = -1;
    clearHighlight();
    setStatus(status);
    window.setTimeout(() => {
      if (epoch !== speechEpoch || cancelled) return;
      speakNext();
    }, 0);
  }

  function startReading(selectionOnly = false, suppliedSelection = '') {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;
    stopReading('Preparing…');
    cancelled = false;

    if (selectionOnly) {
      const selected = normalize(suppliedSelection || window.getSelection()?.toString());
      if (!selected) {
        setStatus('Select text first');
        return;
      }
      chunks = splitLongText(selected).map((text) => ({
        text,
        node: null,
        sectionHeading: null,
        sectionLevel: null,
        kind: 'selection',
        rate: 1,
      }));
    } else {
      chunks = collectChunks(root);
    }

    if (!chunks.length) {
      setStatus('No readable text found');
      return;
    }

    chunkIndex = 0;
    activeChunkIndex = -1;
    speaking = true;
    setStatus(`Ready: ${chunks.length} chunks`);
    speakNext();
  }

  function pauseResume() {
    if (!speaking && !paused) return;
    if (paused) {
      paused = false;
      speaking = true;
      window.speechSynthesis.resume();
      setStatus('Resumed');
      return;
    }
    paused = true;
    window.speechSynthesis.pause();
    setStatus('Paused');
  }

  function headingChunkIndexes() {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < chunks.length; i += 1) {
      const node = chunks[i].node;
      if (headingLevel(node) !== null && !seen.has(node)) {
        seen.add(node);
        out.push(i);
      }
    }
    return out;
  }

  function currentPositionIndex() {
    if (activeChunkIndex >= 0) return activeChunkIndex;
    if (chunkIndex > 0) return Math.min(chunkIndex - 1, chunks.length - 1);
    return 0;
  }

  function previousSection() {
    if (!ensureChunks({rebuild: !chunks.length})) {
      setStatus('No readable text found');
      return;
    }
    const headings = headingChunkIndexes();
    if (!headings.length) {
      setStatus('No Markdown headings');
      return;
    }
    const pos = currentPositionIndex();
    const activeIsHeading = headingLevel(chunks[pos]?.node) !== null;
    const candidates = headings.filter((index) => activeIsHeading ? index < pos : index <= pos);
    if (!candidates.length) {
      setStatus('First section');
      return;
    }
    restartAt(candidates[candidates.length - 1], 'Previous section…');
  }

  function nextSection() {
    if (!ensureChunks({rebuild: !chunks.length})) {
      setStatus('No readable text found');
      return;
    }
    const headings = headingChunkIndexes();
    const pos = currentPositionIndex();
    const target = headings.find((index) => index > pos);
    if (target == null) {
      setStatus('Last section');
      return;
    }
    restartAt(target, 'Next section…');
  }

  function currentSectionHeadingIndex() {
    if (!ensureChunks({rebuild: !chunks.length})) return -1;
    const pos = currentPositionIndex();
    const item = chunks[pos];
    const heading = item?.sectionHeading;
    if (!heading) return 0;
    return chunks.findIndex((candidate) => candidate.node === heading);
  }

  function repeatSection() {
    const target = currentSectionHeadingIndex();
    if (target < 0) {
      setStatus('No section to repeat');
      return;
    }
    restartAt(target, 'Repeating section…');
  }

  function skipSection() {
    if (!ensureChunks({rebuild: !chunks.length})) {
      setStatus('Nothing to skip');
      return;
    }

    const currentIndex = currentPositionIndex();
    const current = chunks[currentIndex];
    const currentLevel = current?.sectionLevel;
    let target = -1;

    if (currentLevel == null) {
      target = headingChunkIndexes().find((index) => index > currentIndex) ?? -1;
    } else {
      for (const index of headingChunkIndexes()) {
        if (index <= currentIndex) continue;
        const level = headingLevel(chunks[index].node);
        if (level !== null && level <= currentLevel) {
          target = index;
          break;
        }
      }
    }

    if (target < 0) {
      stopReading('End of document');
      return;
    }
    restartAt(target, 'Skipping section…');
  }

  function setFromHereArmed(value) {
    fromHereArmed = Boolean(value);
    const root = document.querySelector(ROOT_SELECTOR);
    if (root instanceof HTMLElement) {
      if (fromHereArmed) root.setAttribute(FROM_HERE_ATTR, 'true');
      else root.removeAttribute(FROM_HERE_ATTR);
    }
    updateControlLabels();
    setStatus(fromHereArmed ? 'Click a paragraph or heading' : 'Ready');
  }

  function startFromNode(node) {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root || !(node instanceof HTMLElement)) return;
    chunks = collectChunks(root);
    if (!chunks.length) {
      setStatus('No readable text found');
      return;
    }
    let target = chunks.findIndex((item) => item.node === node);
    if (target < 0 && isCodeBlock(node) && codeMode === 'skip') {
      setStatus('Code skipped — enable Code: Read');
      return;
    }
    if (target < 0) {
      target = chunks.findIndex((item) => node.compareDocumentPosition(item.node) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    if (target < 0) {
      setStatus('No readable text after that point');
      return;
    }
    restartAt(target, 'Reading from here…');
  }

  function toggleCodeMode() {
    codeMode = codeMode === 'skip' ? 'read' : 'skip';
    localStorage.setItem(CODE_MODE_KEY, codeMode);
    chunks = [];
    chunkIndex = 0;
    activeChunkIndex = -1;
    updateControlLabels();
    setStatus(codeMode === 'read' ? 'Code blocks will be read slowly' : 'Code blocks will be skipped');
  }

  function toggleScrollLock() {
    autoScroll = !autoScroll;
    localStorage.setItem(SCROLL_LOCK_KEY, autoScroll ? 'on' : 'off');
    updateControlLabels();
    setStatus(autoScroll ? 'Auto-scroll locked to speech' : 'Auto-scroll unlocked');
  }

  function viewportReferenceNode(root) {
    const candidates = [...root.querySelectorAll(BLOCK_SELECTOR)].filter((node) => visible(node));
    if (!candidates.length) return null;
    const targetY = window.innerHeight * 0.35;
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const node of candidates) {
      const rect = node.getBoundingClientRect();
      const distance = Math.abs(rect.top - targetY);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  function currentSectionContext() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return null;
    const all = collectChunks(root, {codeMode: 'read'});
    if (!all.length) return null;

    const referenceNode = activeNode || viewportReferenceNode(root);
    let pos = referenceNode ? all.findIndex((item) => item.node === referenceNode) : -1;
    if (pos < 0) pos = 0;

    const sectionHeading = all[pos].sectionHeading;
    const level = all[pos].sectionLevel;
    let start = 0;
    if (sectionHeading) {
      const found = all.findIndex((item) => item.node === sectionHeading);
      if (found >= 0) start = found;
    }

    let end = all.length;
    if (level != null) {
      for (let i = start + 1; i < all.length; i += 1) {
        const candidateLevel = headingLevel(all[i].node);
        if (candidateLevel !== null && candidateLevel <= level && all[i].node !== sectionHeading) {
          end = i;
          break;
        }
      }
    } else {
      const firstHeading = all.findIndex((item) => headingLevel(item.node) !== null);
      if (firstHeading > 0) end = firstHeading;
    }

    const texts = [];
    let lastNode = null;
    let lastText = '';
    for (const item of all.slice(start, end)) {
      // Avoid repeating a long DOM block once per speech chunk in the context.
      if (item.node === lastNode) continue;
      const raw = normalize(item.node?.innerText || item.node?.textContent || item.text);
      if (!raw || raw === lastText) continue;
      texts.push(raw);
      lastNode = item.node;
      lastText = raw;
    }

    const headingText = sectionHeading ? normalize(sectionHeading.textContent) : 'Introduction';
    let body = texts.join('\n\n').trim();
    if (body.length > MAX_SECTION_CONTEXT_CHARS) {
      body = `${body.slice(0, MAX_SECTION_CONTEXT_CHARS)}\n\n[section truncated]`;
    }
    return {heading: headingText, text: body};
  }


  function askSelection() {
    const selected = normalize(window.getSelection()?.toString());
    if (!selected) {
      setStatus('Highlight text first');
      return;
    }
    let body = selected;
    if (body.length > MAX_SECTION_CONTEXT_CHARS) {
      body = `${body.slice(0, MAX_SECTION_CONTEXT_CHARS)}\n\n[selection truncated]`;
    }
    const text = `HedgeDoc selection context\n\n${body}\n\nQuestion: `;
    chrome.runtime.sendMessage({type: 'ASK_SECTION_CONTEXT', text}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        setStatus(`Ask failed: ${err.message}`);
        return;
      }
      if (!result?.ok) {
        setStatus(result?.error || 'Ask failed');
        return;
      }
      setStatus('Selection sent to Ask the Wiki');
    });
  }

  function askCurrentSection() {
    const section = currentSectionContext();
    if (!section?.text) {
      setStatus('No section context found');
      return;
    }
    const text = `HedgeDoc section context — ${section.heading}\n\n${section.text}\n\nQuestion: `;
    chrome.runtime.sendMessage({type: 'ASK_SECTION_CONTEXT', text}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        setStatus(`Ask § failed: ${err.message}`);
        return;
      }
      if (!result?.ok) {
        setStatus(result?.error || 'Ask § failed');
        return;
      }
      setStatus('Section sent to Ask the Wiki');
    });
  }

  function handleReaderClick(event) {
    if (!fromHereArmed) return;
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root || !(event.target instanceof Element) || !root.contains(event.target)) return;
    const node = event.target.closest(BLOCK_SELECTOR);
    if (!(node instanceof HTMLElement) || !root.contains(node)) return;
    event.preventDefault();
    event.stopPropagation();
    setFromHereArmed(false);
    startFromNode(node);
  }

  function handleKeyboard(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;

    const key = event.key.toLowerCase();
    if (key === ' ' && (speaking || paused)) {
      event.preventDefault();
      pauseResume();
    } else if (key === 'n') {
      event.preventDefault();
      nextSection();
    } else if (key === 'p') {
      event.preventDefault();
      previousSection();
    } else if (key === 's') {
      event.preventDefault();
      stopReading();
    } else if (key === 'r') {
      event.preventDefault();
      repeatSection();
    }
  }

  function injectControls() {
    if (!isReadableRendererFrame()) return;
    if (document.getElementById(CONTROL_ID)) return;

    const style = document.createElement('style');
    style.textContent = `
      ::highlight(whisper-reader-spoken) {
        background: #ffe66b;
        color: #111;
      }
      [${HIGHLIGHT_ATTR}="true"] {
        background: #fff3a3 !important;
        color: #111 !important;
        border-radius: 3px !important;
        box-shadow: inset 0 -0.22em 0 #ffe66b !important;
      }
      ${BLOCK_SELECTOR.split(',').map((s) => `[${FROM_HERE_ATTR}="true"] ${s}:hover`).join(',')} {
        cursor: crosshair !important;
        outline: 2px dashed #76b900 !important;
        outline-offset: 3px !important;
      }
      #${CONTROL_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        max-width: min(820px, calc(100vw - 32px));
        padding: 8px;
        border: 1px solid #ced4da;
        border-radius: 10px;
        background: rgba(255,255,255,.98);
        color: #212529;
        box-shadow: 0 6px 24px rgba(0,0,0,.16);
        font: 13px/1.2 system-ui, sans-serif;
      }
      #${CONTROL_ID} button {
        border: 1px solid #ced4da;
        border-radius: 7px;
        background: #f8f9fa;
        color: #212529;
        padding: 6px 9px;
        cursor: pointer;
        white-space: nowrap;
      }
      #${CONTROL_ID} button:hover { background: #e9ecef; }
      #${CONTROL_ID}-status {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: .82;
        padding: 0 4px;
      }
    `;
    document.documentElement.appendChild(style);

    const controls = document.createElement('div');
    controls.id = CONTROL_ID;
    controls.innerHTML = `
      <button type="button" data-action="read" title="Read document">🔊 Read</button>
      <button type="button" data-action="selection" title="Read selected text (also available from the Chrome context menu)">Selection</button>
      <button type="button" data-action="ask-selection" title="Put highlighted text into Ask the Wiki as context">Ask</button>
      <button type="button" data-action="from-here" title="Click, then click a paragraph or heading">📍 From here</button>
      <button type="button" data-action="prev" title="Previous Markdown heading (P)">◀ §</button>
      <button type="button" data-action="next" title="Next Markdown heading (N)">§ ▶</button>
      <button type="button" data-action="repeat" title="Repeat current section from its heading (R)">↻ §</button>
      <button type="button" data-action="skip" title="Skip current Markdown section">⏭ Skip §</button>
      <button type="button" data-action="ask" title="Put current section into Ask the Wiki">Ask §</button>
      <button type="button" data-action="code" title="Toggle code-block reading">Code: Skip</button>
      <button type="button" data-action="scroll" title="Toggle auto-scroll lock">🔒 Scroll</button>
      <button type="button" data-action="pause" title="Pause/resume (Space)">⏯</button>
      <button type="button" data-action="stop" title="Stop (S)">⏹</button>
      <span id="${CONTROL_ID}-status">Ready</span>
    `;
    controls.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'read') startReading(false);
      else if (action === 'selection') startReading(true);
      else if (action === 'ask-selection') askSelection();
      else if (action === 'from-here') setFromHereArmed(!fromHereArmed);
      else if (action === 'prev') previousSection();
      else if (action === 'next') nextSection();
      else if (action === 'repeat') repeatSection();
      else if (action === 'skip') skipSection();
      else if (action === 'ask') askCurrentSection();
      else if (action === 'code') toggleCodeMode();
      else if (action === 'scroll') toggleScrollLock();
      else if (action === 'pause') pauseResume();
      else if (action === 'stop') stopReading();
    });
    document.body.appendChild(controls);
    updateControlLabels();

    const root = document.querySelector(ROOT_SELECTOR);
    root?.addEventListener('click', handleReaderClick, true);
    document.addEventListener('keydown', handleKeyboard, true);
    window.addEventListener('pagehide', () => stopReading('Stopped'), {once: true});
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'READER_READ_SELECTION') return false;
    if (!isReadableRendererFrame()) return false;
    const text = normalize(message.text);
    if (!text) {
      sendResponse({ok: false, error: 'No selection text'});
      return false;
    }
    startReading(true, text);
    sendResponse({ok: true});
    return false;
  });

  function tryInit() {
    if (isReadableRendererFrame()) injectControls();
  }

  tryInit();
  const observer = new MutationObserver(() => tryInit());
  observer.observe(document.documentElement, {subtree: true, childList: true});
})();
