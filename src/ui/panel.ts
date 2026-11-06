/** Tiny DOM helpers for the control panel (accessible: every control has a label; sections are <details>). */
export function section(root: HTMLElement, title: string, open = true): HTMLElement {
  const d = document.createElement("details"); d.open = open;
  const s = document.createElement("summary"); s.textContent = title; d.appendChild(s); root.appendChild(d); return d;
}
export function slider(parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, on: (v: number) => void, fmt = (v: number) => v.toFixed(2)): HTMLInputElement {
  const row = document.createElement("div"); row.className = "row";
  const id = "c" + Math.random().toString(36).slice(2, 8);
  const l = document.createElement("label"); l.htmlFor = id; l.textContent = label;
  const i = document.createElement("input"); i.type = "range"; i.id = id; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
  const o = document.createElement("output"); o.htmlFor = id; o.textContent = fmt(value);
  i.addEventListener("input", () => { const v = Number(i.value); o.textContent = fmt(v); on(v); });
  row.append(l, i, o); parent.appendChild(row); return i;
}
export function button(parent: HTMLElement, label: string, on: () => void, pressed?: boolean): HTMLButtonElement {
  const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", on);
  if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
  parent.appendChild(b); return b;
}
export function buttonRow(parent: HTMLElement): HTMLElement { const r = document.createElement("div"); r.className = "row"; r.style.flexWrap = "wrap"; parent.appendChild(r); return r; }
export function fileInput(parent: HTMLElement, accept: string, label: string, on: (f: File) => void): void {
  const row = document.createElement("div"); row.className = "row";
  const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.setAttribute("aria-label", label);
  i.addEventListener("change", () => { const f = i.files?.[0]; if (f) on(f); i.value = ""; });
  row.appendChild(i); parent.appendChild(row);
}
export function hint(parent: HTMLElement, text: string): void { const p = document.createElement("div"); p.className = "hint"; p.textContent = text; parent.appendChild(p); }
export function select(parent: HTMLElement, label: string, options: [string, string][], value: string, on: (v: string) => void): void {
  const row = document.createElement("div"); row.className = "row";
  const id = "s" + Math.random().toString(36).slice(2, 8);
  const l = document.createElement("label"); l.htmlFor = id; l.textContent = label;
  const s = document.createElement("select"); s.id = id;
  for (const [v, t] of options) { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); }
  s.value = value; s.addEventListener("change", () => on(s.value)); row.append(l, s); parent.appendChild(row);
}
