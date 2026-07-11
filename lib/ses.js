import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
const ses = new SESClient({ region: process.env.AWS_REGION });

export async function sendMagicLink(email, link, tripName) {
  const subject = tripName ? `You're invited to "${tripName}" on Tripbook` : "Your Tripbook sign-in link";
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#14343b">tripbook</h2>
      ${tripName ? `<p>You've been invited to add photos and notes to <b>${tripName}</b>.</p>` : ""}
      <p><a href="${link}" style="display:inline-block;background:#14343b;color:#fff;
        padding:12px 20px;border-radius:8px;text-decoration:none">Sign in to Tripbook</a></p>
      <p style="color:#667">This link works once and expires in 15 minutes.</p>
    </div>`;
  await ses.send(new SendEmailCommand({
    Source: process.env.SES_FROM,
    Destination: { ToAddresses: [email] },
    Message: { Subject: { Data: subject }, Body: { Html: { Data: html } } }
  }));
}
