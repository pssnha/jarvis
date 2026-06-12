export const SESSION_COOKIE = 'jarvis_session';
/** Where to send the browser after Google login (e.g. an OAuth /authorize URL). */
export const OAUTH_RETURN_COOKIE = 'jarvis_oauth_return';
/**
 * Set on explicit sign-out. While present, the dev auth-bypass is suppressed so
 * the logout button actually logs you out locally (cleared on the next login).
 */
export const SIGNED_OUT_COOKIE = 'jarvis_signed_out';
