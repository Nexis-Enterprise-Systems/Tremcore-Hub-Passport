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


  // ---- fake database tables (window.__mock.tables) for the management hub ----
  // The two traffic-light views are worked out here the same way the real database views do it, so the hub is tested end to end.
  // The real rule itself is proven in supabase/tests/01_permissions.sql.
  let idn = 1;
  const uuid = () => '00000000-0000-4000-8000-' + String(idn++).padStart(12, '0');
  const db = () => (M().tables = M().tables || {});
  const DEFAULTS = {
    companies: () => ({ level: 1, subscription: 'trial', monthly_value_pence: 0, require_mfa: false, billing_interval: 'monthly' }),
    compliance_items: () => ({ notes: '', grp: 'Other', basis: 'standard' }),
    properties: () => ({})
  };
  function statusRows() {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    return (db().compliance_items || []).map((i) => {
      let status = 'missing', days = null;
      if (i.due_date) {
        days = Math.round((new Date(i.due_date + 'T00:00:00Z').getTime() - today) / 86400000);
        status = days < 0 ? 'red' : days <= 30 ? 'amber' : 'green';
      }
      return Object.assign({}, i, { status, days_left: days });
    });
  }
  function viewRows(name) {
    if (name === 'compliance_status') return statusRows();
    if (name === 'property_summary') {
      const st = statusRows();
      return (db().properties || []).map((p) => {
        const mine = st.filter((x) => x.property_id === p.id), n = (k) => mine.filter((x) => x.status === k).length;
        const g = n('green'), a = n('amber');
        return { property_id: p.id, company_id: p.company_id, name: p.name, green: g, amber: a, red: n('red'), missing: n('missing'), total: mine.length,
          pct_in_date: mine.length ? Math.round(100 * (g + a) / mine.length) : null };
      });
    }
    return db()[name] || [];
  }
  function from(table) {
    const st = { op: 'select', filters: [], order: null, lim: null, payload: null, single: null, returning: false };
    const run = () => {
      calls.push(['db', { table, op: st.op, payload: st.payload, filters: st.filters.map((f) => f[1] + '=' + f[2]) }]);
      const errs = M().dbError || {};
      const err = errs[table + ':' + st.op] || errs[table];
      if (err) return { data: null, error: { message: err } };
      const match = (r) => st.filters.every(([k, col, v]) => (k === 'eq' ? r[col] === v : v.includes(r[col])));
      let out;
      if (st.op === 'insert') {
        const list = db()[table] = db()[table] || [];
        out = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => Object.assign({ id: uuid(), created_at: new Date().toISOString() }, (DEFAULTS[table] || (() => ({})))(), p));
        list.push(...out);
      } else if (st.op === 'update') {
        out = (db()[table] || []).filter(match); out.forEach((r) => Object.assign(r, st.payload));
      } else if (st.op === 'delete') {
        out = (db()[table] || []).filter(match); db()[table] = (db()[table] || []).filter((r) => !match(r));
      } else out = viewRows(table).filter(match).map((r) => Object.assign({}, r));
      if (st.order) out = out.slice().sort((a, b) => (a[st.order.col] > b[st.order.col] ? 1 : a[st.order.col] < b[st.order.col] ? -1 : 0) * (st.order.asc ? 1 : -1));
      if (st.lim != null) out = out.slice(0, st.lim);
      if (st.op !== 'select' && !st.returning) return { data: null, error: null };
      if (st.single === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'Expected one row' } };
      if (st.single === 'maybe') return { data: out[0] || null, error: null };
      return { data: out, error: null };
    };
    const qb = {
      select() { if (st.op !== 'select') st.returning = true; return qb; },
      insert(p) { st.op = 'insert'; st.payload = p; return qb; },
      update(p) { st.op = 'update'; st.payload = p; return qb; },
      delete() { st.op = 'delete'; return qb; },
      eq(col, v) { st.filters.push(['eq', col, v]); return qb; },
      in(col, v) { st.filters.push(['in', col, v]); return qb; },
      order(col, o) { st.order = { col, asc: !o || o.ascending !== false }; return qb; },
      limit(n) { st.lim = n; return qb; },
      single() { st.single = 'single'; return qb; },
      maybeSingle() { st.single = 'maybe'; return qb; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
    };
    return qb;
  }

  window.supabase = { createClient() { return {
    from,
    auth: {
      async getSession() { return { data: { session: current ? { user: { id: 'user-' + current, email: current, user_metadata: (userRow() && userRow().meta) || {} } } : null } }; },
      async signUp({ email, password, options }) {
        rec('signUp', { email, meta: options && options.data, redirect: options && options.emailRedirectTo });
        if (M().signupError) return { data: {}, error: Object.assign({ message: M().signupError.message }, M().signupError) };
        if (M().users[email]) return { data: {}, error: { status: 422, message: 'User already registered' } };
        M().users[email] = { password, factor: false, profile: null, confirmed: false, meta: options && options.data };
        return { data: { user: { email }, session: null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        rec('signIn', email);
        const u = M().users[email];
        if (!u || u.password !== password) return { error: { status: 400, message: 'Invalid login credentials' } };
        if (u.confirmed === false) return { error: { status: 400, code: 'email_not_confirmed', message: 'Email not confirmed' } };
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
    async rpc(name, args) {
      rec('rpc:' + name, args || null);
      if (name === 'signup_open') return { data: M().signupOpen === true };
      if (name === 'signup_company') {
        if (M().signupRpcError) return { data: null, error: { message: M().signupRpcError } };
        if (!userRow()) return { data: null, error: { message: 'not_signed_in' } };
        userRow().profile = { role_name: 'client_super', full_name: args.p_full_name, company_id: 'c-new', level: 1, mfa_required: true };
        return { data: 'c-new', error: null };
      }
      if (name !== 'auth_requirements' || !userRow() || !userRow().profile) return { data: [] };
      return { data: [userRow().profile] };
    }
  }; } };
})();
