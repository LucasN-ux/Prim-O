import Coin from '@/components/ui/Coin';
import logo4 from '@/assets/logos/logo_4.png';

// Mobile entry screen (logged-out visitors). Full screen, outside Layout: teal hero, floating
// gold coin (signature element), two entry paths. Desktop visitors go straight to the
// LandingPage instead (no splash).
type Props = {
  onLogin: () => void;
  onRegister: () => void;
};

export default function Splash({ onLogin, onRegister }: Props) {
  return (
    <main
      className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-primo-hero-from via-primo-ink-900 to-primo-ink-950 px-7 pb-12 pt-12 text-white"
      style={{ paddingBottom: 'max(3rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Coin size={135} float />
        <h1 className="mt-2 text-[54px] font-extrabold leading-none tracking-[-0.04em]">
            <img src={logo4} alt="Logo" className="w-64 h-auto"/></h1>
        <p className="mt-4 max-w-[280px] text-[18px] font-medium leading-relaxed text-white/70">
          Tes efforts récompensés{' '}
          <span className="font-bold text-primo-gold-bright">instantanément</span>.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onRegister}
          className="rounded-2xl bg-primo-teal py-[17px] text-base font-bold text-white shadow-[0_12px_26px_-8px_rgba(0,161,154,0.7)] transition active:scale-[0.99]"
        >
          Créer mon compte
        </button>
        <button
          type="button"
          onClick={onLogin}
          className="rounded-2xl border border-white/25 bg-white/[0.06] py-4 text-base font-bold text-white transition active:scale-[0.99]"
        >
          J'ai déjà un compte
        </button>
      </div>
    </main>
  );
}
