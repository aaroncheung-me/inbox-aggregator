import { useState } from 'react';
import { supabase } from '../supabase';

// Signing in: enter your email, then either click the link in the email or
// type the code from it here. The code matters on iPhone: an app added to the
// home screen keeps its own sign-in, separate from Safari, and links in emails
// always open in Safari, so only the code can sign the home-screen app in.
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function sendEmail(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const address = email.trim();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: window.location.origin,
        // accounts are created in the Supabase dashboard, never from this form
        shouldCreateUser: false,
      },
    });

    setBusy(false);
    if (!sendError) {
      setSentTo(address);
    } else if (/signup/i.test(sendError.message)) {
      // with sign-ups off, an unknown address comes back as "signups not allowed"
      setError("There's no account for that email");
    } else if (/rate limit/i.test(sendError.message)) {
      setError('Too many sign-in emails have been sent recently. Wait a while and try again, or use a code from an email you already got.');
    } else {
      setError(sendError.message);
    }
  }

  // On success Supabase stores the session, and the app opens by itself.
  async function verifyCode(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' });
    setBusy(false);
    if (verifyError) {
      setError(/expired|invalid/i.test(verifyError.message)
        ? 'That code is wrong or has expired. Check the newest email, or send a new one.'
        : verifyError.message);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Inbox</h1>

        {sentTo ? (
          <form onSubmit={verifyCode}>
            <p className="login-hint">
              We emailed <strong>{sentTo}</strong>. Type the code from it below, or click the link in it
              (the link won't sign in an app added to your iPhone's home screen, the code will).
            </p>
            <label className="field">
              <span>Code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                required
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="btn login-submit" disabled={busy || code.length < 6}>
              {busy ? 'Checking...' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn btn-ghost login-secondary"
              onClick={() => { setSentTo(null); setCode(''); setError(null); }}
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={sendEmail}>
            <p className="login-hint">Enter your email and we'll send you a sign-in code and link.</p>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="btn login-submit" disabled={busy}>
              {busy ? 'Sending...' : 'Send sign-in email'}
            </button>
            {/* for when the previous email's code is still usable */}
            <button
              type="button"
              className="btn btn-ghost login-secondary"
              onClick={() => { if (email.trim()) { setSentTo(email.trim()); setError(null); } }}
              disabled={!email.trim()}
            >
              I already have a code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default LoginScreen;
