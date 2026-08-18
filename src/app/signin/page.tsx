'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { signIn } from '../../api/auth';
import { ErrorBanner, type Refusal } from '../../components/ErrorBanner';
import { Field } from '../../components/Field';
import { MeridianLogo } from '../../components/MeridianLogo';

/**
 * Outside the shell, because there is nobody signed in to put in the header.
 *
 * The refusal is shown exactly as the API worded it. C.0's sign-in gives one message for a
 * wrong password and for an address that does not exist, so nothing here may say which it
 * was, and nothing here decides that: the message is the server's.
 */
function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionEnded = params.get('reason') === 'session-ended';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setRefusal(null);

    const result = await signIn(email, password);
    if (result.ok) {
      router.replace('/products');
      return;
    }

    setRefusal(result);
    setBusy(false);
  }

  return (
    <main className="signin">
      <div className="signin-brand">
        <MeridianLogo size={44} wordmark={false} draw />
      </div>
      <h1>Meridian</h1>
      <p className="note">Sign in to continue.</p>

      {/*
        A 401 sent the browser here. The server cannot tell "never signed in" from "the
        session expired", and neither can this screen, so the wording covers both rather
        than asserting something it does not know.
      */}
      {sessionEnded ? (
        <p className="note">You are not signed in, or your session ended. Sign in again.</p>
      ) : null}
      <ErrorBanner refusal={refusal} />

      <form onSubmit={submit}>
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <button type="submit" className="primary" disabled={busy}>
          Sign in
        </button>
      </form>

      <p className="signin-disclaimer">
        Meridian is a fictional application used for QA training. Its data and defects are
        intentional training material, not a real product or system.
      </p>
    </main>
  );
}

export default function SignInPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
