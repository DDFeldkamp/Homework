const DATA_URL = "./data/gradescope.json";
const MANUAL_KEY = "deadline-dashboard-manual-v1";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

let gradescopeAssignments = [];
let manualAssignments = loadManual();
let filter = "upcoming";
let query = "";

const list = document.querySelector("#assignmentList");
const template = document.querySelector("#assignmentTemplate");
const dialog = document.querySelector("#assignmentDialog");
const form = document.querySelector("#assignmentForm");

function loadManual() {
  try { return JSON.parse(localStorage.getItem(MANUAL_KEY)) || []; }
  catch { return []; }
}
function saveManual() { localStorage.setItem(MANUAL_KEY, JSON.stringify(manualAssignments)); }

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d) return "No deadline";
  return new Intl.DateTimeFormat(undefined, {
    weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"
  }).format(d);
}

function remainingText(target) {
  if (!target) return "";
  const diff = target - new Date();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const chunk = days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${Math.max(0, mins)}m`;
  return diff >= 0 ? `${chunk} left` : `${chunk} overdue`;
}

function expandManual(items) {
  const output = [];
  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + 6);

  for (const item of items) {
    output.push({...item});
    if (!item.recurrence || item.recurrence === "none") continue;

    const due = parseDate(item.due);
    const late = parseDate(item.late_due);
    const until = item.repeat_until ? new Date(item.repeat_until + "T23:59:59") : horizon;
    let nextDue = new Date(due);
    let nextLate = late ? new Date(late) : null;
    let i = 1;

    while (i < 100) {
      if (item.recurrence === "daily") {
        nextDue.setDate(nextDue.getDate()+1); if (nextLate) nextLate.setDate(nextLate.getDate()+1);
      } else if (item.recurrence === "weekly") {
        nextDue.setDate(nextDue.getDate()+7); if (nextLate) nextLate.setDate(nextLate.getDate()+7);
      } else if (item.recurrence === "biweekly") {
        nextDue.setDate(nextDue.getDate()+14); if (nextLate) nextLate.setDate(nextLate.getDate()+14);
      } else if (item.recurrence === "monthly") {
        nextDue.setMonth(nextDue.getMonth()+1); if (nextLate) nextLate.setMonth(nextLate.getMonth()+1);
      }
      if (nextDue > until || nextDue > horizon) break;
      output.push({
        ...item,
        id: `${item.id}:${i}`,
        parent_id: item.id,
        due: nextDue.toISOString(),
        late_due: nextLate ? nextLate.toISOString() : null,
        completed: false
      });
      i++;
    }
  }
  return output;
}

function allAssignments() {
  return [...gradescopeAssignments, ...expandManual(manualAssignments)]
    .map(a => ({...a, dueDate:parseDate(a.due), lateDate:parseDate(a.late_due)}));
}

function render() {
  const now = new Date();
  const all = allAssignments();
  const visible = all
    .filter(a => {
      const text = `${a.title || ""} ${a.course || ""}`.toLowerCase();
      if (query && !text.includes(query)) return false;
      if (filter === "done") return !!a.completed;
      if (filter === "upcoming") return !a.completed && (!a.lateDate || a.lateDate >= now) && (!a.dueDate || a.dueDate >= now || (a.lateDate && a.lateDate >= now));
      return true;
    })
    .sort((a,b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));

  list.innerHTML = "";
  if (!visible.length) {
    list.innerHTML = `<div class="empty">Nothing here. Add a manual assignment or wait for the next Gradescope sync.</div>`;
  }

  visible.forEach(a => {
    const node = template.content.firstElementChild.cloneNode(true);
    const now = new Date();
    const deadline = a.dueDate;
    const inLate = deadline && deadline < now && a.lateDate && a.lateDate >= now;
    const activeTarget = inLate ? a.lateDate : deadline;
    const remaining = activeTarget ? activeTarget - now : null;
    const width = remaining == null ? 0 : Math.max(0, Math.min(100, remaining / WINDOW_MS * 100));

    node.classList.toggle("done", !!a.completed);
    node.classList.toggle("urgent", !a.completed && !inLate && remaining != null && remaining < 24*3600000 && remaining >= 0);
    node.classList.toggle("late-window", !!inLate);
    node.querySelector(".title").textContent = a.title || "Untitled";
    node.querySelector(".course-pill").textContent = a.course || "Manual";
    node.querySelector(".source-pill").textContent = a.source === "gradescope" ? "Gradescope" : (a.recurrence && a.recurrence !== "none" ? `Manual · ${a.recurrence}` : "Manual");
    node.querySelector(".remaining").textContent = a.completed ? "Completed" : (inLate ? `Late window · ${remainingText(a.lateDate)}` : remainingText(deadline));
    node.querySelector(".due").textContent = deadline ? `Due ${fmtDate(deadline)}` : "";
    node.querySelector(".bar-fill").style.width = a.completed ? "100%" : `${width}%`;

    const lateEl = node.querySelector(".late");
    lateEl.textContent = a.lateDate ? `Late deadline: ${fmtDate(a.lateDate)}` : "No late deadline";
    lateEl.classList.toggle("active", !!inLate);

    const link = node.querySelector(".open-link");
    if (a.url) link.href = a.url; else link.remove();

    const del = node.querySelector(".more-btn");
    if (a.source === "gradescope") del.remove();
    else del.addEventListener("click", () => {
      const base = a.parent_id || a.id;
      manualAssignments = manualAssignments.filter(x => x.id !== base);
      saveManual(); render();
    });

    node.querySelector(".check").addEventListener("click", () => {
      if (a.source === "gradescope") return; // sync is authoritative for Gradescope
      const base = a.parent_id || a.id;
      const item = manualAssignments.find(x => x.id === base);
      if (item) {
        item.completed = !item.completed;
        saveManual();
        render();
      }
    });

    list.appendChild(node);
  });

  const notDone = all.filter(a => !a.completed);
  document.querySelector("#count24").textContent = notDone.filter(a => a.dueDate && a.dueDate >= now && a.dueDate-now <= 86400000).length;
  document.querySelector("#count7").textContent = notDone.filter(a => a.dueDate && a.dueDate >= now && a.dueDate-now <= WINDOW_MS).length;
  document.querySelector("#countUpcoming").textContent = notDone.filter(a => !a.dueDate || a.dueDate >= now || (a.lateDate && a.lateDate >= now)).length;
  document.querySelector("#countDone").textContent = all.filter(a => a.completed).length;
}

async function loadGradescope() {
  const status = document.querySelector("#syncStatus");
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, {cache:"no-store"});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    gradescopeAssignments = data.assignments || [];
    status.textContent = data.synced_at
      ? `Gradescope last synced ${new Date(data.synced_at).toLocaleString()}`
      : "Gradescope sync has not run yet.";
  } catch (err) {
    gradescopeAssignments = [];
    status.textContent = "Could not load Gradescope data. Manual assignments still work.";
  }
  render();
}

document.querySelector("#addBtn").addEventListener("click", () => dialog.showModal());
document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => dialog.close());
document.querySelector("#refreshBtn").addEventListener("click", loadGradescope);

document.querySelector("#searchInput").addEventListener("input", e => {
  query = e.target.value.trim().toLowerCase(); render();
});
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
  filter = tab.dataset.filter;
  render();
}));

form.addEventListener("submit", e => {
  e.preventDefault();
  const fd = new FormData(form);
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    source:"manual",
    title:fd.get("title").trim(),
    course:fd.get("course").trim() || "Manual",
    due:new Date(fd.get("due")).toISOString(),
    late_due:fd.get("late_due") ? new Date(fd.get("late_due")).toISOString() : null,
    recurrence:fd.get("recurrence"),
    repeat_until:fd.get("repeat_until") || null,
    completed:false
  };
  manualAssignments.push(item);
  saveManual();
  form.reset();
  dialog.close();
  render();
});

loadGradescope();
setInterval(render, 60_000);
