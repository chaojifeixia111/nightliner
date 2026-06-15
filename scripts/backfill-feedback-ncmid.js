// scripts/backfill-feedback-ncmid.js
// One-shot: resolve ncm_id for pre-existing love feedback that predates the ncm_id column.
// Best-effort — unresolved rows stay null (still count for artist affinity).
import db from '../server/state-db.js';
import { cloudsearch } from '../server/ncm-client.js';

const rows = db.prepare("SELECT id, song_title, song_artist FROM feedback WHERE signal='love' AND ncm_id IS NULL").all();
console.log(`backfilling ${rows.length} loves...`);
let ok = 0;
for (const r of rows) {
  try {
    const res = await cloudsearch(`${r.song_title} ${(r.song_artist || '').split('/')[0]}`);
    const hit = res?.result?.songs?.[0];
    if (hit?.id) { db.prepare("UPDATE feedback SET ncm_id=? WHERE id=?").run(hit.id, r.id); ok++; }
  } catch (e) { console.warn('skip', r.song_title, e.message); }
}
console.log(`resolved ${ok}/${rows.length}`);
process.exit(0);
