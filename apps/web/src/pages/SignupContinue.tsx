import { useEffect, useState } from 'react';
import {
  getSignupResume,
  signupComplete,
  signupSetEmail,
  signupSetWhatsApp,
} from '../lib/api';
import type { SignupPublic } from '../lib/types';

/**
 * Post-approval onboarding (steps 4–6), reached via the resume link emailed to
 * the applicant: #/welcome/<token>. Drives a small state machine off the
 * server's reported `step` so a refresh always resumes in the right place.
 */
export function SignupContinue({ token }: { token: string }) {
  const [view, setView] = useState<SignupPublic | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSignupResume(token)
      .then(setView)
      .catch((e) => {
        setView(null);
        setError((e as Error).message);
      });
  }, [token]);

  if (view === undefined) {
    return (
      <div className="onboard">
        <div className="onboard-card">
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (view === null) {
    return (
      <div className="onboard">
        <div className="onboard-card">
          <div className="onboard-ico" aria-hidden>🔗</div>
          <h1>Link not found</h1>
          <p className="muted">{error || 'This setup link is invalid or has expired.'}</p>
          <a className="onboard-btn ghost" href="/#/">
            Back to home
          </a>
        </div>
      </div>
    );
  }

  if (view.status === 'pending_review') {
    return (
      <Notice
        ico="⏳"
        title="Almost there"
        body="Your request is still being reviewed. We'll email you the moment it's approved."
      />
    );
  }
  if (view.status === 'rejected') {
    return (
      <Notice
        ico="🚫"
        title="Not approved"
        body="This sign-up wasn't approved. If you think this is a mistake, reply to our email."
      />
    );
  }
  if (view.status === 'completed') {
    return <Completed />;
  }

  // status === 'approved' → run the setup wizard from the server-reported step.
  return (
    <div className="onboard">
      <div className="onboard-card wide">
        <WizardHeader step={view.step} />
        {view.step === 'whatsapp' && <WhatsAppStep token={token} onNext={setView} />}
        {view.step === 'email' && <EmailStep token={token} onNext={setView} />}
        {view.step === 'finish' && <FinishStep token={token} view={view} />}
      </div>
    </div>
  );
}

function WizardHeader({ step }: { step: SignupPublic['step'] }) {
  const idx = step === 'whatsapp' ? 0 : step === 'email' ? 1 : 2;
  const labels = ['Connect WhatsApp', 'Connect email', 'Finish'];
  return (
    <div className="onboard-steps">
      {[0, 1, 2].map((i) => (
        <span key={i} className={i <= idx ? 'dot on' : 'dot'} />
      ))}
      <span className="onboard-steplabel">
        Step {idx + 2} of 3 · {labels[idx]}
      </span>
    </div>
  );
}

function WhatsAppStep({
  token,
  onNext,
}: {
  token: string;
  onNext: (v: SignupPublic) => void;
}) {
  const [waNumber, setWaNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onNext(await signupSetWhatsApp(token, waNumber.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Give Jarvis a WhatsApp number</h1>
      <p className="muted">
        This is the dedicated number Jarvis uses to talk to your circle. It should be a number you
        can link as a WhatsApp account (a spare SIM or a WhatsApp Business number works well).
      </p>

      <label className="onboard-field">
        Jarvis's WhatsApp number
        <input
          type="tel"
          value={waNumber}
          onChange={(e) => setWaNumber(e.target.value)}
          placeholder="+1 415 555 0123"
          required
        />
        <span className="onboard-hint">Include the country code.</span>
      </label>

      <div className="onboard-callout">
        <strong>How your circle will use it</strong>
        <ol>
          <li>After your circle is created, you'll link this number from your dashboard (scan a QR code — just like WhatsApp Web).</li>
          <li>Create <em>one</em> WhatsApp group for your circle and add this Jarvis number to it.</li>
          <li>Everyone in the group can then just chat naturally — “Soccer practice moved to 6pm” — and Jarvis keeps the calendar.</li>
        </ol>
        <p className="onboard-hint">Note: each circle can have exactly one WhatsApp group.</p>
      </div>

      {error && <p className="onboard-error">{error}</p>}
      <button className="onboard-btn primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}

function EmailStep({ token, onNext }: { token: string; onNext: (v: SignupPublic) => void }) {
  const [address, setAddress] = useState('');
  const [credential, setCredential] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onNext(
        await signupSetEmail(token, {
          address: address.trim(),
          credential: credential.trim(),
          host: advanced && host.trim() ? host.trim() : undefined,
          port: advanced && port.trim() ? Number(port) : undefined,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Connect a mailbox</h1>
      <p className="muted">
        Your circle gets a dedicated mailbox. Forward appointment confirmations and itineraries to
        it, and Jarvis turns them into events. We support Gmail, Outlook, Yahoo, iCloud, AOL, and
        most IMAP providers.
      </p>

      <label className="onboard-field">
        Email address
        <input
          type="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="jarvis.rivera@gmail.com"
          required
        />
      </label>

      <label className="onboard-field">
        Password or app-password
        <input
          type="password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="off"
          required
        />
        <span className="onboard-hint">
          Most providers (Gmail, Yahoo, iCloud) require an <strong>app-password</strong> with
          2-step verification + IMAP enabled. We verify the login before saving.
        </span>
      </label>

      <button
        type="button"
        className="onboard-toggle"
        onClick={() => setAdvanced((a) => !a)}
      >
        {advanced ? 'Hide' : 'Advanced'} IMAP settings
      </button>
      {advanced && (
        <div className="onboard-grid2">
          <label className="onboard-field">
            IMAP host
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="auto-detected" />
          </label>
          <label className="onboard-field">
            Port
            <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="993" />
          </label>
        </div>
      )}

      {error && <p className="onboard-error">{error}</p>}
      <button className="onboard-btn primary" type="submit" disabled={busy}>
        {busy ? 'Verifying…' : 'Verify & continue'}
      </button>
    </form>
  );
}

function FinishStep({ token, view }: { token: string; view: SignupPublic }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      await signupComplete(token);
      setCreated(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) return <Completed inline />;

  return (
    <div>
      <h1>Review &amp; create your circle</h1>
      <p className="muted">Here's what we'll set up. You can fine-tune everything later.</p>

      <ul className="onboard-review">
        <li>
          <span>Circle</span>
          <strong>{view.circleName || `${view.name}'s circle`}</strong>
        </li>
        <li>
          <span>Owner</span>
          <strong>
            {view.name} · {view.email}
          </strong>
        </li>
        <li>
          <span>WhatsApp</span>
          <strong>{view.waNumber}</strong>
        </li>
        <li>
          <span>Mailbox</span>
          <strong>{view.emailAddress}</strong>
        </li>
      </ul>

      {error && <p className="onboard-error">{error}</p>}
      <button className="onboard-btn primary" onClick={finish} disabled={busy}>
        {busy ? 'Creating your circle…' : 'Create my circle'}
      </button>
    </div>
  );
}

/** Final success state — the circle exists; sign in to use it. */
function Completed({ inline }: { inline?: boolean }) {
  const body = (
    <>
      <div className="onboard-ico" aria-hidden>🎉</div>
      <h1>Your circle is live!</h1>
      <p className="muted">
        Sign in with the email you used to open your dashboard, link your WhatsApp number, and
        start adding events.
      </p>
      <a className="onboard-btn primary" href="/api/auth/google/login">
        Sign in to your dashboard
      </a>
    </>
  );
  if (inline) return <div className="onboard-center">{body}</div>;
  return (
    <div className="onboard">
      <div className="onboard-card">{body}</div>
    </div>
  );
}

function Notice({ ico, title, body }: { ico: string; title: string; body: string }) {
  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="onboard-ico" aria-hidden>{ico}</div>
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        <a className="onboard-btn ghost" href="/#/">
          Back to home
        </a>
      </div>
    </div>
  );
}
