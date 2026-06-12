import { useState } from 'react';
import { submitSignup } from '../lib/api';

/**
 * Step 1 of onboarding: collect the applicant's details and record their
 * acceptance of the terms. On submit, the site admin is emailed to review.
 */
export function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [circleName, setCircleName] = useState('');
  const [phone, setPhone] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!accept) {
      setError('Please accept the terms to continue.');
      return;
    }
    setBusy(true);
    try {
      await submitSignup({
        name: name.trim(),
        email: email.trim(),
        circleName: circleName.trim() || undefined,
        phone: phone.trim(),
        acceptTerms: accept,
      });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="onboard">
        <div className="onboard-card">
          <div className="onboard-ico" aria-hidden>📨</div>
          <h1>Thanks, {name.split(' ')[0] || 'there'}!</h1>
          <p className="muted">
            Your request is in. We'll review it shortly and email{' '}
            <strong>{email}</strong> a link to finish setting up your circle.
          </p>
          <a className="onboard-btn ghost" href="/#/">
            Back to home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard">
      <form className="onboard-card" onSubmit={onSubmit}>
        <div className="onboard-steps">
          <span className="dot on" /> <span className="dot" /> <span className="dot" />
          <span className="onboard-steplabel">Step 1 of 3 · About you</span>
        </div>
        <h1>Create your circle</h1>
        <p className="muted">
          Tell us a little about yourself. Once approved, you'll connect WhatsApp and email.
        </p>

        <label className="onboard-field">
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Rivera"
            autoComplete="name"
            required
          />
        </label>

        <label className="onboard-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          <span className="onboard-hint">We'll send your approval and setup link here.</span>
        </label>

        <label className="onboard-field">
          WhatsApp number
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 415 555 0123"
            autoComplete="tel"
            required
          />
          <span className="onboard-hint">Include your country code. Ideally a WhatsApp-enabled number.</span>
        </label>

        <label className="onboard-field">
          Circle name <span className="onboard-optional">(optional)</span>
          <input
            value={circleName}
            onChange={(e) => setCircleName(e.target.value)}
            placeholder="The Rivera Family"
          />
          <span className="onboard-hint">What should we call your shared schedule?</span>
        </label>

        <label className="onboard-terms">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            I agree to the{' '}
            <a href="/privacy.html" target="_blank" rel="noreferrer">
              Terms &amp; Privacy Policy
            </a>
            . I understand Jarvis processes messages and emails I send it to manage my circle's
            schedule.
          </span>
        </label>

        {error && <p className="onboard-error">{error}</p>}

        <button className="onboard-btn primary" type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Request access'}
        </button>
        <a className="onboard-back" href="/#/">
          ← Back
        </a>
      </form>
    </div>
  );
}
