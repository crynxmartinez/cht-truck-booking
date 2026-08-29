'use client';

import { useActionState } from 'react';
import { login, type ActionResult } from '@/app/app/actions';
import '@/app/app/crm.css';

export default function LoginPage() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, fd) => login(prev, fd),
    null,
  );

  return (
    <div className="shell" style={{ maxWidth: 400, paddingTop: 72 }}>
      <div className="card">
        <div className="card-hd">
          <div className="logo">
            C<em>&#8962;</em>RY HOME TEAM
          </div>
          <div className="card-sub">Truck Operations</div>
        </div>
        <form action={action}>
          <div className="card-bd">
            {state && !state.ok ? <div className="note alert">{state.error}</div> : null}
            <div className="row">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
            </div>
            <div className="row" style={{ marginBottom: 0 }}>
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
          </div>
          <div className="card-ft">
            <div className="spacer" />
            <button className="btn primary" type="submit" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
