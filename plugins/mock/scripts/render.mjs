#!/usr/bin/env node
/**
 * render.mjs — the JSON drawn as a page you can open. Nothing reads the HTML back: it is written
 * from the record and thrown away on the next run, which is why the record is the only thing gates
 * and the baseline hash ever look at.
 *
 * L1 means structure, not looks: real zones, real controls, real testids, the theme's tokens as CSS
 * variables so the client sees the colours they chose — and no picture of anything the design did
 * not declare.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const label = (c) => esc(String(c.from).split(":")[1] ?? c.testid);

function control(c) {
  const t = `data-testid="${esc(c.testid)}"`;
  if (c.kind === "button") return `<button type="button" class="btn btn-primary" ${t}>${label(c)}</button>`;
  if (c.kind === "column") return `<th scope="col" ${t}>${label(c)}</th>`;
  return `<div class="mb-3"><label class="form-label" for="${esc(c.testid)}">${label(c)}</label><input class="form-control" id="${esc(c.testid)}" ${t}></div>`;
}

function zone(z) {
  const controls = z.controls ?? [];
  const columns = controls.filter((c) => c.kind === "column");
  const rest = controls.filter((c) => c.kind !== "column");
  const table = columns.length
    ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr>${columns.map(control).join("")}</tr></thead><tbody><tr>${columns.map(() => `<td class="text-body-secondary">…</td>`).join("")}</tr></tbody></table></div>`
    : "";
  const body = controls.length === 0 ? `<p class="text-body-secondary fst-italic mb-0">ไม่มี control — หน้าจอนี้ไม่ได้ประกาศ field หรือ action ในโซนนี้</p>` : `${table}<div class="d-flex flex-wrap gap-2">${rest.map(control).join("")}</div>`;
  return `<section class="mck-zone card mb-3"><div class="card-header py-1 small text-uppercase text-body-secondary">${esc(z.name)}</div><div class="card-body">${body}</div></section>`;
}

export function renderMck(mck, theme, { renderedAt = new Date().toISOString() } = {}) {
  const t = theme?.tokens ?? {};
  const badges = (items, cls) => items.map((i) => `<span class="badge ${cls} me-1">${esc(i)}</span>`).join("");
  return `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(mck.id)} · ${esc(mck.title)}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<style>
  :root {
    --mck-primary: ${esc(t["color.primary"] ?? "#0d6efd")};
    --mck-surface: ${esc(t["color.surface"] ?? "#ffffff")};
    --mck-text: ${esc(t["color.text"] ?? "#212529")};
    --mck-unit: ${esc(t["spacing.unit"] ?? "8")}px;
    --mck-radius: ${esc(t["radius"] ?? "6")}px;
    --bs-body-font-family: ${esc(t["font.family"] ?? "system-ui, sans-serif")};
    --bs-body-font-size: ${esc(t["font.scale"] ?? "16")}px;
    --bs-primary: var(--mck-primary);
  }
  body { background: #f6f7f9; color: var(--mck-text); font-family: var(--bs-body-font-family); font-size: var(--bs-body-font-size); }
  .btn-primary { --bs-btn-bg: var(--mck-primary); --bs-btn-border-color: var(--mck-primary); --bs-btn-hover-bg: var(--mck-primary); --bs-btn-hover-border-color: var(--mck-primary); }
  .card { background: var(--mck-surface); border-radius: var(--mck-radius); }
  .mck-zone .card-body { padding: calc(var(--mck-unit) * 2); }
  main { max-width: 900px; margin: calc(var(--mck-unit) * 3) auto; padding: 0 var(--mck-unit); }
</style>
</head><body>
<main>
  <header class="mb-3">
    <div class="small text-body-secondary">${esc(mck.app)} · L1 wireframe · โครงสร้างผูกกับ ${esc(mck.ui)} · หน้าตาอ้าง ${esc(mck.theme)}</div>
    <h1 class="h4 mb-2">${esc(mck.title)}</h1>
    <div>${badges([mck.id, mck.ui, mck.kind], "text-bg-secondary")}${badges(mck.roles ?? [], "text-bg-info")}</div>
  </header>
  ${(mck.zones ?? []).map(zone).join("\n  ")}
  <footer class="small text-body-secondary mt-4">
    states: ${badges(mck.states ?? [], "text-bg-light border")}
    <div class="mt-2">hash ${esc(mck.hash)}${mck.signed ? ` · เซ็นโดย ${esc(mck.signed.by)} เมื่อ ${esc(mck.signed.at)}` : " · ยังไม่เซ็น"}${mck.cr ? ` · แก้ภายใต้ ${esc(mck.cr)}` : ""}</div>
  </footer>
</main>
<!-- rendered ${esc(renderedAt)} from ${esc(mck.id)}.json — generated file, edits are lost on the next run; the JSON is the record -->
</body></html>
`;
}
