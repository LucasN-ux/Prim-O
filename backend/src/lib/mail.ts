import { config } from '../config';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

// Send a transactional email via Brevo. Dev mode: without BREVO_API_KEY the email is logged
// instead of sent, so the whole flow is testable without a Brevo account.
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  if (!config.BREVO_API_KEY) {
    console.log(`[mail:dev] BREVO_API_KEY absente → email NON envoyé à ${to}`);
    console.log(`[mail:dev] sujet : ${subject}`);
    console.log(`[mail:dev] contenu :\n${html}`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': config.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: config.BREVO_SENDER_EMAIL, name: config.BREVO_SENDER_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`BREVO_SEND_FAILED: ${res.status} ${body}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Build and send the verification email. The link targets the BACKEND (the token is consumed
// one-time server-side), which then redirects to the frontend.
export async function sendVerificationEmail(to: string, rawToken: string): Promise<void> {
  const link = `${config.API_URL}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  const html = `
    <p>Bienvenue sur Prim'O !</p>
    <p>Confirme ton adresse email en cliquant sur ce lien :</p>
    <p><a href="${link}">Vérifier mon adresse email</a></p>
    <p>Ce lien expire dans 24 heures.</p>
  `;
  await sendEmail({ to, subject: "Vérifie ton adresse email - Prim'O", html });
}

// Build and send the password-reset email. The link targets the FRONTEND (the user must type
// a new password there), not the backend.
export async function sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
  const link = `${config.CLIENT_URL}/?reset-token=${encodeURIComponent(rawToken)}`;
  const html = `
    <p>Tu as demandé à réinitialiser ton mot de passe Prim'O.</p>
    <p>Clique sur ce lien pour en choisir un nouveau :</p>
    <p><a href="${link}">Réinitialiser mon mot de passe</a></p>
    <p>Ce lien expire dans 1 heure. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
  `;
  await sendEmail({ to, subject: "Réinitialise ton mot de passe - Prim'O", html });
}
