export function Login() {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Jarvis</h1>
        <p className="muted">Shared scheduling for your group.</p>
        <a className="google-btn" href="/api/auth/google/login">
          Sign in with Google
        </a>
        <p className="login-note">
          Access is invite-only. If your Google account hasn’t been added yet, ask an admin.
        </p>
      </div>
    </div>
  );
}
