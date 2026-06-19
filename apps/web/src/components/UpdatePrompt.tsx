import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registers the service worker and keeps it fresh. With registerType
 * 'autoUpdate' a new deploy skips waiting and reloads the page automatically;
 * we also poll every 30 min so long-lived tabs pick up a deploy without a
 * manual refresh. Renders nothing — there's no prompt to show.
 */
export function UpdatePrompt() {
  useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
      }
    },
  });
  return null;
}
