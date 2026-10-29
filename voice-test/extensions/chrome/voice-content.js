'use strict';
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || msg.channel !== 'whisper-askwiki-v1' || msg.type !== 'transcript') return;
  if (typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 6000) return;
  if (typeof msg.id !== 'string' || !msg.id || msg.id.length > 100) return;
  const mode = msg.mode === 'hedgedoc' ? 'hedgedoc' : 'wiki';
  chrome.runtime.sendMessage({type: 'FORWARD_TO_WIKI', id: msg.id, text: msg.text.trim(), mode}, (reply) => {
    const err = chrome.runtime.lastError;
    window.postMessage({
      channel: 'whisper-askwiki-v1', type: 'result', id: msg.id,
      ok: !err && reply?.ok === true,
      error: err?.message || reply?.error || null,
    }, window.location.origin);
  });
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!window.location.pathname.startsWith('/voice')) return false;

  if (message?.type === 'WIKI_CHAT_BROADCAST') {
    window.postMessage({
      channel: 'whisper-askwiki-v1', type: 'chat-answer-update',
      streamId: message.streamId, text: message.text || '',
      seq: message.seq, done: message.done === true,
      error: message.error || null,
    }, window.location.origin);
    sendResponse({ok: true});
    return false;
  }

  if (message?.type !== 'WIKI_ANSWER_UPDATE') return false;
  window.postMessage({
    channel: 'whisper-askwiki-v1', type: 'answer-update',
    id: message.id, text: message.text || '',
    seq: message.seq, done: message.done === true,
    error: message.error || null,
  }, window.location.origin);
  sendResponse({ok: true});
  return false;
});
