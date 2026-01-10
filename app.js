/* =========================
   Notebook v2 (Supabase + Anonymous Auth)
   Features: tags, pin, archive, color, theme, markdown preview, split view.
   ========================= */

const supabaseUrl = 'https://rrqribkbvqgxpkylhxyd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJycXJpYmtidnFneHBreWxoeHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MzA1MDgsImV4cCI6MjA4MDQwNjUwOH0.DllabvxJhRdJVWL91xKugKDMBnZr-jFLuqE7pZguq-g';

if (!window.supabase) throw new Error("Supabase SDK not loaded. Check index.html script order.");
const sb = window.supabase.createClient(supabaseUrl, supabaseKey);

const $ = (id) => document.getElementById(id);

// UI
const statusText = $("statusText");
const notesList = $("notesList");
const searchInput = $("searchInput");
const clearSearchBtn = $("clearSearchBtn");
const newNoteBtn = $("newNoteBtn");
const deleteBtn = $("deleteBtn");
const pinBtn = $("pinBtn");
const archiveBtn = $("archiveBtn");
const restoreBtn = $("restoreBtn");
const duplicateBtn = $("duplicateBtn");

const titleInput = $("titleInput");
const bodyInput = $("bodyInput");
const tagListEl = $("tagList");
const tagInput = $("tagInput");
const previewEl = $("preview");
const copyMdBtn = $("copyMdBtn");

const metaText = $("metaText");
const saveText = $("saveText");
const statsText = $("statsText");
const toastEl = $("toast");

const exportBtn = $("exportBtn");
const importInput = $("importInput");
const countText = $("countText");

const tabAll = $("tabAll");
const tabPinned = $("tabPinned");
const tabArchived = $("tabArchived");
const tagFilterRow = $("tagFilterRow");

const modeEditBtn = $("modeEditBtn");
const modeSplitBtn = $("modeSplitBtn");
const modePreviewBtn = $("modePreviewBtn");
const editorBody = $("editorBody");

const themeBtn = $("themeBtn");
const colorPalette = $("colorPalette");

// State
let sessionUserId = null;
let allNotes = [];
let activeId = null;
let saveTimer = null;
let previewTimer = null;
let lastSavedHash = "";

let listMode = "all"; // all | pinned | archived
let activeTagFilter = null;

const COLORS = ["slate","rose","amber","emerald","sky","violet"];

// ---------- helpers ----------
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

function setStatus(text) {
  statusText.textContent = text;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  } catch { return "—"; }
}

function computeHash(note) {
  return [
    note.title || "",
    note.content || "",
    String(!!note.pinned),
    String(!!note.archived),
    (note.color || "slate"),
    Array.isArray(note.tags) ? note.tags.slice().sort().join(",") : ""
  ].join("\u0000");
}

function setEditorEnabled(enabled) {
  titleInput.disabled = !enabled;
  bodyInput.disabled = !enabled;
  tagInput.disabled = !enabled;

  deleteBtn.disabled = !enabled;
  pinBtn.disabled = !enabled;
  archiveBtn.disabled = !enabled;
  restoreBtn.disabled = !enabled;
  duplicateBtn.disabled = !enabled;
  copyMdBtn.disabled = !enabled;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function notePreview(content) {
  const s = (content || "").replace(/\s+/g, " ").trim();
  return s.length ? s : "No content";
}

function uniqTagsFromNotes(notes) {
  const set = new Set();
  for (const n of notes) for (const t of (n.tags || [])) set.add(t);
  return [...set].sort((a,b)=>a.localeCompare(b));
}

// ---------- theme ----------
function getTheme() {
  return localStorage.getItem("nb_theme") || "dark";
}
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("nb_theme", theme);
  themeBtn.querySelector(".icon").textContent = theme === "dark" ? "🌙" : "☀️";
}

// ---------- view modes ----------
function setEditorMode(mode) {
  editorBody.setAttribute("data-mode", mode);
  for (const [btn, m] of [[modeEditBtn,"edit"],[modeSplitBtn,"split"],[modePreviewBtn,"preview"]]) {
    btn.classList.toggle("active", mode === m);
    btn.setAttribute("aria-selected", mode === m ? "true" : "false");
  }
  localStorage.setItem("nb_mode", mode);
}
function getEditorMode() {
  return localStorage.getItem("nb_mode") || "split";
}

// ---------- markdown preview ----------
function renderPreview() {
  const title = titleInput.value || "";
  const md = bodyInput.value || "";
  const header = title.trim() ? `# ${title}\n\n` : "";
  const raw = header + md;

  // marked + DOMPurify
  let html = "";
  try {
    html = window.marked.parse(raw, { breaks: true, gfm: true });
    html = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    html = `<pre>${escapeHtml(raw)}</pre>`;
  }
  previewEl.innerHTML = html;
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

function updateStats() {
  const text = (bodyInput.value || "").trim();
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const chars = (bodyInput.value || "").length;
  statsText.textContent = `${words} word${words===1?"":"s"} • ${chars} char${chars===1?"":"s"}`;
}

// ---------- Supabase ----------
async function ensureAnonymousSession() {
  setStatus("Connecting…");
  const { data: s1, error: e1 } = await sb.auth.getSession();
  if (e1) throw e1;

  if (s1?.session?.user?.id) {
    sessionUserId = s1.session.user.id;
    setStatus("Ready");
    return;
  }

  setStatus("Creating anonymous session…");
  const { data: s2, error: e2 } = await sb.auth.signInAnonymously();
  if (e2) throw e2;

  sessionUserId = s2?.user?.id || s2?.session?.user?.id || null;
  if (!sessionUserId) throw new Error("Anonymous session failed.");
  setStatus("Ready");
}

async function fetchNotes() {
  setStatus("Loading notes…");

  const { data, error } = await sb
    .from("notes")
    .select("id,title,content,created_at,updated_at,pinned,archived,tags,color")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw error;

  allNotes = data || [];
  setStatus("Ready");
  renderTagFilters();
  renderList();

  if (!activeId) {
    const first = getVisibleNotes()[0];
    setActiveNoteFields(first || null);
  } else {
    // refresh active note fields if present
    const current = allNotes.find(n => n.id === activeId);
    if (current) setActiveNoteFields(current, { keepFocus: true });
  }
}

async function createNote() {
  setStatus("Creating…");
  const { data, error } = await sb
    .from("notes")
    .insert({
      user_id: sessionUserId,
      title: "",
      content: "",
      pinned: false,
      archived: false,
      tags: [],
      color: "slate"
    })
    .select("id,title,content,created_at,updated_at,pinned,archived,tags,color")
    .single();

  if (error) throw error;

  allNotes.unshift(data);
  setStatus("Ready");
  renderTagFilters();
  renderList();
  toast("New note created");
  setActiveNoteFields(data);
}

async function updateNote(partial) {
  if (!activeId) return;

  saveText.textContent = "Saving…";

  const { data, error } = await sb
    .from("notes")
    .update(partial)
    .eq("id", activeId)
    .select("id,title,content,created_at,updated_at,pinned,archived,tags,color")
    .single();

  if (error) throw error;

  allNotes = allNotes.map(n => (n.id === activeId ? data : n));
  allNotes.sort((a,b) => {
    // pinned first, then updated desc
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  const active = allNotes.find(n => n.id === activeId);
  if (active) {
    metaText.textContent = `Created ${formatDate(active.created_at)} • Updated ${formatDate(active.updated_at)}`;
    lastSavedHash = computeHash(active);
  }

  saveText.textContent = "Saved";
  renderTagFilters();
  renderList();
}

async function deleteActiveNote() {
  if (!activeId) return;
  setStatus("Deleting…");

  const idToDelete = activeId;
  const { error } = await sb.from("notes").delete().eq("id", idToDelete);
  if (error) throw error;

  allNotes = allNotes.filter(n => n.id !== idToDelete);
  setStatus("Ready");
  toast("Deleted");

  activeId = null;
  renderTagFilters();
  renderList();

  const first = getVisibleNotes()[0];
  setActiveNoteFields(first || null);
}

async function duplicateActiveNote() {
  const n = allNotes.find(x => x.id === activeId);
  if (!n) return;

  const { data, error } = await sb
    .from("notes")
    .insert({
      user_id: sessionUserId,
      title: (n.title || "Untitled") + " (copy)",
      content: n.content || "",
      pinned: false,
      archived: false,
      tags: Array.isArray(n.tags) ? n.tags : [],
      color: n.color || "slate"
    })
    .select("id,title,content,created_at,updated_at,pinned,archived,tags,color")
    .single();

  if (error) throw error;

  allNotes.unshift(data);
  toast("Duplicated");
  renderTagFilters();
  renderList();
  setActiveNoteFields(data);
}

// ---------- rendering ----------
function colorDotClass(color) {
  const c = (color || "slate");
  return `dot-${COLORS.includes(c) ? c : "slate"}`;
}

function getVisibleNotes() {
  let notes = allNotes.slice();

  if (listMode === "pinned") notes = notes.filter(n => !!n.pinned && !n.archived);
  else if (listMode === "archived") notes = notes.filter(n => !!n.archived);
  else notes = notes.filter(n => !n.archived);

  const q = (searchInput.value || "").toLowerCase().trim();
  if (q) {
    notes = notes.filter(n =>
      (n.title || "").toLowerCase().includes(q) ||
      (n.content || "").toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  if (activeTagFilter) {
    notes = notes.filter(n => (n.tags || []).includes(activeTagFilter));
  }

  // pinned first inside "all"
  notes.sort((a,b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  return notes;
}

function renderTagFilters() {
  const visibleBase =
    listMode === "archived"
      ? allNotes.filter(n => n.archived)
      : allNotes.filter(n => !n.archived);

  const tags = uniqTagsFromNotes(visibleBase);
  tagFilterRow.innerHTML = "";

  if (!tags.length) return;

  for (const t of tags) {
    const b = document.createElement("button");
    b.className = "tagPill" + (t === activeTagFilter ? " active" : "");
    b.textContent = `#${t}`;
    b.addEventListener("click", () => {
      activeTagFilter = (activeTagFilter === t) ? null : t;
      renderTagFilters();
      renderList();
    });
    tagFilterRow.appendChild(b);
  }
}

function renderList() {
  const notes = getVisibleNotes();
  notesList.innerHTML = "";

  for (const n of notes) {
    const item = document.createElement("div");
    item.className = "item" + (n.id === activeId ? " active" : "");
    item.tabIndex = 0;

    const row = document.createElement("div");
    row.className = "itemRow";

    const left = document.createElement("div");
    left.style.minWidth = "0";
    left.style.display = "flex";
    left.style.gap = "10px";
    left.style.alignItems = "center";

    const dot = document.createElement("div");
    dot.className = `colorDot ${colorDotClass(n.color)}`;

    const title = document.createElement("div");
    title.className = "itemTitle";
    title.textContent = (n.title || "Untitled").trim() || "Untitled";

    left.appendChild(dot);
    left.appendChild(title);

    const badges = document.createElement("div");
    badges.className = "badges";
    if (n.pinned) {
      const pin = document.createElement("div");
      pin.className = "badge pin";
      pin.textContent = "Pinned";
      badges.appendChild(pin);
    }
    row.appendChild(left);
    row.appendChild(badges);

    const body = document.createElement("div");
    body.className = "itemBody";
    body.textContent = notePreview(n.content);

    const meta = document.createElement("div");
    meta.className = "itemMeta";
    const tags = (n.tags || []).slice(0, 3).map(t => `#${t}`).join(" ");
    meta.textContent = `Updated ${formatDate(n.updated_at)}${tags ? " • " + tags : ""}`;

    item.appendChild(row);
    item.appendChild(body);
    item.appendChild(meta);

    item.addEventListener("click", () => selectNote(n.id));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectNote(n.id);
      }
    });

    notesList.appendChild(item);
  }

  countText.textContent = `${notes.length} shown • ${allNotes.length} total`;

  // if active note not visible anymore, disable editor
  if (activeId && !notes.some(n => n.id === activeId)) {
    setActiveNoteFields(null);
  }
}

function renderColorPalette(activeColor) {
  colorPalette.innerHTML = "";
  for (const c of COLORS) {
    const s = document.createElement("button");
    s.className = `swatch sw-${c}` + (c === (activeColor || "slate") ? " active" : "");
    s.title = `Color: ${c}`;
    s.addEventListener("click", () => {
      if (!activeId) return;
      updateNote({ color: c }).catch(err => (console.error(err), toast("Color failed")));
      renderColorPalette(c);
    });
    colorPalette.appendChild(s);
  }
}

function renderTagChips(tags) {
  tagListEl.innerHTML = "";
  for (const t of (tags || [])) {
    const chip = document.createElement("div");
    chip.className = "tagChip";
    chip.innerHTML = `${escapeHtml(t)} <span class="x">×</span>`;
    chip.title = "Remove tag";
    chip.addEventListener("click", () => removeTag(t));
    tagListEl.appendChild(chip);
  }
}

function setActiveNoteFields(note, opts = {}) {
  const keepFocus = !!opts.keepFocus;

  if (!note) {
    activeId = null;
    titleInput.value = "";
    bodyInput.value = "";
    tagInput.value = "";
    renderTagChips([]);
    renderColorPalette("slate");
    previewEl.innerHTML = "";
    metaText.textContent = "—";
    saveText.textContent = "—";
    statsText.textContent = "—";
    lastSavedHash = "";
    setEditorEnabled(false);
    return;
  }

  activeId = note.id;
  titleInput.value = note.title || "";
  bodyInput.value = note.content || "";
  tagInput.value = "";

  renderTagChips(note.tags || []);
  renderColorPalette(note.color || "slate");

  metaText.textContent = `Created ${formatDate(note.created_at)} • Updated ${formatDate(note.updated_at)}`;
  saveText.textContent = "Saved";
  updateStats();
  renderPreview();

  pinBtn.textContent = note.pinned ? "📌 Unpin" : "📌 Pin";
  archiveBtn.disabled = !!note.archived;
  restoreBtn.disabled = !note.archived;

  // enable editor even in archived (read/write allowed by policy); UI chooses mode
  setEditorEnabled(true);

  lastSavedHash = computeHash(note);

  renderList();

  if (!keepFocus) {
    titleInput.focus({ preventScroll: true });
  }
}

// ---------- tag operations ----------
function normalizeTag(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return null;
  // keep it simple: letters, numbers, dash, underscore
  return t.replace(/[^a-z0-9_-]/g, "").slice(0, 24) || null;
}

function addTagsFromInput() {
  if (!activeId) return;
  const raw = tagInput.value || "";
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  tagInput.value = "";

  if (!parts.length) return;

  const note = allNotes.find(n => n.id === activeId);
  const current = new Set(note?.tags || []);
  for (const p of parts) {
    const nt = normalizeTag(p);
    if (nt) current.add(nt);
  }

  const next = [...current].sort((a,b)=>a.localeCompare(b));
  updateNote({ tags: next }).catch(err => (console.error(err), toast("Tag failed")));
  renderTagChips(next);
  renderTagFilters();
}

function removeTag(tag) {
  if (!activeId) return;
  const note = allNotes.find(n => n.id === activeId);
  const next = (note?.tags || []).filter(t => t !== tag);
  updateNote({ tags: next }).catch(err => (console.error(err), toast("Tag failed")));
  renderTagChips(next);
  renderTagFilters();
}

// ---------- saving ----------
function scheduleSave() {
  if (!activeId) return;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushSaveIfDirty().catch(err => {
      console.error(err);
      setStatus("Save failed (console)");
      toast("Save failed");
    });
  }, 450);
}

async function flushSaveIfDirty() {
  if (!activeId) return;

  const note = allNotes.find(n => n.id === activeId);
  if (!note) return;

  const draft = {
    ...note,
    title: titleInput.value || "",
    content: bodyInput.value || ""
  };

  const h = computeHash(draft);
  if (h === lastSavedHash) {
    saveText.textContent = "Saved";
    return;
  }

  await updateNote({ title: draft.title, content: draft.content });
  saveText.textContent = "Saved";
}

// ---------- list mode ----------
function setListMode(mode) {
  listMode = mode;
  activeTagFilter = null;

  tabAll.classList.toggle("active", mode === "all");
  tabPinned.classList.toggle("active", mode === "pinned");
  tabArchived.classList.toggle("active", mode === "archived");

  renderTagFilters();
  renderList();

  const first = getVisibleNotes()[0];
  setActiveNoteFields(first || null);
}

// ---------- export/import ----------
function exportNotes() {
  const payload = {
    exported_at: new Date().toISOString(),
    notes: allNotes.map(n => ({
      title: n.title || "",
      content: n.content || "",
      created_at: n.created_at,
      updated_at: n.updated_at,
      pinned: !!n.pinned,
      archived: !!n.archived,
      tags: n.tags || [],
      color: n.color || "slate"
    }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `notebook-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
  toast("Exported");
}

async function importNotesFromFile(file) {
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { toast("Invalid JSON"); return; }

  const notes = Array.isArray(parsed?.notes) ? parsed.notes : null;
  if (!notes) { toast("No notes found"); return; }

  setStatus("Importing…");

  const rows = notes.map(n => ({
    user_id: sessionUserId,
    title: (n.title || "").slice(0, 5000),
    content: (n.content || "").slice(0, 200000),
    pinned: !!n.pinned,
    archived: !!n.archived,
    tags: Array.isArray(n.tags) ? n.tags.map(normalizeTag).filter(Boolean) : [],
    color: COLORS.includes(n.color) ? n.color : "slate"
  }));

  const chunkSize = 100;
  for (let i=0; i<rows.length; i+=chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb.from("notes").insert(chunk);
    if (error) throw error;
  }

  await fetchNotes();
  setStatus("Ready");
  toast("Imported");
}

// ---------- UI wiring ----------
function selectNote(id) {
  flushSaveIfDirty().finally(() => {
    const note = allNotes.find(n => n.id === id);
    setActiveNoteFields(note || null);
  });
}

function wireUI() {
  // theme
  setTheme(getTheme());
  themeBtn.addEventListener("click", () => {
    const next = getTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    toast(next === "dark" ? "Dark mode" : "Light mode");
  });

  // view mode
  setEditorMode(getEditorMode());
  modeEditBtn.addEventListener("click", () => setEditorMode("edit"));
  modeSplitBtn.addEventListener("click", () => setEditorMode("split"));
  modePreviewBtn.addEventListener("click", () => setEditorMode("preview"));

  // list tabs
  tabAll.addEventListener("click", () => setListMode("all"));
  tabPinned.addEventListener("click", () => setListMode("pinned"));
  tabArchived.addEventListener("click", () => setListMode("archived"));

  // search
  searchInput.addEventListener("input", () => { renderList(); });
  clearSearchBtn.addEventListener("click", () => { searchInput.value = ""; renderList(); });

  // new note
  newNoteBtn.addEventListener("click", () => createNote().catch(e => (console.error(e), toast("Create failed"))));

  // editor inputs
  titleInput.addEventListener("input", () => { scheduleSave(); schedulePreview(); });
  bodyInput.addEventListener("input", () => { scheduleSave(); schedulePreview(); updateStats(); });

  // tags
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTagsFromInput();
    }
    if (e.key === "Backspace" && !tagInput.value) {
      // quick remove last tag
      const note = allNotes.find(n => n.id === activeId);
      const tags = note?.tags || [];
      if (tags.length) removeTag(tags[tags.length - 1]);
    }
  });
  tagInput.addEventListener("blur", () => {
    if (tagInput.value.trim()) addTagsFromInput();
  });

  // pin/archive/restore
  pinBtn.addEventListener("click", async () => {
    const n = allNotes.find(x => x.id === activeId);
    if (!n) return;
    await updateNote({ pinned: !n.pinned }).catch(e => (console.error(e), toast("Pin failed")));
    toast(n.pinned ? "Unpinned" : "Pinned");
    const updated = allNotes.find(x => x.id === activeId);
    if (updated) pinBtn.textContent = updated.pinned ? "📌 Unpin" : "📌 Pin";
    renderList();
  });

  archiveBtn.addEventListener("click", async () => {
    const n = allNotes.find(x => x.id === activeId);
    if (!n) return;
    await updateNote({ archived: true, pinned: false }).catch(e => (console.error(e), toast("Archive failed")));
    toast("Archived");
    setListMode("all");
  });

  restoreBtn.addEventListener("click", async () => {
    const n = allNotes.find(x => x.id === activeId);
    if (!n) return;
    await updateNote({ archived: false }).catch(e => (console.error(e), toast("Restore failed")));
    toast("Restored");
    setListMode("all");
  });

  duplicateBtn.addEventListener("click", () => duplicateActiveNote().catch(e => (console.error(e), toast("Duplicate failed"))));

  // delete
  deleteBtn.addEventListener("click", () => {
    if (!activeId) return;
    if (!confirm("Delete this note permanently?")) return;
    deleteActiveNote().catch(e => (console.error(e), toast("Delete failed")));
  });

  // copy markdown
  copyMdBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(bodyInput.value || "");
      toast("Copied");
    } catch {
      toast("Copy blocked");
    }
  });

  // export/import
  exportBtn.addEventListener("click", exportNotes);
  importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { await importNotesFromFile(file); }
    catch (err) { console.error(err); toast("Import failed"); setStatus("Import failed"); }
    finally { importInput.value = ""; }
  });

  // keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    if (mod && k === "s") { e.preventDefault(); flushSaveIfDirty().catch(()=>{}); toast("Saved"); }
    if (mod && k === "p") { e.preventDefault(); if (!pinBtn.disabled) pinBtn.click(); }
    if (mod && k === "e") { e.preventDefault();
      const cur = editorBody.getAttribute("data-mode") || "split";
      setEditorMode(cur === "preview" ? "edit" : (cur === "edit" ? "split" : "preview"));
    }
  });

  // flush on background
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSaveIfDirty().catch(() => {});
  });

  // offline indicator
  const updateNet = () => { setStatus(navigator.onLine ? "Ready" : "Offline (won't sync)"); };
  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);
}

// ---------- main ----------
async function main() {
  try {
    setEditorEnabled(false);
    wireUI();

    await ensureAnonymousSession();
    await fetchNotes();

    if (!allNotes.length) await createNote();
    else {
      const first = getVisibleNotes()[0];
      setActiveNoteFields(first || null);
    }

    toast("Loaded");
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Error (console)");
    toast("Error — open console");
  }
}

main();
