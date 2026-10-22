import { useState } from 'react';
import AuthTabs from '../components/auth/AuthTabs';
import AuthBrand from '../components/auth/AuthBrand';
import LoginForm from '../components/auth/LoginForm';
import RegisterForm from '../components/auth/RegisterForm';
import Icon from '../components/ui/Icon';
import type { Mode } from '../types/types';
import { WRAPPER, CARD, BACK, SUCCESS, ERROR } from '../components/auth/authClasses';

type AuthPageProps = {
  onLoginSuccess: (accessToken: string) => void;
  initialMode?: Mode;
  onBack?: () => void;
  // Banner passed down by the router (e.g. returning from email verification).
  notice?: { type: 'success' | 'error'; text: string };
};

export default function AuthPage({ onLoginSuccess, initialMode = 'login', onBack, notice }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [successMessage, setSuccessMessage] = useState('');

  // Registration does not auto-login: confirm, then switch back to the login tab.
  const handleRegisterSuccess = () => {
    setSuccessMessage('Compte créé. Vérifie ton email pour activer ton compte.');
    setMode('login');
  };

  return (
    <main className={WRAPPER}>
      <h1 className="sr-only">Connexion à Prim'O</h1>
      <div className={CARD}>
        {onBack && (
          <button type="button" className={BACK} onClick={onBack}>
            <Icon name="arrow-left" size={18} /> Retour
          </button>
        )}
        <AuthBrand subtitle={mode === 'login' ? 'Connecte-toi pour retrouver tes tokens.' : 'Crée ton compte en moins d’une minute.'} />

        <AuthTabs mode={mode} onChange={setMode} />

        {notice && (
          <p className={notice.type === 'success' ? SUCCESS : ERROR}>{notice.text}</p>
        )}
        {successMessage && <p className={SUCCESS}>{successMessage}</p>}

        {mode === 'login'
          ? <LoginForm onLoginSuccess={onLoginSuccess} />
          : <RegisterForm onSuccess={handleRegisterSuccess} />}
      </div>
    </main>
  );
}
