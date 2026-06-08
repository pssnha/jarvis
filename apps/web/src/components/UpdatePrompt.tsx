import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Shows a small toast when a new deploy is available so users don't have to
 * hard-reload. The new service worker waits (registerType: 'prompt') until the
 * user clicks Reload, at which point we activate it and refresh.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Poll for a new build every 30 min while the app stays open.
      if (registration) {
        setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="update-toast" role="status">
      <span>A new version of Jarvis is available.</span>
      <div className="update-actions">
        <button className="primary" onClick={() => updateServiceWorker(true)}>
          Reload
        </button>
        <button onClick={() => setNeedRefresh(false)}>Later</button>
      </div>
    </div>
  );
}
