import { useState } from 'react';
import { supabase } from '../supabase';

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSending(true);
    setError(null);

    const address = email.trim();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: window.location.origin,
        // accounts are created in the Supabase dashboard, never from this form
        shouldCreateUser: false,
      },
    });

    setSending(false);
    if (signInError) {
      // with sign-ups off, an unknown address comes back as "signups not allowed"
      setError(/signup/i.test(signInError.message)
        ? "There's no account for that email"
        : signInError.message);
    } else {
      setSentTo(address);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Inbox</h1>

        {sentTo ? (
          <>
            <p>Check <strong>{sentTo}</strong> for a sign-in link. You can close this tab once you've used it.</p>
            <button className="btn btn-ghost" onClick={() => setSentTo(null)}>
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="login-hint">Enter your email and we'll send you a link to sign in.</p>
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
            <button type="submit" className="btn login-submit" disabled={sending}>
              {sending ? 'Sending...' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default LoginScreen;
