/**
 * Posts a JSON snapshot to the Discord webhook as a file attachment.
 * Shared by the wishlist backup (`/api/backup`) and the RSVP backup
 * (`/api/backup/rsvp`) so both keep the same headers and failure handling.
 */
export async function sendDiscordBackup({
  content,
  filename,
  json,
}: {
  content: string;
  filename: string;
  json: string;
}): Promise<Response> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    return Response.json(
      { ok: false, error: "DISCORD_WEBHOOK_URL не настроен." },
      { status: 500 }
    );
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  form.append(
    "files[0]",
    new Blob([json], { type: "application/json" }),
    filename
  );

  const discordResponse = await fetch(webhookUrl, {
    method: "POST",
    body: form,
    headers: {
      // Discord's edge blocks requests with no/generic User-Agent (Cloudflare error 1010).
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  if (!discordResponse.ok) {
    const body = await discordResponse.text();
    return Response.json(
      { ok: false, error: `Discord ответил ${discordResponse.status}: ${body}` },
      { status: 502 }
    );
  }

  return Response.json({ ok: true });
}
