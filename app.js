"use strict";

/* ============ التخزين ============ */
const STORE_KEY = "halaqa-tracker-v1";
const DEFAULT_TEMPLATE =
`السلام عليكم ورحمة الله وبركاته
الأخ الكريم {الاسم} حفظه الله
نذكّرك بموعد {الحلقة}: {الموعد}
{الواجب}
{الأخطاء}
وفقك الله وجعلك من أهل القرآن.
{المعلم}`;

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const GRADES = ["ممتاز", "جيد جداً", "جيد", "مقبول", "يُعاد"];
const SESSION_TYPES = { hifz: "حفظ جديد", murajaa: "مراجعة", tathbit: "تثبيت" };
const MISTAKE_KINDS = ["نسيان/حفظ", "تشكيل", "تجويد", "تبديل كلمة", "تردد", "أخرى"];

function emptyDb() {
  return {
    settings: { halaqaName: "حلقة القرآن", teacherName: "", countryCode: "966", template: DEFAULT_TEMPLATE, repeatThreshold: 2 },
    students: [], sessions: [], mistakes: []
  };
}

let db = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyDb();
    const data = JSON.parse(raw);
    const base = emptyDb();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  } catch (e) {
    console.error(e);
    return emptyDb();
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast("تعذّر الحفظ في المتصفح"); }
}

/* ============ أدوات مساعدة ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const surahName = (n) => (SURAHS[n - 1] || ["؟"])[0];
const surahAyahs = (n) => (SURAHS[n - 1] || [0, 0])[1];

function todayStr(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDate(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
}
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" });
}

// تطبيع الكلمة لمقارنة الأخطاء المتكررة: إزالة التشكيل وتوحيد الهمزات
function normalizeWord(w) {
  return String(w || "")
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}
const timesAr = (n) => (n === 1 ? "مرة" : n === 2 ? "مرتين" : n <= 10 ? `${n} مرات` : `${n} مرة`);
const mistakeKey = (m) => `${m.surah}|${m.ayah}|${normalizeWord(m.word)}`;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function surahOptions(selected) {
  return SURAHS.map(([name, n], i) =>
    `<option value="${i + 1}" ${i + 1 === Number(selected) ? "selected" : ""}>${i + 1}. ${name} (${n})</option>`).join("");
}

/* ============ استعلامات البيانات ============ */
const getStudent = (id) => db.students.find((s) => s.id === id);
const studentSessions = (id) => db.sessions.filter((s) => s.studentId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
const studentMistakes = (id) => db.mistakes.filter((m) => m.studentId === id);

// تجميع أخطاء الطالب حسب الموضع (السورة + الآية + الكلمة)
function groupMistakes(list) {
  const groups = new Map();
  for (const m of list) {
    const k = mistakeKey(m);
    if (!groups.has(k)) groups.set(k, { key: k, surah: m.surah, ayah: m.ayah, word: m.word, items: [] });
    groups.get(k).items.push(m);
  }
  const out = [...groups.values()].map((g) => {
    g.items.sort((a, b) => b.date.localeCompare(a.date));
    g.count = g.items.length;
    g.lastDate = g.items[0].date;
    g.kinds = [...new Set(g.items.map((i) => i.kind))];
    g.resolved = g.items.every((i) => i.resolved);
    g.repeated = g.count >= db.settings.repeatThreshold;
    return g;
  });
  return out.sort((a, b) => (a.resolved - b.resolved) || (b.count - a.count) || b.lastDate.localeCompare(a.lastDate));
}

// الموعد القادم للطالب حسب أيام الحلقة ووقتها
function nextAppointment(st, from = new Date()) {
  if (!st.days || !st.days.length) return null;
  const [h, m] = (st.time || "00:00").split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m);
    if (st.days.includes(d.getDay()) && d > from) return d;
  }
  return null;
}
function fmtAppointment(d) {
  if (!d) return "لم يُحدَّد موعد";
  const today = todayStr(), tomorrow = todayStr(new Date(Date.now() + 864e5));
  const day = todayStr(d) === today ? "اليوم" : todayStr(d) === tomorrow ? "غداً" : "";
  const name = d.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" });
  return `${day ? day + " " : ""}${name} الساعة ${time}`;
}

function hifzAyahCount(id) {
  // عدد الآيات المحفوظة (بدون تكرار) من جلسات الحفظ الجديد
  const set = new Set();
  for (const s of db.sessions) {
    if (s.studentId !== id || s.type !== "hifz") continue;
    for (let a = s.fromAyah; a <= s.toAyah; a++) set.add(`${s.surah}:${a}`);
  }
  return set.size;
}

/* ============ رسالة التذكير ============ */
function buildMessage(st, opts = {}) {
  const s = db.settings;
  const { includeMistakes = true, includeAssignment = true, onlyRepeated = false, extra = "" } = opts;
  const last = studentSessions(st.id)[0];
  const assignment = includeAssignment && last && last.assignment ? `الواجب المطلوب: ${last.assignment}` : "";

  let mistakesText = "";
  if (includeMistakes) {
    const groups = groupMistakes(studentMistakes(st.id)).filter((g) => !g.resolved && (!onlyRepeated || g.repeated)).slice(0, 10);
    if (groups.length) {
      mistakesText = "مواضع تحتاج إلى مراجعة وتثبيت:\n" + groups.map((g) =>
        `• ${surahName(g.surah)} آية ${g.ayah}${g.word ? `: «${g.word}»` : ""} (${g.kinds.join("، ")})${g.count > 1 ? ` — تكرر ${timesAr(g.count)}` : ""}`
      ).join("\n");
    }
  }

  let text = s.template
    .replaceAll("{الاسم}", st.name)
    .replaceAll("{الحلقة}", s.halaqaName || "الحلقة")
    .replaceAll("{الموعد}", fmtAppointment(nextAppointment(st)))
    .replaceAll("{الواجب}", assignment)
    .replaceAll("{الأخطاء}", mistakesText)
    .replaceAll("{المعلم}", s.teacherName ? `معلمك: ${s.teacherName}` : "");
  if (extra.trim()) text += "\n" + extra.trim();
  // حذف الأسطر الفارغة المتتالية الناتجة عن المتغيرات الفارغة
  return text.split("\n").filter((l, i, arr) => l.trim() || (i > 0 && arr[i - 1].trim())).join("\n").trim();
}

function normalizePhone(phone) {
  let p = String(phone || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p.slice(1);
  if (p.startsWith("00")) return p.slice(2);
  if (p.startsWith("0")) return (db.settings.countryCode || "") + p.slice(1);
  return p;
}
const waLink = (phone, text) => `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
const smsLink = (phone, text) => `sms:${String(phone).replace(/[^\d+]/g, "")}?body=${encodeURIComponent(text)}`;

/* ============ النوافذ المنبثقة ============ */
const dlg = $("#dlg");
// النموذج نفسه يُعاد استخدامه، لذا تُسند المعالجات بالتعيين لا بـ addEventListener حتى لا تتراكم
function openDialog(html, onSubmit, onClick = null) {
  const form = $("#dlg-form");
  form.innerHTML = html;
  form.onclick = onClick;
  form.onsubmit = (e) => {
    e.preventDefault();
    if (onSubmit(new FormData(form), form) !== false) dlg.close();
  };
  $$("[data-close]", form).forEach((b) => b.addEventListener("click", () => dlg.close()));
  dlg.showModal();
  return form;
}
const dlgActions = (label = "حفظ") =>
  `<div class="dlg-actions"><button type="button" class="btn" data-close>إلغاء</button><button class="btn primary">${label}</button></div>`;

function studentForm(st = {}) {
  const days = st.days || [];
  openDialog(`
    <h2>${st.id ? "تعديل بيانات الطالب" : "إضافة طالب"}</h2>
    <label><span>اسم الطالب</span><input name="name" required value="${esc(st.name)}"></label>
    <div class="grid2">
      <label><span>جوال الطالب</span><input name="phone" type="tel" inputmode="tel" placeholder="05xxxxxxxx" value="${esc(st.phone)}"></label>
      <label><span>جوال ولي الأمر</span><input name="guardianPhone" type="tel" inputmode="tel" value="${esc(st.guardianPhone)}"></label>
    </div>
    <label><span>أيام الحلقة</span>
      <div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${days.includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div>
    </label>
    <label><span>وقت الحلقة</span><input name="time" type="time" value="${esc(st.time || "16:00")}"></label>
    <label><span>ملاحظات (المستوى، مقدار الحفظ الحالي…)</span><textarea name="notes">${esc(st.notes)}</textarea></label>
    ${dlgActions()}`, (fd) => {
    const data = {
      name: fd.get("name").trim(), phone: fd.get("phone").trim(), guardianPhone: fd.get("guardianPhone").trim(),
      days: fd.getAll("days").map(Number), time: fd.get("time"), notes: fd.get("notes").trim()
    };
    if (st.id) Object.assign(st, data);
    else { const n = { id: uid(), createdAt: Date.now(), ...data }; db.students.push(n); location.hash = `#/student/${n.id}`; }
    save(); render(); toast("تم الحفظ");
  });
}

function mistakeRowHtml(m = {}, defSurah = 1) {
  return `<div class="mistake-row">
    <div class="grid3">
      <label><span>السورة</span><select name="m_surah">${surahOptions(m.surah || defSurah)}</select></label>
      <label><span>الآية</span><input name="m_ayah" type="number" min="1" required value="${esc(m.ayah || "")}"></label>
      <label><span>النوع</span><select name="m_kind">${MISTAKE_KINDS.map((k) => `<option ${k === m.kind ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    </div>
    <div class="row">
      <label class="grow" style="margin:0"><span>الكلمة أو الموضع</span><input name="m_word" value="${esc(m.word || "")}" placeholder="مثال: الرَّحِيمِ"></label>
      <button type="button" class="btn sm danger" data-remove-row style="align-self:flex-end">حذف</button>
    </div>
  </div>`;
}

function readMistakeRows(form) {
  const rows = [];
  for (const row of $$(".mistake-row", form)) {
    const surah = Number($("[name=m_surah]", row).value);
    const ayah = Number($("[name=m_ayah]", row).value);
    const word = $("[name=m_word]", row).value.trim();
    const kind = $("[name=m_kind]", row).value;
    if (!ayah) continue;
    if (ayah > surahAyahs(surah)) { toast(`سورة ${surahName(surah)} عدد آياتها ${surahAyahs(surah)} فقط`); return null; }
    rows.push({ surah, ayah, word, kind });
  }
  return rows;
}

function bindMistakeRows(form, getDefSurah) {
  form.onclick = (e) => {
    if (e.target.matches("[data-add-row]")) {
      const rows = $("#mistake-rows", form);
      rows.insertAdjacentHTML("beforeend", mistakeRowHtml({}, getDefSurah()));
      $("[name=m_ayah]", rows.lastElementChild).focus();
    } else if (e.target.matches("[data-remove-row]")) {
      e.target.closest(".mistake-row").remove();
    }
  };
}

function sessionForm(studentId, ses = {}) {
  const last = studentSessions(studentId)[0];
  const defSurah = ses.surah || (last ? last.surah : 1);
  const existingMistakes = ses.id ? db.mistakes.filter((m) => m.sessionId === ses.id) : [];
  const form = openDialog(`
    <h2>${ses.id ? "تعديل التسميع" : "تسميع جديد"} — ${esc(getStudent(studentId).name)}</h2>
    <div class="grid2">
      <label><span>التاريخ</span><input name="date" type="date" required value="${esc(ses.date || todayStr())}"></label>
      <label><span>النوع</span><select name="type">${Object.entries(SESSION_TYPES).map(([k, v]) => `<option value="${k}" ${k === ses.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    </div>
    <div class="grid3">
      <label><span>السورة</span><select name="surah">${surahOptions(defSurah)}</select></label>
      <label><span>من آية</span><input name="fromAyah" type="number" min="1" required value="${esc(ses.fromAyah || 1)}"></label>
      <label><span>إلى آية</span><input name="toAyah" type="number" min="1" required value="${esc(ses.toAyah || "")}"></label>
    </div>
    <label><span>التقدير</span><select name="grade">${GRADES.map((g) => `<option ${g === ses.grade ? "selected" : ""}>${g}</option>`).join("")}</select></label>
    <h3>الأخطاء في هذا التسميع</h3>
    <div id="mistake-rows">${existingMistakes.map((m) => mistakeRowHtml(m)).join("")}</div>
    <button type="button" class="btn sm" data-add-row>+ إضافة خطأ</button>
    <label style="margin-top:12px"><span>الواجب القادم</span><input name="assignment" value="${esc(ses.assignment || "")}" placeholder="مثال: حفظ البقرة 21-30 ومراجعة 1-20"></label>
    <label><span>ملاحظات المعلم</span><textarea name="notes">${esc(ses.notes || "")}</textarea></label>
    ${dlgActions()}`, (fd, f) => {
    const surah = Number(fd.get("surah")), fromAyah = Number(fd.get("fromAyah")), toAyah = Number(fd.get("toAyah"));
    const max = surahAyahs(surah);
    if (fromAyah > toAyah || toAyah > max) { toast(`تحقق من الآيات: سورة ${surahName(surah)} عدد آياتها ${max}`); return false; }
    const rows = readMistakeRows(f);
    if (!rows) return false;
    const data = {
      date: fd.get("date"), type: fd.get("type"), surah, fromAyah, toAyah,
      grade: fd.get("grade"), assignment: fd.get("assignment").trim(), notes: fd.get("notes").trim()
    };
    let target = ses;
    if (ses.id) Object.assign(ses, data);
    else { target = { id: uid(), studentId, createdAt: Date.now(), ...data }; db.sessions.push(target); }
    // استبدال أخطاء هذا التسميع مع الحفاظ على حالة "أُتقن"
    const oldResolved = new Map(existingMistakes.map((m) => [mistakeKey(m), m.resolved]));
    db.mistakes = db.mistakes.filter((m) => m.sessionId !== target.id);
    for (const r of rows) {
      const m = { id: uid(), studentId, sessionId: target.id, date: data.date, ...r };
      m.resolved = oldResolved.get(mistakeKey(m)) || false;
      db.mistakes.push(m);
    }
    save(); render(); toast("تم حفظ التسميع");
  });
  bindMistakeRows(form, () => Number($("[name=surah]", form).value));
  if (!ses.id) $("[name=toAyah]", form).focus();
}

function quickMistakeForm(studentId) {
  const form = openDialog(`
    <h2>تسجيل خطأ — ${esc(getStudent(studentId).name)}</h2>
    <label><span>التاريخ</span><input name="date" type="date" required value="${todayStr()}"></label>
    <div id="mistake-rows">${mistakeRowHtml({}, (studentSessions(studentId)[0] || {}).surah || 1)}</div>
    <button type="button" class="btn sm" data-add-row>+ خطأ آخر</button>
    ${dlgActions()}`, (fd, f) => {
    const rows = readMistakeRows(f);
    if (!rows) return false;
    if (!rows.length) { toast("أدخل رقم الآية"); return false; }
    for (const r of rows) db.mistakes.push({ id: uid(), studentId, sessionId: null, date: fd.get("date"), resolved: false, ...r });
    save(); render(); toast("تم تسجيل الخطأ");
  });
  bindMistakeRows(form, () => 1);
}

function reminderDialog(st) {
  const hasPhone = st.phone || st.guardianPhone;
  const form = openDialog(`
    <h2>رسالة تذكير — ${esc(st.name)}</h2>
    <div class="row small">
      <label class="row" style="margin:0"><input type="checkbox" name="inc_m" checked style="width:auto;min-height:0"> الأخطاء</label>
      <label class="row" style="margin:0"><input type="checkbox" name="only_rep" style="width:auto;min-height:0"> المتكررة فقط</label>
      <label class="row" style="margin:0"><input type="checkbox" name="inc_a" checked style="width:auto;min-height:0"> الواجب</label>
    </div>
    <label style="margin-top:10px"><span>إرسال إلى</span>
      <select name="to">
        ${st.phone ? `<option value="phone">الطالب (${esc(st.phone)})</option>` : ""}
        ${st.guardianPhone ? `<option value="guardianPhone">ولي الأمر (${esc(st.guardianPhone)})</option>` : ""}
      </select></label>
    <label><span>نص الرسالة (يمكنك تعديله)</span><textarea name="text" rows="10" style="min-height:220px"></textarea></label>
    ${hasPhone ? "" : `<p class="badge warn">لا يوجد رقم جوال لهذا الطالب — يمكنك نسخ الرسالة</p>`}
    <div class="row">
      ${hasPhone ? `<button type="button" class="btn whatsapp" data-send="wa">واتساب</button><button type="button" class="btn" data-send="sms">رسالة SMS</button>` : ""}
      <button type="button" class="btn" data-send="copy">نسخ</button>
      <span class="grow"></span>
      <button type="button" class="btn" data-close>إغلاق</button>
    </div>`, () => false);
  const refresh = () => {
    $("[name=text]", form).value = buildMessage(st, {
      includeMistakes: $("[name=inc_m]", form).checked,
      onlyRepeated: $("[name=only_rep]", form).checked,
      includeAssignment: $("[name=inc_a]", form).checked
    });
  };
  $$("[name=inc_m],[name=only_rep],[name=inc_a]", form).forEach((c) => c.addEventListener("change", refresh));
  refresh();
  form.onclick = async (e) => {
    const mode = e.target.dataset && e.target.dataset.send;
    if (!mode) return;
    const text = $("[name=text]", form).value;
    const phone = st[$("[name=to]", form)?.value] || st.phone || st.guardianPhone;
    if (mode === "copy") {
      try { await navigator.clipboard.writeText(text); toast("تم نسخ الرسالة"); }
      catch { $("[name=text]", form).select(); document.execCommand("copy"); toast("تم النسخ"); }
      return;
    }
    st.lastReminder = Date.now(); save();
    window.open(mode === "wa" ? waLink(phone, text) : smsLink(phone, text), "_blank");
  };
}

/* ============ الصفحات ============ */
const view = $("#view");

function initials(name) { return esc((name || "؟").trim().charAt(0)); }

function studentRow(st, extra = "") {
  return `<li class="row between">
    <a class="student-link grow" href="#/student/${st.id}">
      <span class="avatar">${initials(st.name)}</span>
      <span class="grow"><b>${esc(st.name)}</b><br><span class="muted small">${extra}</span></span>
    </a>
    <button class="btn sm" data-remind="${st.id}">🔔 تذكير</button>
  </li>`;
}

function pageHome() {
  const now = new Date();
  const todayDow = now.getDay(), tomorrowDow = (todayDow + 1) % 7;
  const today = db.students.filter((s) => (s.days || []).includes(todayDow));
  const tomorrow = db.students.filter((s) => (s.days || []).includes(tomorrowDow));
  const openRepeated = db.students.map((s) => ({ s, g: groupMistakes(studentMistakes(s.id)).filter((g) => g.repeated && !g.resolved) }))
    .filter((x) => x.g.length).sort((a, b) => b.g.length - a.g.length);
  const weekAgo = todayStr(new Date(Date.now() - 7 * 864e5));

  return `
    <h1>${esc(db.settings.halaqaName)}</h1>
    <p class="muted">${now.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
    <div class="stats">
      <div class="stat"><b>${db.students.length}</b><span>طالب</span></div>
      <div class="stat"><b>${db.sessions.filter((s) => s.date >= weekAgo).length}</b><span>تسميع هذا الأسبوع</span></div>
      <div class="stat"><b>${openRepeated.reduce((a, x) => a + x.g.length, 0)}</b><span>خطأ متكرر لم يُتقن</span></div>
    </div>
    ${db.students.length === 0 ? `<div class="card empty">ابدأ بإضافة طلاب حلقتك<br><br><button class="btn primary" data-action="add-student">+ إضافة طالب</button></div>` : ""}
    ${today.length ? `<h2>حلقة اليوم (${DAYS[todayDow]})</h2>
      <div class="card"><ul class="list">${today.map((s) => studentRow(s, `الساعة ${fmtTime(s.time)}`)).join("")}</ul></div>` : ""}
    ${tomorrow.length ? `<h2>حلقة الغد (${DAYS[tomorrowDow]}) — ذكّرهم الليلة</h2>
      <div class="card"><ul class="list">${tomorrow.map((s) => studentRow(s, `الساعة ${fmtTime(s.time)}`)).join("")}</ul></div>` : ""}
    ${openRepeated.length ? `<h2>طلاب لديهم أخطاء متكررة</h2>
      <div class="card"><ul class="list">${openRepeated.slice(0, 8).map((x) => studentRow(x.s, `${x.g.length} موضع متكرر: ${x.g.slice(0, 2).map((g) => `${surahName(g.surah)} ${g.ayah}`).join("، ")}`)).join("")}</ul></div>` : ""}
  `;
}

function pageStudents() {
  const q = pageStudents.q || "";
  const list = db.students.filter((s) => !q || s.name.includes(q)).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return `
    <div class="row between"><h1>الطلاب (${db.students.length})</h1><button class="btn primary" data-action="add-student">+ طالب</button></div>
    <input id="search" placeholder="بحث بالاسم…" value="${esc(q)}" style="margin-bottom:12px">
    <div class="card">${list.length ? `<ul class="list">${list.map((s) => {
      const last = studentSessions(s.id)[0];
      const rep = groupMistakes(studentMistakes(s.id)).filter((g) => g.repeated && !g.resolved).length;
      const info = [last ? `آخر تسميع: ${surahName(last.surah)} ${last.fromAyah}-${last.toAyah}` : "لا يوجد تسميع بعد",
        rep ? `<span class="badge danger">${rep} متكرر</span>` : ""].filter(Boolean).join(" · ");
      return studentRow(s, info);
    }).join("")}</ul>` : `<p class="empty">لا يوجد طلاب</p>`}</div>`;
}

function pageStudent(id, tab) {
  const st = getStudent(id);
  if (!st) return `<p class="empty">الطالب غير موجود</p>`;
  tab = tab || "log";
  const sessions = studentSessions(id);
  const groups = groupMistakes(studentMistakes(id));
  const repeated = groups.filter((g) => g.repeated && !g.resolved);
  const appt = nextAppointment(st);

  let body = "";
  if (tab === "log") {
    body = sessions.length ? sessions.map((s) => {
      const ms = db.mistakes.filter((m) => m.sessionId === s.id);
      const gradeCls = s.grade === "يُعاد" ? "danger" : s.grade === "مقبول" ? "warn" : "ok";
      return `<div class="card">
        <div class="row between">
          <b>${SESSION_TYPES[s.type] || ""}: ${surahName(s.surah)} ${s.fromAyah}–${s.toAyah}</b>
          <span class="badge ${gradeCls}">${esc(s.grade)}</span>
        </div>
        <div class="muted small">${fmtDate(s.date)}</div>
        ${ms.length ? `<div class="small" style="margin-top:6px">الأخطاء (${ms.length}): ${ms.map((m) => `<span class="badge warn">${m.ayah}${m.word ? ": " + esc(m.word) : ""}</span>`).join(" ")}</div>` : `<div class="small" style="margin-top:6px"><span class="badge ok">بلا أخطاء</span></div>`}
        ${s.assignment ? `<div class="small" style="margin-top:6px">📝 الواجب: ${esc(s.assignment)}</div>` : ""}
        ${s.notes ? `<div class="small muted" style="margin-top:4px">${esc(s.notes)}</div>` : ""}
        <div class="row" style="margin-top:8px">
          <a class="btn sm" href="${mushafHash(`${s.surah}-${s.fromAyah}`, id, s.id)}">📖 المصحف</a>
          <button class="btn sm" data-edit-session="${s.id}">تعديل</button>
          <button class="btn sm danger" data-del-session="${s.id}">حذف</button>
        </div>
      </div>`;
    }).join("") : `<div class="card empty">لا يوجد تسميع مسجّل بعد</div>`;
  } else if (tab === "mistakes") {
    const filter = pageStudent.filter || "open";
    const shown = groups.filter((g) => filter === "all" || (filter === "repeated" ? g.repeated && !g.resolved : !g.resolved));
    body = `
      <div class="row" style="margin-bottom:10px">
        <div class="tabs" style="margin:0">
          ${[["open", "غير المتقنة"], ["repeated", "المتكررة"], ["all", "الكل"]].map(([k, v]) => `<button data-mfilter="${k}" class="${filter === k ? "active" : ""}">${v}</button>`).join("")}
        </div>
        <span class="grow"></span>
        <button class="btn sm primary" data-action="quick-mistake">+ خطأ</button>
      </div>
      ${shown.length ? shown.map(mistakeGroupCard).join("") : `<div class="card empty">لا توجد أخطاء هنا</div>`}`;
  } else if (tab === "info") {
    body = `<div class="card">
      <p><b>الجوال:</b> ${esc(st.phone) || "—"}</p>
      <p><b>ولي الأمر:</b> ${esc(st.guardianPhone) || "—"}</p>
      <p><b>أيام الحلقة:</b> ${(st.days || []).map((d) => DAYS[d]).join("، ") || "—"} ${st.time ? "— " + fmtTime(st.time) : ""}</p>
      <p><b>آخر تذكير:</b> ${st.lastReminder ? new Date(st.lastReminder).toLocaleString("ar") : "—"}</p>
      ${st.notes ? `<p><b>ملاحظات:</b> ${esc(st.notes)}</p>` : ""}
      <div class="row"><button class="btn" data-action="edit-student">تعديل البيانات</button><button class="btn danger" data-action="delete-student">حذف الطالب</button></div>
    </div>`;
  }

  return `
    <div class="card">
      <div class="row">
        <span class="avatar">${initials(st.name)}</span>
        <div class="grow"><h1 style="margin:0">${esc(st.name)}</h1>
          <div class="muted small">الموعد القادم: ${fmtAppointment(appt)}</div></div>
      </div>
      <div class="stats" style="margin:12px 0 0">
        <div class="stat"><b>${sessions.length}</b><span>تسميع</span></div>
        <div class="stat"><b>${hifzAyahCount(id)}</b><span>آية حُفظت</span></div>
        <div class="stat"><b>${repeated.length}</b><span>خطأ متكرر</span></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary grow" data-action="new-session">+ تسميع جديد</button>
        <a class="btn grow" href="${mushafHash(sessions[0] ? `${sessions[0].surah}-${sessions[0].fromAyah}` : 1, id)}">📖 المصحف</a>
        <button class="btn grow" data-remind="${st.id}">🔔 تذكير</button>
      </div>
    </div>
    <div class="tabs">
      ${[["log", "دفتر المتابعة"], ["mistakes", `الأخطاء (${groups.filter((g) => !g.resolved).length})`], ["info", "البيانات"]]
        .map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? "active" : ""}">${v}</button>`).join("")}
    </div>
    ${body}`;
}

function mistakeGroupCard(g, showStudent) {
  const st = showStudent ? getStudent(g.items[0].studentId) : null;
  return `<div class="card mistake ${g.repeated && !g.resolved ? "repeated" : ""} ${g.resolved ? "resolved" : ""}">
    <div class="row between">
      <div class="grow">
        ${st ? `<a href="#/student/${st.id}/mistakes" class="small">${esc(st.name)}</a><br>` : ""}
        <span class="word">${esc(g.word) || "—"}</span>
        <span class="muted"> · ${surahName(g.surah)} آية ${g.ayah}</span>
      </div>
      ${g.resolved ? `<span class="badge ok">أُتقن ✓</span>` : g.count > 1 ? `<span class="badge danger">تكرر ×${g.count}</span>` : `<span class="badge warn">مرة واحدة</span>`}
    </div>
    <div class="small muted">${g.kinds.join("، ")} · ${g.items.map((i) => fmtDate(i.date)).join(" | ")}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn sm" data-resolve="${esc(g.key)}" data-sid="${g.items[0].studentId}">${g.resolved ? "إعادة فتح" : "تم الإتقان ✓"}</button>
      <a class="btn sm" href="${mushafHash(`${g.surah}-${g.ayah}`, g.items[0].studentId)}">📖 في المصحف</a>
      <button class="btn sm danger" data-del-mistake="${g.items[0].id}">حذف آخر تسجيل</button>
    </div>
  </div>`;
}

function pageMistakes() {
  const all = [];
  for (const s of db.students) all.push(...groupMistakes(studentMistakes(s.id)).filter((g) => !g.resolved));
  all.sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  // أكثر المواضع خطأً على مستوى الحلقة كلها
  const byPlace = new Map();
  for (const m of db.mistakes) {
    const k = `${m.surah}|${m.ayah}`;
    if (!byPlace.has(k)) byPlace.set(k, { surah: m.surah, ayah: m.ayah, students: new Set(), n: 0 });
    const p = byPlace.get(k); p.n++; p.students.add(m.studentId);
  }
  const hot = [...byPlace.values()].filter((p) => p.students.size > 1).sort((a, b) => b.students.size - a.students.size || b.n - a.n).slice(0, 10);
  return `
    <h1>الأخطاء</h1>
    ${hot.length ? `<h2>مواضع يخطئ فيها أكثر من طالب</h2><div class="card"><ul class="list">
      ${hot.map((p) => `<li class="row between"><span>${surahName(p.surah)} آية ${p.ayah}</span><span class="badge danger">${p.students.size} طلاب · ${p.n} مرة</span></li>`).join("")}
      </ul><p class="small muted">مواضع تستحق التنبيه عليها للحلقة كلها.</p></div>` : ""}
    <h2>الأخطاء غير المتقنة لجميع الطلاب</h2>
    ${all.length ? all.map((g) => mistakeGroupCard(g, true)).join("") : `<div class="card empty">لا توجد أخطاء مفتوحة 🎉</div>`}`;
}

function pageReminders() {
  const now = new Date();
  const withAppt = db.students.map((s) => ({ s, d: nextAppointment(s, now) }))
    .sort((a, b) => (a.d ? a.d.getTime() : Infinity) - (b.d ? b.d.getTime() : Infinity));
  return `
    <h1>التذكير</h1>
    <p class="muted small">اضغط على "تذكير" لتجهيز رسالة فيها موعد الطالب وواجبه ومواضع أخطائه، ثم أرسلها بواتساب أو SMS.</p>
    <div class="card">${withAppt.length ? `<ul class="list">${withAppt.map(({ s, d }) =>
      studentRow(s, `${fmtAppointment(d)}${s.lastReminder ? ` · آخر تذكير: ${new Date(s.lastReminder).toLocaleDateString("ar")}` : ""}`)).join("")}</ul>`
      : `<p class="empty">أضف طلاباً أولاً</p>`}</div>`;
}

function pageSettings() {
  const s = db.settings;
  return `
    <h1>الإعدادات</h1>
    <form id="settings-form" class="card">
      <label><span>اسم الحلقة</span><input name="halaqaName" value="${esc(s.halaqaName)}"></label>
      <label><span>اسم المعلم</span><input name="teacherName" value="${esc(s.teacherName)}"></label>
      <div class="grid2">
        <label><span>مفتاح الدولة للجوال</span><input name="countryCode" inputmode="numeric" value="${esc(s.countryCode)}"></label>
        <label><span>يُعدّ الخطأ متكرراً بعد</span><select name="repeatThreshold">${[2, 3, 4].map((n) => `<option value="${n}" ${n === s.repeatThreshold ? "selected" : ""}>${n} مرات</option>`).join("")}</select></label>
      </div>
      <label><span>قالب رسالة التذكير</span><textarea name="template" rows="9" style="min-height:200px">${esc(s.template)}</textarea></label>
      <p class="small muted">المتغيرات المتاحة: {الاسم} {الحلقة} {الموعد} {الواجب} {الأخطاء} {المعلم}</p>
      <div class="row"><button class="btn primary">حفظ الإعدادات</button><button type="button" class="btn" data-action="reset-template">استعادة القالب الافتراضي</button></div>
    </form>
    <h2>النسخ الاحتياطي</h2>
    <div class="card">
      <p class="small muted">البيانات محفوظة في هذا الجهاز فقط. صدّر نسخة احتياطية بانتظام، ويمكنك استيرادها في جهاز آخر.</p>
      <div class="row">
        <button class="btn" data-action="export">⬇️ تصدير نسخة احتياطية</button>
        <label class="btn" style="margin:0">⬆️ استيراد<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      </div>
    </div>`;
}

/* ============ المصحف ============ */
// بداية كل سورة برقم الآية التراكمي (يبدأ من 1)
const SURAH_STARTS = SURAHS.reduce((acc, s, i) => (acc.push(i ? acc[i - 1] + SURAHS[i - 1][1] : 1), acc), []);
const toGlobal = (s, a) => SURAH_STARTS[s - 1] + a - 1;
function fromGlobal(g) {
  let s = SURAHS.length;
  while (SURAH_STARTS[s - 1] > g) s--;
  return [s, g - SURAH_STARTS[s - 1] + 1];
}
function lastStartAtOrBefore(starts, g) {
  let i = starts.length - 1;
  while (i > 0 && starts[i] > g) i--;
  return i + 1;
}
const pageOf = (s, a) => lastStartAtOrBefore(MUSHAF_PAGES, toGlobal(s, a));
const juzOf = (s, a) => lastStartAtOrBefore(JUZ_STARTS, toGlobal(s, a));
const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

let quranLoading = null;
function loadQuran() {
  if (quranReady()) return Promise.resolve();
  quranLoading = quranLoading || new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "quran-data.js";
    sc.onload = resolve;
    sc.onerror = () => { quranLoading = null; reject(); };
    document.head.appendChild(sc);
  });
  return quranLoading;
}
const quranReady = () => typeof QURAN_TEXT !== "undefined";

function mushafHash(page, sid, ses) {
  return `#/mushaf/${page}/${sid || "-"}/${ses || "-"}`;
}

// حالة كل كلمة في الصفحة لطالب معيّن: "s:a:i" للكلمات، و"s:a" للآية كاملة
function mushafMarks(sid) {
  const marks = new Map();
  if (!sid) return marks;
  for (const g of groupMistakes(studentMistakes(sid))) {
    const cls = g.resolved ? "m-ok" : g.repeated ? "m-rep" : "m-once";
    const words = quranReady() && QURAN_TEXT[g.surah - 1] ? (QURAN_TEXT[g.surah - 1][g.ayah - 1] || "").split(" ") : [];
    const target = normalizeWord(g.word);
    for (const m of g.items) {
      if (Number.isInteger(m.wordIndex)) marks.set(`${m.surah}:${m.ayah}:${m.wordIndex}`, cls);
      else if (!target) marks.set(`${m.surah}:${m.ayah}`, cls);
      // أخطاء مكتوبة يدوياً بلا رقم كلمة: تُطابق بالكلمة نفسها داخل الآية
      else words.forEach((w, i) => { if (normalizeWord(w) === target) marks.set(`${m.surah}:${m.ayah}:${i}`, cls); });
    }
  }
  return marks;
}

function pageMushaf(pageArg, sidArg, sesArg) {
  if (!quranReady()) {
    loadQuran().then(render, () => { view.innerHTML = `<div class="card empty">تعذّر تحميل المصحف، تأكد من الاتصال ثم أعد المحاولة</div>`; });
    return `<div class="card empty">جارٍ تحميل المصحف…</div>`;
  }
  // فتح تبويب المصحف مباشرة يعود إلى آخر صفحة وطالب
  if (!pageArg) {
    let last = {};
    try { last = JSON.parse(localStorage.getItem("halaqa-mushaf-last") || "{}"); } catch {}
    location.replace(mushafHash(last.page || 1, getStudent(last.sid) ? last.sid : ""));
    return "";
  }
  const ref = /^(\d+)-(\d+)$/.exec(pageArg || "");
  const page = ref ? pageOf(Math.min(114, Number(ref[1])) || 1, Number(ref[2]) || 1) : Math.min(604, Math.max(1, Number(pageArg) || 1));
  const sid = getStudent(sidArg) ? sidArg : "";
  const ses = sesArg && db.sessions.find((s) => s.id === sesArg && s.studentId === sid);
  const first = MUSHAF_PAGES[page - 1], last = page < 604 ? MUSHAF_PAGES[page] - 1 : 6236;
  const [s0, a0] = fromGlobal(first);
  try { localStorage.setItem("halaqa-mushaf-last", JSON.stringify({ page, sid })); } catch {}
  const marks = mushafMarks(sid);
  const basmala = QURAN_TEXT[0][0];
  const inRange = (s, a) => ses && s === ses.surah && a >= ses.fromAyah && a <= ses.toAyah;

  let html = "";
  for (let g = first; g <= last; g++) {
    const [s, a] = fromGlobal(g);
    if (a === 1) {
      html += `<div class="surah-head">سورة ${surahName(s)}</div>`;
      if (s !== 1 && s !== 9) html += `<div class="basmala">${basmala}</div>`;
    }
    const words = QURAN_TEXT[s - 1][a - 1].split(" ");
    html += `<span class="ayah ${inRange(s, a) ? "in-range" : ""}">` +
      words.map((w, i) => `<span class="w ${marks.get(`${s}:${a}:${i}`) || ""}" data-s="${s}" data-a="${a}" data-i="${i}">${w}</span>`).join(" ") +
      ` <span class="ayah-no ${marks.get(`${s}:${a}`) || ""}" data-s="${s}" data-a="${a}" title="الآية كاملة">﴿${toArabicDigits(a)}﴾</span></span> `;
  }

  const open = sid ? groupMistakes(studentMistakes(sid)).filter((x) => !x.resolved) : [];
  return `
    <div class="card mushaf-bar">
      <div class="grid2">
        <label style="margin:0"><span>الطالب</span>
          <select id="mushaf-student"><option value="">— اختر الطالب —</option>
            ${db.students.slice().sort((x, y) => x.name.localeCompare(y.name, "ar")).map((st) => `<option value="${st.id}" ${st.id === sid ? "selected" : ""}>${esc(st.name)}</option>`).join("")}
          </select></label>
        <label style="margin:0"><span>السورة</span><select id="mushaf-surah">${surahOptions(s0)}</select></label>
      </div>
      ${ses ? `<p class="small" style="margin:8px 0 0">تسميع ${fmtDate(ses.date)}: ${surahName(ses.surah)} ${ses.fromAyah}–${ses.toAyah} — الأخطاء تُضاف إلى هذا التسميع</p>` : ""}
    </div>
    <div class="row between mushaf-nav">
      <button class="btn sm" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>→ السابقة</button>
      <span class="small">الجزء ${juzOf(s0, a0)} · صفحة <input id="mushaf-page" type="number" min="1" max="604" value="${page}"></span>
      <button class="btn sm" data-page="${page + 1}" ${page >= 604 ? "disabled" : ""}>التالية ←</button>
    </div>
    <div class="mushaf-page ${sid ? "" : "no-student"}">${html}</div>
    <p class="small muted legend">
      ${sid ? `اضغط على الكلمة لتسجيل خطأ، أو على رقم الآية لخطأ في الآية كاملة.` : `اختر الطالب أولاً لتسجيل أخطائه على المصحف.`}<br>
      <span class="w m-once">خطأ مرة</span> <span class="w m-rep">متكرر</span> <span class="w m-ok">أُتقن</span>
      ${sid ? ` · لدى الطالب ${open.length} موضع غير متقن` : ""}
    </p>
    <p class="small muted">نص المصحف: موسوعة القرآن الكريم (QuranEnc)، وترقيم الصفحات وفق مصحف المدينة.</p>`;
}

function mushafWordDialog(sid, sesId, s, a, i) {
  const st = getStudent(sid);
  const ses = sesId && db.sessions.find((x) => x.id === sesId);
  const words = QURAN_TEXT[s - 1][a - 1].split(" ");
  const whole = i === null;
  const word = whole ? "" : words[i];
  const key = mistakeKey({ surah: s, ayah: a, word });
  const history = studentMistakes(sid).filter((m) => mistakeKey(m) === key).sort((x, y) => y.date.localeCompare(x.date));
  const resolved = history.length && history.every((m) => m.resolved);

  const form = openDialog(`
    <h2 class="row between"><span>${esc(st.name)}</span><span class="badge">${surahName(s)} · آية ${a}</span></h2>
    <div class="dlg-word">${whole ? `<span class="small muted">الآية كاملة</span><br>${QURAN_TEXT[s - 1][a - 1]}` : word}</div>
    ${history.length ? `<div class="card" style="margin:10px 0">
        <div class="row between"><b>سجل هذا الموضع</b>
          ${history.length > 1 ? `<span class="badge danger">تكرر ${timesAr(history.length)}</span>` : ""}
          ${resolved ? `<span class="badge ok">أُتقن ✓</span>` : ""}</div>
        <ul class="list small">${history.map((m) => `<li class="row between"><span>${fmtDate(m.date)} — ${esc(m.kind)}${m.note ? ` (${esc(m.note)})` : ""}</span>
          <button type="button" class="btn sm danger" data-del-id="${m.id}">حذف</button></li>`).join("")}</ul>
        <button type="button" class="btn sm" data-toggle-resolve>${resolved ? "إعادة فتح" : "تم الإتقان ✓"}</button>
      </div>` : ""}
    <label><span>التاريخ</span><input name="date" type="date" value="${ses ? ses.date : todayStr()}"></label>
    <label><span>ملاحظة (اختياري)</span><input name="note" placeholder="مثال: قرأها بالفتح"></label>
    <p class="small muted" style="margin:0 0 6px">اختر نوع الخطأ ليُسجَّل مباشرة:</p>
    <div class="kind-grid">${MISTAKE_KINDS.map((k) => `<button type="button" class="btn" data-kind="${k}">${k}</button>`).join("")}</div>
    <div class="dlg-actions"><button type="button" class="btn" data-close>إغلاق</button></div>`, () => false, (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.kind) {
      db.mistakes.push({
        id: uid(), studentId: sid, sessionId: ses ? ses.id : null,
        date: $("[name=date]", form).value || todayStr(), surah: s, ayah: a, word, wordIndex: whole ? undefined : i,
        kind: b.dataset.kind, note: $("[name=note]", form).value.trim(), resolved: false
      });
      // خطأ جديد في موضع سبق إتقانه يعيد فتحه
      history.forEach((m) => (m.resolved = false));
      save(); dlg.close(); render();
      const n = history.length + 1;
      toast(`سُجّل: ${b.dataset.kind}${n > 1 ? ` — تكرر ${timesAr(n)}` : ""}`);
    } else if (b.dataset.delId) {
      db.mistakes = db.mistakes.filter((m) => m.id !== b.dataset.delId);
      save(); dlg.close(); render(); toast("تم الحذف");
    } else if ("toggleResolve" in b.dataset) {
      history.forEach((m) => (m.resolved = !resolved));
      save(); dlg.close(); render(); toast(resolved ? "أُعيد فتح الخطأ" : "أحسنت! تم تعليمه كمُتقَن");
    }
  });
}

/* ============ التوجيه والأحداث ============ */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: parts[0] || "home", id: parts[1], tab: parts[2], extra: parts[3] };
}

function render() {
  const r = parseRoute();
  $("#brand-name").textContent = db.settings.halaqaName || "دفتر الحلقة";
  const pages = { home: pageHome, students: pageStudents, mistakes: pageMistakes, reminders: pageReminders, settings: pageSettings };
  view.innerHTML = r.page === "student" ? pageStudent(r.id, r.tab)
    : r.page === "mushaf" ? pageMushaf(r.id, r.tab, r.extra)
    : (pages[r.page] || pageHome)();
  const navKey = r.page === "student" ? "students" : r.page;
  $$(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.nav === navKey));
}

view.addEventListener("click", (e) => {
  const word = e.target.closest(".mushaf-page .w, .mushaf-page .ayah-no");
  if (word) {
    const r = parseRoute();
    if (!getStudent(r.tab)) return toast("اختر الطالب أولاً من أعلى الصفحة");
    const i = word.classList.contains("ayah-no") ? null : Number(word.dataset.i);
    return mushafWordDialog(r.tab, r.extra !== "-" ? r.extra : "", Number(word.dataset.s), Number(word.dataset.a), i);
  }
  const t = e.target.closest("button, [data-action]");
  if (!t) return;
  const r = parseRoute();
  const st = r.page === "student" ? getStudent(r.id) : null;
  const d = t.dataset;

  if (d.remind) return reminderDialog(getStudent(d.remind));
  if (d.page) { location.hash = mushafHash(d.page, r.tab !== "-" ? r.tab : "", r.extra !== "-" ? r.extra : ""); return; }
  if (d.tab) { location.hash = `#/student/${r.id}/${d.tab}`; return; }
  if (d.mfilter) { pageStudent.filter = d.mfilter; return render(); }
  if (d.editSession) return sessionForm(r.id, db.sessions.find((s) => s.id === d.editSession));
  if (d.delSession) {
    if (!confirm("حذف هذا التسميع وأخطائه؟")) return;
    db.sessions = db.sessions.filter((s) => s.id !== d.delSession);
    db.mistakes = db.mistakes.filter((m) => m.sessionId !== d.delSession);
    save(); return render();
  }
  if (d.resolve) {
    const items = db.mistakes.filter((m) => m.studentId === d.sid && mistakeKey(m) === d.resolve);
    const val = !items.every((m) => m.resolved);
    items.forEach((m) => (m.resolved = val));
    save(); render(); return toast(val ? "أحسنت! تم تعليمه كمُتقَن" : "أُعيد فتح الخطأ");
  }
  if (d.delMistake) {
    if (!confirm("حذف آخر تسجيل لهذا الخطأ؟")) return;
    db.mistakes = db.mistakes.filter((m) => m.id !== d.delMistake);
    save(); return render();
  }

  switch (d.action) {
    case "add-student": return studentForm();
    case "edit-student": return studentForm(st);
    case "delete-student":
      if (!confirm(`حذف الطالب ${st.name} وجميع سجلاته؟`)) return;
      db.students = db.students.filter((s) => s.id !== st.id);
      db.sessions = db.sessions.filter((s) => s.studentId !== st.id);
      db.mistakes = db.mistakes.filter((m) => m.studentId !== st.id);
      save(); location.hash = "#/students"; return;
    case "new-session": return sessionForm(r.id);
    case "quick-mistake": return quickMistakeForm(r.id);
    case "reset-template":
      $("[name=template]").value = DEFAULT_TEMPLATE; return;
    case "export": {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `halaqa-backup-${todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
  }
});

view.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    pageStudents.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $("#search"); s.focus(); s.setSelectionRange(pos, pos);
  }
});

view.addEventListener("submit", (e) => {
  if (e.target.id !== "settings-form") return;
  e.preventDefault();
  const fd = new FormData(e.target);
  Object.assign(db.settings, {
    halaqaName: fd.get("halaqaName").trim(), teacherName: fd.get("teacherName").trim(),
    countryCode: fd.get("countryCode").replace(/\D/g, ""), template: fd.get("template"),
    repeatThreshold: Number(fd.get("repeatThreshold"))
  });
  save(); render(); toast("تم حفظ الإعدادات");
});

view.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "mushaf-student" || id === "mushaf-surah" || id === "mushaf-page") {
    const r = parseRoute();
    const sid = $("#mushaf-student").value;
    const page = id === "mushaf-surah" ? `${e.target.value}-1` : id === "mushaf-page" ? e.target.value : r.id;
    // تغيير الطالب يلغي ربط الأخطاء بتسميع الطالب السابق
    location.hash = mushafHash(page, sid, sid === r.tab && r.extra !== "-" ? r.extra : "");
    return;
  }
  if (id !== "import-file" || !e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.students)) throw new Error("bad file");
      if (!confirm("سيتم استبدال البيانات الحالية بالنسخة المستوردة. متابعة؟")) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      db = load(); render(); toast("تم الاستيراد");
    } catch { toast("الملف غير صالح"); }
  };
  reader.readAsText(e.target.files[0]);
});

window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
