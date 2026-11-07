// A pretend Supabase for testing the sign-in pages without internet. Mirrors the parts of supabase-js the app uses.
// Test controls: window.__mock = { users: { email: { password, profile, factor } } }, window.__calls, window.__fire(event).
(function () {
  const M = () => window.__mock;
  const calls = (window.__calls = []);
  let cb = null, current = null, aal = 'aal1', unverified = null, nextId = 1;
  const rec = (n, a) => calls.push([n, a]);
  const userRow = () => (current ? M().users[current] : null);
  const verifiedFactors = () => (userRow() && userRow().factor ? [{ id: 'f-' + current, factor_type: 'totp', status: 'verified' }] : []);

  window.__fire = (event, email) => { if (email) current = email; if (cb) cb(event, current ? { user: { email: current } } : null); };

  window.supabase = { createClient() { return {
    auth: {
      async getSession() { return { data: { session: current ? { user: { email: current } } : null } }; },
      async signInWithPassword({ email, password }) {
        rec('signIn', email);
        const u = M().users[email];
        if (!u || u.password !== password) return { error: { status: 400, message: 'Invalid login credentials' } };
        current = email; aal = 'aal1'; return { data: {} };
      },
      async signOut() { current = null; aal = 'aal1'; if (cb) cb('SIGNED_OUT'); return {}; },
      async resetPasswordForEmail(email) { rec('reset', email); return { data: {} }; },
      async updateUser({ password }) { rec('updateUser', password); if (M().updateError) return { error: { message: M().updateError } }; userRow().password = password; return { data: {} }; },
      onAuthStateChange(fn) { cb = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      mfa: {
        async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: aal, nextLevel: verifiedFactors().length ? 'aal2' : 'aal1' } }; },
        async listFactors() { const v = verifiedFactors(); return { data: { totp: v, all: v.concat(unverified ? [unverified] : []) } }; },
        async unenroll({ factorId }) { rec('unenroll', factorId); unverified = null; return { data: {} }; },
        async enroll() {
          if (M().enrollError) return { error: { message: M().enrollError } };
          const id = 'new-' + nextId++; unverified = { id, factor_type: 'totp', status: 'unverified' };
          return { data: { id, totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', secret: 'ABCDEFGHJKLMNPQR' } } };
        },
        async challengeAndVerify({ factorId, code }) {
          rec('verify', factorId + ':' + code);
          if (code !== '123456') return { error: { message: 'Invalid TOTP code entered' } };
          aal = 'aal2';
          if (unverified && unverified.id === factorId) { userRow().factor = true; unverified = null; }
          return { data: {} };
        }
      }
    },
    async rpc(name) {
      if (name !== 'auth_requirements' || !userRow() || !userRow().profile) return { data: [] };
      return { data: [userRow().profile] };
    }
  }; } };
})();
