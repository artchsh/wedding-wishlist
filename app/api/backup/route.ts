import { normalizeWishlist } from "@/app/wishlist-data";
import { readWishlistRaw } from "@/app/api/wishlist/store";
import { sendDiscordBackup } from "./discord";

export async function POST() {
  const raw = await readWishlistRaw();

  if (raw === null) {
    return Response.json(
      { ok: false, error: "Список подарков ещё не создан." },
      { status: 404 }
    );
  }

  const document = normalizeWishlist(JSON.parse(raw));
  const timestamp = new Date().toISOString();

  return sendDiscordBackup({
    content: `Бэкап вишлиста — ${timestamp} (${document.items.length} подарков)`,
    filename: `wishlist-backup-${Date.now()}.json`,
    json: JSON.stringify(document, null, 2),
  });
}
