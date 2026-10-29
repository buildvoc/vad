'use strict';

// Stream already-rendered assistant text from existing Wiki chat. No RAG calls.
// [data-memex-answer] is the streamed answer; [aria-label="Thinking"] denotes
// ongoing generation. The final event is emitted only after it disappears.
function observeWikiAnswer(id, originalCount) {
  const startedAt = Date.now();
  let lastText = '';
  let lastChangedAt = 0;
  let seq = 0;
  let stopped = false;
  const send = (text, done = false, error = null) => {
    if (stopped) return;
    seq++;
    chrome.runtime.sendMessage({
      type: 'WIKI_ANSWER_UPDATE', id, seq, text: text.slice(0, 18000), done, error,
    }, () => void chrome.runtime.lastError);
    if (done) stopped = true;
  };
  const poll = setInterval(() => {
    if (stopped) { clearInterval(poll); return; }
    if (Date.now() - startedAt > 300000) {
      clearInterval(poll);
      send(lastText, true, 'Timed out waiting for the wiki answer');
      return;
    }
    const answers = document.querySelectorAll('[data-memex-answer="true"]');
    if (answers.length <= originalCount) return;
    const node = answers[answers.length - 1];
    const text = (node.innerText || node.textContent || '').trim();
    if (text !== lastText) {
      lastText = text;
      lastChangedAt = Date.now();
      if (text) send(text);
      return;
    }
    if (document.querySelector('[aria-label="Thinking"]')) return;
    if (text && Date.now() - lastChangedAt >= 900) {
      clearInterval(poll);
      send(text, true);
    }
  }, 220);
}

function setAskWikiInput(text, {appendExisting = false} = {}) {
  const textarea = document.querySelector('textarea[aria-label="Ask the wiki"]');
  if (!textarea) return {ok: false, error: 'No Ask the Wiki chat input found'};
  if (document.querySelector('[aria-label="Thinking"]')) {
    return {ok: false, error: 'Ask the Wiki is still answering'};
  }
  const incoming = String(text || '').trimEnd();
  if (!incoming || incoming.length > 5900) return {ok: false, error: 'Invalid Wiki input'};

  const existing = textarea.value.trim();
  const combined = appendExisting && existing
    ? `${incoming}\n\n${existing}`
    : incoming;
  if (combined.length > 6000) return {ok: false, error: 'Ask the Wiki input would exceed 6000 characters'};

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!nativeSetter) return {ok: false, error: 'Textarea setter unavailable'};
  nativeSetter.call(textarea, combined);
  textarea.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    data: combined,
    inputType: 'insertText',
  }));
  textarea.focus();
  textarea.setSelectionRange(combined.length, combined.length);
  return {ok: true, textarea, combined};
}



function armManualWikiSubmission(id, originalCount, textarea) {
  const startedAt = Date.now();
  let armed = true;
  const poll = setInterval(() => {
    if (!armed) { clearInterval(poll); return; }
    if (Date.now() - startedAt > 300000) {
      armed = false;
      clearInterval(poll);
      chrome.runtime.sendMessage({
        type: 'WIKI_ANSWER_UPDATE', id, seq: 0, text: '', done: true,
        error: 'Timed out waiting for Enter in Ask the Wiki',
      }, () => void chrome.runtime.lastError);
      return;
    }
    const answerCount = document.querySelectorAll('[data-memex-answer="true"]').length;
    const liveTextarea = document.querySelector('textarea[aria-label="Ask the wiki"]');
    const inputCleared = !liveTextarea || !liveTextarea.value.trim();
    const submitted = inputCleared &&
      (Boolean(document.querySelector('[aria-label="Thinking"]')) || answerCount > originalCount);
    if (!submitted) return;
    armed = false;
    clearInterval(poll);
    observeWikiAnswer(id, originalCount);
  }, 120);
}

function insertManualHedgeDocQuestion(text, id) {
  const textarea = document.querySelector('textarea[aria-label="Ask the wiki"]');
  if (!textarea) return {ok: false, error: 'No Ask the Wiki chat input found'};
  if (document.querySelector('[aria-label="Thinking"]')) {
    return {ok: false, error: 'Ask the Wiki is still answering'};
  }
  const question = String(text || '').trim();
  if (!question || question.length > 3000 || typeof id !== 'string' || !id) {
    return {ok: false, error: 'Invalid HedgeDoc voice question'};
  }
  const existing = textarea.value.trimEnd();
  if (!existing) {
    return {ok: false, error: 'No HedgeDoc context loaded. Highlight text in HedgeDoc View and click Ask first.'};
  }
  const combined = /Question:\s*$/i.test(existing)
    ? `${existing} ${question}`
    : `${existing}\n\nQuestion: ${question}`;
  if (combined.length > 6000) {
    return {ok: false, error: 'HedgeDoc context plus question exceeds 6000 characters'};
  }
  const initialAnswerCount = document.querySelectorAll('[data-memex-answer="true"]').length;
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!nativeSetter) return {ok: false, error: 'Textarea setter unavailable'};
  nativeSetter.call(textarea, combined);
  textarea.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    data: combined,
    inputType: 'insertText',
  }));
  textarea.focus();
  textarea.setSelectionRange(combined.length, combined.length);
  armManualWikiSubmission(id, initialAnswerCount, textarea);
  return {ok: true};
}

// GENERIC_CHAT_ANSWER_BROADCAST_V076
// Any Ask-the-Wiki submission (typed, voice, or HedgeDoc-context) gets a second,
// ID-independent answer stream. This lets :8766 speak chat answers even when
// the question did not originate from a voice turn.
function observeGenericWikiAnswer(originalCount) {
  const streamId = 'chat-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const startedAt = Date.now();
  let lastText = '';
  let lastChangedAt = 0;
  let seq = 0;
  let stopped = false;

  const send = (text, done = false, error = null) => {
    if (stopped) return;
    seq += 1;
    chrome.runtime.sendMessage({
      type: 'WIKI_CHAT_BROADCAST',
      streamId,
      seq,
      text: String(text || '').slice(0, 18000),
      done,
      error,
    }, () => void chrome.runtime.lastError);
    if (done) stopped = true;
  };

  const poll = setInterval(() => {
    if (stopped) { clearInterval(poll); return; }
    if (Date.now() - startedAt > 300000) {
      clearInterval(poll);
      send(lastText, true, 'Timed out waiting for the wiki answer');
      return;
    }
    const answers = document.querySelectorAll('[data-memex-answer="true"]');
    if (answers.length <= originalCount) return;
    const node = answers[answers.length - 1];
    const text = (node.innerText || node.textContent || '').trim();
    if (text !== lastText) {
      lastText = text;
      lastChangedAt = Date.now();
      if (text) send(text, false);
      return;
    }
    if (document.querySelector('[aria-label="Thinking"]')) return;
    if (text && Date.now() - lastChangedAt >= 900) {
      clearInterval(poll);
      send(text, true);
    }
  }, 180);
}

// Capture the existing Ask-the-Wiki Enter action. This sees normal user Enter
// and the synthetic Enter used by the existing voice bridge.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  if (target.getAttribute('aria-label') !== 'Ask the wiki') return;
  if (!target.value.trim()) return;
  if (document.querySelector('[aria-label="Thinking"]')) return;
  const originalCount = document.querySelectorAll('[data-memex-answer="true"]').length;
  setTimeout(() => observeGenericWikiAnswer(originalCount), 0);
}, true);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'INSERT_ASK_WIKI_MANUAL') {
    const result = insertManualHedgeDocQuestion(message.text, message.id);
    sendResponse(result);
    return false;
  }

  if (message?.type === 'INSERT_ASK_WIKI_CONTEXT') {
    const result = setAskWikiInput(message.text, {appendExisting: true});
    sendResponse(result.ok ? {ok: true} : result);
    return false;
  }

  if (message?.type !== 'INSERT_ASK_WIKI') return false;
  const textarea = document.querySelector('textarea[aria-label="Ask the wiki"]');
  if (!textarea) {
    sendResponse({ok: false, error: 'No Ask the Wiki chat input found'});
    return false;
  }
  if (textarea.value.trim()) {
    sendResponse({ok:false, error:'Ask the wiki has unsent text; not overwriting it'});
    return false;
  }
  if (document.querySelector('[aria-label="Thinking"]')) {
    sendResponse({ok:false, error:'Ask the wiki is still answering; try again after it finishes'});
    return false;
  }
  const text = String(message.text || '').trim();
  if (!text || text.length > 6000 || typeof message.id !== 'string' || !message.id) {
    sendResponse({ok:false, error:'Invalid transcript or turn ID'});
    return false;
  }
  const initialAnswerCount = document.querySelectorAll('[data-memex-answer="true"]').length;
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!nativeSetter) {
    sendResponse({ok:false, error:'Textarea setter unavailable'});
    return false;
  }
  nativeSetter.call(textarea, text);
  textarea.dispatchEvent(new InputEvent('input', {bubbles:true, data:text, inputType:'insertText'}));
  setTimeout(() => {
    if (!textarea.isConnected || textarea.value !== text) {
      sendResponse({ok:false, error:'Chat input changed before submission'});
      return;
    }
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key:'Enter', code:'Enter', bubbles:true, cancelable:true,
    }));
    setTimeout(() => {
      if (textarea.value.trim()) {
        sendResponse({ok:false, error:'Auto-send not confirmed. Press Enter in Ask the wiki.'});
      } else {
        sendResponse({ok:true});
        observeWikiAnswer(message.id, initialAnswerCount);
      }
    }, 250);
  }, 180);
  return true;
});
