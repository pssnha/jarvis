/**
 * Public marketing landing page shown to signed-out visitors. Advertises what
 * Jarvis does today and routes to either sign-up (a multi-step workflow) or
 * Google sign-in for existing members.
 */
export function Splash() {
  const goSignup = () => {
    window.location.hash = '#/signup';
  };

  return (
    <div className="splash">
      {/* Top bar */}
      <header className="splash-nav">
        <span className="splash-brand">Jarvis</span>
        <nav className="splash-nav-actions">
          <a className="splash-link" href="/api/auth/google/login">
            Sign in
          </a>
          <button className="splash-btn primary" onClick={goSignup}>
            Get started
          </button>
        </nav>
      </header>

      {/* Hero */}
      <section className="splash-hero">
        <span className="splash-eyebrow">One shared schedule for your people</span>
        <h1 className="splash-title">
          Your family's plans, organized — <span className="grad">without another app.</span>
        </h1>
        <p className="splash-sub">
          Jarvis keeps one shared calendar for your family, friends, or team. Everyone just chats
          on <strong>WhatsApp</strong> or forwards an <strong>email</strong>, and Jarvis turns it
          into appointments, reminders, and trips — in plain language.
        </p>
        <div className="splash-cta">
          <button className="splash-btn primary lg" onClick={goSignup}>
            Get started — it's free to try
          </button>
          <a className="splash-btn ghost lg" href="/api/auth/google/login">
            I already have a circle
          </a>
        </div>
        <p className="splash-note">No app store. No downloads. Works with the apps you already use.</p>
      </section>

      {/* Feature cards */}
      <section className="splash-features">
        <article className="splash-card">
          <div className="splash-ico" aria-hidden>💬</div>
          <h3>Just text WhatsApp</h3>
          <p>
            Jarvis hosts a dedicated WhatsApp group for your circle. Drop a message like “Dentist
            for Mia next Tuesday at 4” and it's on the calendar — for everyone, instantly.
          </p>
        </article>

        <article className="splash-card">
          <div className="splash-ico" aria-hidden>📧</div>
          <h3>Forward an email</h3>
          <p>
            Get an appointment confirmation or a flight itinerary? Forward it to your circle's
            Jarvis mailbox. It reads the details and adds the event, so nothing slips through.
          </p>
        </article>

        <article className="splash-card">
          <div className="splash-ico" aria-hidden>🗣️</div>
          <h3>Ask Alexa</h3>
          <p>
            Link your Amazon account and just ask: “Alexa, ask Home Assistant what's on today.”
            Your shared schedule, hands-free, on any Echo in the house.
          </p>
        </article>

        <article className="splash-card">
          <div className="splash-ico" aria-hidden>📅</div>
          <h3>One calendar, everywhere</h3>
          <p>
            See everything on the web, or subscribe to a private feed in Apple Calendar, Google
            Calendar, or Outlook. Reminders go out automatically before things happen.
          </p>
        </article>
      </section>

      {/* Why no app */}
      <section className="splash-why">
        <h2>Why no app to install?</h2>
        <p>
          Because the best app is the one your family already opens fifty times a day. Jarvis lives
          where the conversation already happens — your group chat and your inbox — so there's
          nothing new for anyone to learn, download, or remember to check. Grandparents, kids, and
          the least-techy person in the group are all on board from message one.
        </p>
        <ul className="splash-bullets">
          <li>✅ No downloads or logins for everyday members — they just chat</li>
          <li>✅ Natural language: write like you'd text a person</li>
          <li>✅ Private by design — your circle's data stays in your circle</li>
          <li>✅ Times handled in your group's time zone, automatically</li>
        </ul>
      </section>

      {/* How it works */}
      <section className="splash-steps">
        <h2>Up and running in minutes</h2>
        <div className="splash-steps-grid">
          <div className="splash-step">
            <span className="splash-step-num">1</span>
            <h4>Tell us about you</h4>
            <p>Name, email, and a WhatsApp number. Takes a minute.</p>
          </div>
          <div className="splash-step">
            <span className="splash-step-num">2</span>
            <h4>We review &amp; approve</h4>
            <p>A quick check, then we email you a link to finish setup.</p>
          </div>
          <div className="splash-step">
            <span className="splash-step-num">3</span>
            <h4>Connect &amp; go</h4>
            <p>Link WhatsApp and a mailbox, and your circle is live.</p>
          </div>
        </div>
        <div className="splash-cta center">
          <button className="splash-btn primary lg" onClick={goSignup}>
            Create your circle
          </button>
        </div>
      </section>

      <footer className="splash-foot">
        <span>© {new Date().getFullYear()} Jarvis</span>
        <span className="splash-foot-sep">·</span>
        <a className="splash-link" href="/privacy.html">
          Privacy
        </a>
        <span className="splash-foot-sep">·</span>
        <a className="splash-link" href="mailto:jarvis@passanha.com">
          jarvis@passanha.com
        </a>
      </footer>
    </div>
  );
}
