'use strict';

// Correlate the voice frame with its Wiki chat turn. Persist across MV3 sleeps.
const VOICE = 'http://192.168.1.142:8766/';
const WIKI = 'http://192.168.1.142:8180/';
const MAX_AGE_MS = 6 * 60 * 1000;
const READ_SELECTION_MENU_ID = 'whisper-read-selection';
const keyFor = (id) => 'wiki-turn:' + id;

function installReaderContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: READ_SELECTION_MENU_ID,
      title: 'Read selection aloud',
      contexts: ['selection'],
      documentUrlPatterns: [WIKI + '*'],
    }, () => void chrome.runtime.lastError);
  });
}

chrome.runtime.onInstalled.addListener(installReaderContextMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== READ_SELECTION_MENU_ID || !info.selectionText || typeof tab?.id !== 'number') return;
  const options = Number.isInteger(info.frameId) ? {frameId: info.frameId} : undefined;
  chrome.tabs.sendMessage(tab.id, {
    type: 'READER_READ_SELECTION',
    text: info.selectionText,
  }, options, () => void chrome.runtime.lastError);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'FORWARD_TO_WIKI') {
    if (!sender.url?.startsWith(VOICE) || typeof sender.tab?.id !== 'number' ||
        !Number.isInteger(sender.frameId) ||
        typeof message.id !== 'string' || message.id.length > 100 || !message.id ||
        typeof message.text !== 'string' || !message.text.trim() || message.text.length > 6000 ||
        !['wiki', 'hedgedoc', undefined].includes(message.mode)) {
      sendResponse({ok: false, error: 'Invalid voice request'});
      return false;
    }
    (async () => {
      const mode = message.mode === 'hedgedoc' ? 'hedgedoc' : 'wiki';
      const tabs = await chrome.tabs.query({url: WIKI + '*'});
      if (!tabs.length) return {ok: false, error: 'Open Ask the wiki on :8180 first'};
      const ordered = [...tabs].sort((a, b) => Number(b.active) - Number(a.active));
      let reason = 'No Ask the wiki chat input found';
      for (const tab of ordered) {
        if (typeof tab.id !== 'number') continue;
        try {
          await chrome.storage.session.set({[keyFor(message.id)]: {
            voiceTabId: sender.tab.id, voiceFrameId: sender.frameId,
            wikiTabId: tab.id, createdAt: Date.now(),
          }});
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: mode === 'hedgedoc' ? 'INSERT_ASK_WIKI_MANUAL' : 'INSERT_ASK_WIKI',
            text: message.text, id: message.id,
          }, {frameId: 0});
          if (result?.ok) return {ok: true, mode};
          if (result?.error) reason = result.error;
        } catch (_) { /* Not all HedgeDoc frames contain the chat. */ }
        await chrome.storage.session.remove(keyFor(message.id));
      }
      return {ok: false, error: reason};
    })().then(sendResponse).catch(async (err) => {
      await chrome.storage.session.remove(keyFor(message.id)).catch(() => {});
      sendResponse({ok: false, error: String(err?.message || err)});
    });
    return true;
  }

  if (message?.type === 'ASK_SECTION_CONTEXT') {
    if (!sender.url?.startsWith(WIKI) || typeof sender.tab?.id !== 'number' ||
        typeof message.text !== 'string' || !message.text.trim() || message.text.length > 5900) {
      sendResponse({ok: false, error: 'Invalid section context'});
      return false;
    }
    (async () => {
      const tabs = await chrome.tabs.query({url: WIKI + '*'});
      if (!tabs.length) return {ok: false, error: 'Open Ask the Wiki chat on :8180 first'};
      const ordered = [...tabs].sort((a, b) => {
        const aChat = a.url?.includes('/memex-wiki/chat') ? 1 : 0;
        const bChat = b.url?.includes('/memex-wiki/chat') ? 1 : 0;
        if (aChat !== bChat) return bChat - aChat;
        return Number(b.active) - Number(a.active);
      });
      let reason = 'No Ask the Wiki chat input found';
      for (const tab of ordered) {
        if (typeof tab.id !== 'number') continue;
        try {
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: 'INSERT_ASK_WIKI_CONTEXT',
            text: message.text,
          }, {frameId: 0});
          if (result?.ok) return {ok: true, tabId: tab.id};
          if (result?.error) reason = result.error;
        } catch (_) { /* Try the next HedgeDoc tab. */ }
      }
      return {ok: false, error: reason};
    })().then(sendResponse).catch((err) => {
      sendResponse({ok: false, error: String(err?.message || err)});
    });
    return true;
  }

  if (message?.type === 'WIKI_CHAT_BROADCAST') {
    if (!sender.url?.startsWith(WIKI) || typeof sender.tab?.id !== 'number' ||
        typeof message.streamId !== 'string' || !message.streamId || message.streamId.length > 120 ||
        !Number.isSafeInteger(message.seq) || message.seq < 1 ||
        typeof message.text !== 'string' || message.text.length > 18000 ||
        typeof message.done !== 'boolean') return false;
    (async () => {
      const payload = {
        type: 'WIKI_CHAT_BROADCAST',
        streamId: message.streamId,
        seq: message.seq,
        text: message.text,
        done: message.done,
        error: typeof message.error === 'string' ? message.error.slice(0, 400) : null,
      };
      let delivered = false;
      const voiceTabs = await chrome.tabs.query({url: VOICE + '*'});
      for (const voiceTab of voiceTabs) {
        if (typeof voiceTab.id !== 'number') continue;
        try {
          await chrome.tabs.sendMessage(voiceTab.id, payload);
          delivered = true;
        } catch (_) { /* The top page is not the /voice iframe. */ }
      }
      return {ok: delivered};
    })().then(sendResponse).catch((err) => {
      sendResponse({ok: false, error: String(err?.message || err)});
    });
    return true;
  }

  if (message?.type === 'WIKI_ANSWER_UPDATE') {
    if (!sender.url?.startsWith(WIKI) || typeof sender.tab?.id !== 'number' ||
        typeof message.id !== 'string' || !message.id || message.id.length > 100 ||
        !Number.isSafeInteger(message.seq) || message.seq < 0 ||
        typeof message.text !== 'string' || message.text.length > 18000 ||
        typeof message.done !== 'boolean') return false;
    (async () => {
      const key = keyFor(message.id);
      const turn = (await chrome.storage.session.get(key))[key];
      const payload = {
        type: 'WIKI_ANSWER_UPDATE', id: message.id,
        text: message.text,
        done: message.done,
        seq: message.seq,
        error: typeof message.error === 'string' ? message.error.slice(0, 400) : null,
      };

      // Preferred route: the exact :8766 iframe that originated this turn.
      // In HedgeDoc Ask mode the user may wait before pressing Enter, so the
      // iframe/service-worker route can change while the Wiki is answering.
      let delivered = false;
      if (turn && turn.wikiTabId === sender.tab.id &&
          Date.now() - turn.createdAt <= MAX_AGE_MS) {
        try {
          await chrome.tabs.sendMessage(turn.voiceTabId, payload, {frameId: turn.voiceFrameId});
          delivered = true;
        } catch (_) { /* Fall back to discovery below. */ }
      }

      // Recovery route: deliver to any open :8766 voice frame. The page still
      // checks the turn id, so unrelated voice turns ignore the message.
      if (!delivered) {
        const voiceTabs = await chrome.tabs.query({url: VOICE + '*'});
        for (const voiceTab of voiceTabs) {
          if (typeof voiceTab.id !== 'number') continue;
          try {
            await chrome.tabs.sendMessage(voiceTab.id, payload);
            delivered = true;
          } catch (_) { /* No /voice content frame in this tab. */ }
        }
      }

      if (message.done) await chrome.storage.session.remove(key).catch(() => {});
      return {ok: delivered};
    })().then(sendResponse).catch((err) => {
      sendResponse({ok: false, error: String(err?.message || err)});
    });
    return true;
  }
  return false;
});
