# Image sharing fallbacks

The **Share** action in **File → Export PNG** uses one fixed, local fallback
chain. It does not load code, contact a service, or request permission while
detecting capabilities.

1. **Web Share API** — used only when `navigator.share`, `navigator.canShare`,
   and PNG file sharing are all reported as available. Cancelling the native
   share sheet ends the action without an error or another side effect.
2. **Clipboard API** — used when file sharing is unavailable or fails. This
   writes only the generated PNG image and is attempted only from the user's
   Share action.
3. **Download** — uses the application's existing FileSaver path when neither
   API is available, or when clipboard access is denied or fails.

PNG encoding failures and download failures use the existing export error
dialog. Intermediate API failures are logged and automatically continue to the
next route; they do not discard or modify the drawing.

The capability result is an immutable snapshot. Removing the Share button
handler and the standalone helpers in `src/image-export.js` restores the
previous independent Export and Copy behavior; no data migration, dependency,
feature flag, or production-control rollback is required.
