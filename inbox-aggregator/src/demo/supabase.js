// The demo's stand-in for src/supabase.js (swapped in by vite.config.js):
// always signed in as the made-up demo user, with nothing sent anywhere.

import { DEMO_USER } from './data';

const session = { access_token: 'demo', token_type: 'bearer', user: DEMO_USER };

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    // Sign out starts the demo over: everything lives in memory, so a reload
    // brings back the original made-up data.
    signOut: async () => { window.location.reload(); },
    signInWithOtp: async () => ({ error: null }),
    verifyOtp: async () => ({ error: null }),
  },
};
