Whisper Voice -> Ask the wiki -> spoken answer, v0.2.0

Only this standalone voice-test and the Windows Chrome extension are updated.
No HedgeDoc source, builds, services, or nodeBook callbacks are changed.

1. Back up /data/projects/whisper/voice-test/voice.html and index.html.
2. Copy voice.html and index.html to /data/projects/whisper/voice-test/.
3. On Windows, replace all FOUR Chrome extension files in the existing
   locally-installed unpacked extension directory with extension/*.
4. Open chrome://extensions and click Reload on the extension; refresh both tabs.
5. Open :8180/memex-wiki/chat and :8766, click Voice ON, ask a question.
6. The :8766 panel should show VOICE TRANSCRIPT, then WIKI ANSWER,
   speak the response, and automatically resume listening.

The extension observes [data-memex-answer] and [aria-label=Thinking]
in the existing chat UI. It never calls the RAG endpoint directly.
The existing Whisper API and voice-test service do not require restarts.

Notes: only answers for questions forwarded by this extension are spoken.
Chrome voices depend on the operating system. Do not install push-to-talk.
