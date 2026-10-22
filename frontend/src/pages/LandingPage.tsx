import { useEffect, useState } from 'react';
import type { Offer } from '../types/types';
import { listOffers, assetUrl } from '../services/api';
import OfferCatalog from '../components/offers/OfferCatalog';
import Icon from '../components/ui/Icon';
import logo2 from '../assets/logos/logo_2.png';
import logo4 from '../assets/logos/logo_4.png';
import coin from '../assets/primotoken/primo-tkn1.png';
import screenEmployee from '../assets/landing/screen-employee.png';
import screenOffers from '../assets/landing/screen-offers.png';
import screenOwner from '../assets/landing/screen-owner.png';
import screenStats from '../assets/landing/screen-stats.png';

type LandingPageProps = {
  isLoggedIn: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onDashboard: () => void;
};

// Shared phone frame for the mockups (real mobile screenshots of the app).
function PhoneFrame({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div
      className={`w-[270px] shrink-0 rounded-[40px] bg-primo-ink-950 p-2.5 shadow-[0_40px_80px_-30px_rgba(6,48,45,0.45)] ${className}`}
    >
      <div className="overflow-hidden rounded-[32px] bg-primo-surface">
        <img src={src} alt={alt} className="block w-full" />
      </div>
    </div>
  );
}

// Check bullet + title + description (used by the salarié / entreprise / stats sections).
function CheckItem({ title, text, dark = false }: { title: string; text: string; dark?: boolean }) {
  return (
    <li className="flex items-start gap-3.5">
      <span
        className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] ${
          dark ? 'bg-white/10 text-primo-gold-bright' : 'bg-primo-mint text-primo-teal-strong'
        }`}
      >
        <Icon name="check" size={13} strokeWidth={3} />
      </span>
      <span>
        <b className={`block text-[15px] ${dark ? 'text-white' : 'text-primo-ink'}`}>{title}</b>
        <span className={`text-sm ${dark ? 'text-white/55' : 'text-primo-slate-soft'}`}>{text}</span>
      </span>
    </li>
  );
}

// Section heading: uppercase kicker + large title.
function SectionHead({ kicker, title, dark = false }: { kicker: string; title: string; dark?: boolean }) {
  return (
    <div>
      <div className={`text-[13px] font-bold uppercase tracking-[0.08em] ${dark ? 'text-primo-gold-bright' : 'text-primo-teal-strong'}`}>
        {kicker}
      </div>
      <h2 className={`mt-3 text-3xl font-extrabold leading-[1.12] tracking-tight sm:text-[38px] ${dark ? 'text-white' : 'text-primo-ink'}`}>
        {title}
      </h2>
    </div>
  );
}

// Desktop landing page (visitors): marketing page - app pitch, features per audience
// (employee / company / owner stats) with real mobile screenshots, and an API-fed teaser of
// the offer catalog. "Offres" swaps in the full catalog WITHIN the page (same URL, same nav).
// Mobile visitors see the Splash screen instead (see router).
export default function LandingPage({
  isLoggedIn,
  onLogin,
  onRegister,
  onDashboard,
}: LandingPageProps) {
  const [view, setView] = useState<'home' | 'offers'>('home');
  const [offers, setOffers] = useState<Offer[]>([]);

  useEffect(() => {
    let alive = true;
    listOffers()
      .then((res) => { if (alive && res.ok && res.data) setOffers(res.data.offers.slice(0, 4)); })
      .catch(() => {}); // Best-effort teaser: the landing works without it.
    return () => { alive = false; };
  }, []);

  // Home ↔ catalog toggle (same route, scrolls back to the top).
  const goHome = () => { setView('home'); window.scrollTo({ top: 0 }); };
  const goOffers = () => { setView('offers'); window.scrollTo({ top: 0 }); };

  const ctas = (
    <button
      type="button"
      onClick={onRegister}
      className="rounded-full bg-primo-teal px-6 py-3 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(0,161,154,0.55)] transition hover:-translate-y-px hover:bg-primo-teal-strong"
    >
      Créer mon compte
    </button>
  );

  return (
    <main className="min-h-screen bg-white text-primo-ink">
      <nav className="sticky top-0 z-50 border-b border-primo-line bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1140px] items-center justify-between px-5 sm:px-10">
          <button type="button" onClick={goHome} aria-label="Accueil">
            <img src={logo2} alt="Prim'O" className="h-9 w-auto" />
          </button>
          <div className="hidden items-center gap-8 text-sm font-medium text-primo-slate-soft sm:flex">
            <button type="button" onClick={goHome} className={`transition hover:text-primo-ink ${view === 'home' ? 'font-bold text-primo-ink' : ''}`}>Accueil</button>
            <button type="button" onClick={goOffers} className={`transition hover:text-primo-ink ${view === 'offers' ? 'font-bold text-primo-ink' : ''}`}>Offres</button>
          </div>
          <button
            type="button"
            onClick={isLoggedIn ? onDashboard : onLogin}
            className="flex items-center gap-2 rounded-full bg-primo-ink px-5 py-2.5 text-sm font-bold text-white transition hover:-translate-y-px"
          >
            <Icon name="user" size={15} />
            {isLoggedIn ? 'Mon espace' : "S'identifier"}
          </button>
        </div>
      </nav>

      {view === 'offers' ? (
        /* Catalog view: the full offer catalog, swapped in on the same page. */
        <div className="min-h-screen bg-primo-surface">
          <OfferCatalog
            isLoggedIn={isLoggedIn}
            canRedeem={false}
            onSeeSpending={isLoggedIn ? onDashboard : undefined}
            largeDesktopCards
            className="mx-auto max-w-[1100px] px-5 pb-24 pt-8 lg:pb-16"
          />
        </div>
      ) : (<>

      {/* Hero. */}
      <header className="relative overflow-hidden bg-gradient-to-b from-primo-mint via-[#f7fbfa] to-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-44 -top-32 h-[720px] w-[720px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(0,161,154,0.10), transparent 65%)' }}
        />
        <div className="relative mx-auto grid max-w-[1140px] items-center gap-14 px-5 py-16 sm:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
          <div>
            <div className="mb-5 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-primo-teal-strong">
              <span aria-hidden className="h-0.5 w-6 rounded bg-primo-teal" />
              LA PRIME NOUVELLE GÉNÉRATION
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-[62px]">
              Tes efforts,
              <br />
              récompensés{' '}
              <span className="relative whitespace-nowrap text-primo-teal">
                <span aria-hidden className="absolute inset-x-0 bottom-1 -z-10 h-2.5 rounded bg-primo-gold-soft" />
                instantanément
              </span>
              .
            </h1>
            <p className="mt-6 max-w-[460px] text-lg leading-relaxed text-primo-slate-soft">
              Ton employeur t'attribue des tokens, tu les échanges immédiatement contre de vraies
              offres : restaurants, sport, culture, bien-être.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3.5">{ctas}</div>
            <p className="mt-5 text-[13px] text-primo-slate-soft">
              Sans engagement · <b className="text-primo-ink">Gratuit pour les salariés</b>
            </p>
          </div>

          <div className="relative hidden justify-center lg:flex">
            {/* Decorative floating «tokens reçus» toast mockup. */}
            <div className="absolute -left-9 top-12 z-10 flex items-center gap-2.5 rounded-2xl border border-primo-line bg-white px-4 py-3 shadow-[0_20px_40px_-18px_rgba(6,48,45,0.30)]">
              <img src={coin} alt="" className="h-[34px] w-[34px]" />
              <span>
                <b className="block text-[12.5px] font-bold">+ 50 tokens reçus</b>
                <span className="text-[11px] text-primo-slate-soft">De la part de ton manager 🎉</span>
              </span>
            </div>
            <PhoneFrame src={screenEmployee} alt="Dashboard employé Prim'O" className="z-[2]" />
            {/* Decorative floating «code promo» card mockup. */}
            <div className="absolute -right-5 bottom-16 z-10 rounded-2xl border border-primo-line bg-white px-4 py-3 text-center shadow-[0_20px_40px_-18px_rgba(6,48,45,0.30)]">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-primo-slate-soft">Ton code promo</div>
              <div className="mt-0.5 text-base font-extrabold tracking-[0.06em] text-primo-teal-strong">PRIMO-7F2K</div>
            </div>
          </div>
        </div>
      </header>

      {/* Category strip. */}
      <div className="overflow-hidden border-y border-primo-line bg-white py-4">
        <div className="flex items-center justify-center gap-6 whitespace-nowrap text-sm font-semibold text-primo-muted sm:gap-11">
          {['Restaurants', 'Sport', 'Culture', 'Bien-être', 'Shopping', 'Voyage'].map((cat, i) => (
            <span key={cat} className="flex items-center gap-6 sm:gap-11">
              {i > 0 && <span aria-hidden className="text-primo-gold">✦</span>}
              {cat}
            </span>
          ))}
        </div>
      </div>

      {/* «Comment ça marche» section. */}
      <section className="mx-auto max-w-[1140px] px-5 py-16 sm:px-10 lg:py-24">
        <div className="max-w-[560px]">
          <SectionHead kicker="Comment ça marche" title="De l'effort à la récompense, en trois gestes." />
        </div>
        <div className="mt-14 grid gap-10 border-t border-primo-line sm:grid-cols-3 sm:gap-0">
          {[
            {
              num: '01',
              title: 'Ton entreprise te récompense',
              text: "Ton manager t'attribue des tokens en un clic - au moment où tu le mérites, pas six mois plus tard.",
            },
            {
              num: '02',
              title: 'Tu choisis ton offre',
              text: 'Parcours le catalogue partenaires et repère ce qui te fait vraiment plaisir, près de chez toi ou en ligne.',
            },
            {
              num: '03',
              title: 'Tu en profites tout de suite',
              text: 'Échange tes tokens contre un code promo, généré instantanément. Zéro paperasse, zéro délai.',
            },
          ].map((step, i) => (
            <div key={step.num} className={`pt-9 sm:px-8 ${i === 0 ? 'sm:pl-0' : ''} ${i === 2 ? 'sm:pr-0' : 'sm:border-r sm:border-primo-line'}`}>
              <div className="text-5xl font-extrabold leading-none text-primo-mint [-webkit-text-stroke:1.5px_#00a19a]">
                {step.num}
              </div>
              <h3 className="mb-2.5 mt-4 text-lg font-bold">{step.title}</h3>
              <p className="text-[14.5px] leading-relaxed text-primo-slate-soft">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* «Côté salarié» section. */}
      <section className="mx-auto grid max-w-[1140px] items-center gap-14 px-5 pb-16 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:pb-24">
        <div className="flex justify-center">
          <PhoneFrame src={screenOffers} alt="Catalogue d'offres Prim'O" className="w-[260px]" />
        </div>
        <div>
          <SectionHead kicker="Côté salarié" title="Ta prime, ton choix." />
          <ul className="mt-7 flex flex-col gap-4">
            <CheckItem title="Ton solde toujours en poche" text="Tes tokens te suivent, visibles en un coup d'œil." />
            <CheckItem title="Des offres qui donnent envie" text="Locales et nationales : restos, sport, culture, shopping…" />
            <CheckItem title="Code promo instantané" text="Tu échanges, tu reçois ton code, tu en profites. C'est tout." />
          </ul>
        </div>
      </section>

      {/* «Côté entreprise» section (full-width dark band). */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primo-ink-900 to-primo-ink-950">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-28 h-[480px] w-[480px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(0,161,154,0.22), transparent 65%)' }}
        />
        <div className="relative mx-auto grid max-w-[1140px] items-center gap-14 px-5 py-16 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:py-24">
          <div>
            <SectionHead dark kicker="Côté entreprise" title="Motivez vos équipes, sans friction." />
            <ul className="mt-7 flex flex-col gap-4">
              <CheckItem dark title="Des packs de tokens en ligne" text="Paiement sécurisé, rechargez quand vous voulez." />
              <CheckItem dark title="La prime au bon moment" text="Distribuez en un clic, à la personne, à l'équipe." />
              <CheckItem dark title="Un impact mesurable" text="Suivez la distribution et l'engagement avec des stats claires." />
            </ul>
          </div>
          <div className="flex justify-center">
            <PhoneFrame src={screenOwner} alt="Dashboard employeur Prim'O" className="w-[260px] !bg-[#04211f] !shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]" />
          </div>
        </div>
      </section>

      {/* «Pilotage» (stats) section. */}
      <section className="mx-auto grid max-w-[1140px] items-center gap-14 px-5 py-16 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div className="flex justify-center">
          <PhoneFrame src={screenStats} alt="Statistiques employeur Prim'O" className="w-[260px]" />
        </div>
        <div>
          <SectionHead kicker="Pilotage" title="Suivez ce qui motive vraiment." />
          <ul className="mt-7 flex flex-col gap-4">
            <CheckItem title="Top par motif" text="Voyez quels comportements sont les plus reconnus : qualité d'exécution, relation client, esprit collectif…" />
            <CheckItem title="Filtres par période" text="30 derniers jours par défaut, ou la plage de dates de votre choix." />
            <CheckItem title="Repérez vos talents" text="Qui reçoit le plus de reconnaissance, motif par motif, équipe par équipe." />
          </ul>
        </div>
      </section>

      {/* Partner offers teaser (fed by the API). */}
      <section className="bg-gradient-to-b from-white to-primo-mint/60">
        <div className="mx-auto max-w-[1140px] px-5 py-16 sm:px-10 lg:py-24">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <SectionHead kicker="Le catalogue" title="Des offres qui font envie." />
            <button
              type="button"
              onClick={goOffers}
              className="rounded-full border-[1.5px] border-primo-line bg-white px-6 py-3 text-sm font-bold text-primo-ink transition hover:-translate-y-px hover:bg-primo-surface"
            >
              Voir toutes les offres →
            </button>
          </div>
          {offers.length > 0 && (
            <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
              {offers.map((offer) => (
                <button
                  key={offer.id}
                  type="button"
                  onClick={goOffers}
                  className="overflow-hidden rounded-[18px] border border-primo-line bg-white text-left transition hover:-translate-y-1 hover:shadow-[0_24px_44px_-24px_rgba(6,48,45,0.25)]"
                >
                  <div
                    className="flex h-28 items-start justify-between gap-2 bg-primo-mint bg-cover bg-center p-3"
                    style={offer.imageUrl ? { backgroundImage: `url(${assetUrl(offer.imageUrl)})` } : { backgroundColor: offer.category.color }}
                  >
                    <span className="rounded-full bg-white/90 px-2.5 py-1 text-[10.5px] font-bold">{offer.category.label}</span>
                    <span className="rounded-full bg-primo-gold px-2.5 py-1 text-[10.5px] font-bold text-[#5c3a00]">
                      −{offer.discountPercent}%
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="text-[14.5px] font-bold">{offer.partnerName}</div>
                    <div className="mt-0.5 text-xs text-primo-slate-soft">{offer.category.label}</div>
                    <div className="mt-3 flex items-center gap-1.5 text-[13px] font-extrabold">
                      <img src={coin} alt="" className="h-4 w-4" />
                      {offer.cost} tokens
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Final CTA. */}
      <section className="relative overflow-hidden bg-white text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-10 h-[500px] w-[900px] -translate-x-1/2"
          style={{ background: 'radial-gradient(ellipse, rgba(0,161,154,0.09), transparent 65%)' }}
        />
        <div className="relative mx-auto max-w-[1140px] px-5 py-24 sm:px-10 lg:py-28">
          <img src={coin} alt="" className="mx-auto mb-6 h-[58px] w-[58px] animate-primo-float" />
          <h2 className="text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-[44px]">
            Prêt à récompenser
            <br />
            ceux qui le méritent ?
          </h2>
          <p className="mt-4 text-[17px] text-primo-slate-soft">
            Salarié ou employeur, il y a une place pour vous sur Prim'O.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">{ctas}</div>
        </div>
      </section>

      </>)}

      <footer className="bg-primo-ink-950">
        <div className="mx-auto flex max-w-[1140px] flex-col items-center justify-between gap-5 px-5 py-9 sm:flex-row sm:px-10">
          <img src={logo4} alt="Prim'O" className="h-8 w-auto" />
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-white/55">
            <button type="button" onClick={goHome} className="transition hover:text-white">Accueil</button>
            <button type="button" onClick={goOffers} className="transition hover:text-white">Offres</button>
            <button type="button" onClick={isLoggedIn ? onDashboard : onLogin} className="transition hover:text-white">
              {isLoggedIn ? 'Mon espace' : 'Se connecter'}
            </button>
            <a href="#privacy" className="transition hover:text-white">Confidentialité</a>
            <a href="#mentions" className="transition hover:text-white">Mentions légales</a>
            <a href="#cgu" className="transition hover:text-white">CGU</a>
          </nav>
          <div className="text-[13px] text-white/55">© {new Date().getFullYear()} Prim'O</div>
        </div>
      </footer>
    </main>
  );
}
