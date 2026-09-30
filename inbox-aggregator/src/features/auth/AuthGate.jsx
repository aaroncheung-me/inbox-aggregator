import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import App from '../../App';
import LoginScreen from './LoginScreen';

// Shows the login screen until there's a Supabase session, then the app.
// Supabase keeps the session in the browser and refreshes it, so this only
// shows once per device until you sign out.
function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // also fires when a sign-in link is opened and on sign-out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <LoginScreen />;

  // keyed by user so signing in as someone else starts from a clean slate
  return (
    <App
      key={session.user.id}
      userEmail={session.user.email}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}

export default AuthGate;
