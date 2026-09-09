const MANUAL_KEY = "deadline-dashboard-manual-v2";
const THEME_KEY = "deadline-theme";
const TIMELINE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMELINE_MS = TIMELINE_DAYS * DAY_MS;

let gradescopeAssignments = [];
let manualAssignments = loadManual();
let filter = "upcoming";
let query = "";

const list = document.querySelector("#assignmentList");
const assignmentDialog = document.querySelector("#assignmentDialog");
const assignmentForm = document.querySelector("#assignmentForm");

function loadManual() {
  try {
    return JSON.parse(localStorage.getItem(MANUAL_KEY)) || [];
  } catch {
    return [];
  }
}

function saveManual() {
  localStorage.setItem(MANUAL_KEY, JSON.stringify(manualAssignments));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a, b) {
  return Boolean(
    a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtDate(date) {
  if (!date) return "No deadline";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function remainingText(target) {
  if (!target) return "No deadline";
  const diff = target - new Date();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / DAY_MS);
  const hours = Math.floor((abs % DAY_MS) / (60 * 60 * 1000));
  const mins = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  const chunk = days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${Math.max(0, mins)}m`;
  return diff >= 0 ? `${chunk} left` : `${chunk} overdue`;
}

function updateCurrentDate() {
  const now = new Date();
  document.querySelector("#currentDate").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

function expandManual(items) {
  const output = [];
  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + 6);

  for (const item of items) {
    output.push({ ...item });
    if (!item.recurrence || item.recurrence === "none") continue;

    const due = parseDate(item.due);
    const late = parseDate(item.late_due);
    if (!due) continue;

    const until = item.repeat_until
      ? new Date(`${item.repeat_until}T23:59:59`)
      : horizon;

    let nextDue = new Date(due);
    let nextLate = late ? new Date(late) : null;
    let i = 1;

    while (i < 100) {
      if (item.recurrence === "daily") {
        nextDue.setDate(nextDue.getDate() + 1);
        if (nextLate) nextLate.setDate(nextLate.getDate() + 1);
      } else if (item.recurrence === "weekly") {
        nextDue.setDate(nextDue.getDate() + 7);
        if (nextLate) nextLate.setDate(nextLate.getDate() + 7);
      } else if (item.recurrence === "biweekly") {
        nextDue.setDate(nextDue.getDate() + 14);
        if (nextLate) nextLate.setDate(nextLate.getDate() + 14);
      } else if (item.recurrence === "monthly") {
        nextDue.setMonth(nextDue.getMonth() + 1);
        if (nextLate) nextLate.setMonth(nextLate.getMonth() + 1);
      }

      if (nextDue > until || nextDue > horizon) break;

      output.push({
        ...item,
        id: `${item.id}:${i}`,
        parent_id: item.id,
        due: nextDue.toISOString(),
        late_due: nextLate ? nextLate.toISOString() : null,
        completed: false,
      });
      i += 1;
    }
  }

  return output;
}

function allAssignments() {
  return [...gradescopeAssignments, ...expandManual(manualAssignments)].map((a) => ({
    ...a,
    dueDate: parseDate(a.due),
    lateDate: parseDate(a.late_due),
  }));
}

function courseColorIndex(course) {
  let hash = 0;
  for (const char of String(course || "Manual")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 6;
}

function pctWithinTimeline(date, start, end) {
  if (!date) return null;
  return ((date - start) / (end - start)) * 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeAxis(start) {
  const axis = document.createElement("div");
  axis.className = "date-axis";
  const today = new Date();

  for (let i = 0; i < TIMELINE_DAYS; i += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);

    const cell = document.createElement("div");
    cell.className = `axis-day${isSameDay(date, today) ? " today" : ""}`;

    const weekday = document.createElement("span");
    weekday.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);

    const dateText = document.createElement("strong");
    dateText.textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);

    cell.append(weekday, dateText);
    axis.appendChild(cell);
  }

  return axis;
}

function makeCourseHeader(course, count, start, nowPct) {
  const header = document.createElement("div");
  header.className = "timeline-header";

  const label = document.createElement("div");
  label.className = "assignment-label";
  label.textContent = `${count} assignment${count === 1 ? "" : "s"}`;

  const grid = document.createElement("div");
  grid.className = "timeline-grid";
  grid.appendChild(makeAxis(start));

  const nowLine = document.createElement("div");
  nowLine.className = "now-line";
  nowLine.style.left = `${clamp(nowPct, 0, 100)}%`;
  grid.appendChild(nowLine);

  header.append(label, grid);
  return header;
}

function assignmentVisible(a, now) {
  const haystack = `${a.title || ""} ${a.course || ""}`.toLowerCase();
  if (query && !haystack.includes(query)) return false;

  if (filter === "done") return Boolean(a.completed);
  if (filter === "all") return true;

  if (a.completed) return false;
  if (!a.dueDate) return true;
  if (a.dueDate >= now) return true;
  return Boolean(a.lateDate && a.lateDate >= now);
}

function makeAssignmentRow(a, start, end, nowPct, colorIndex) {
  const now = new Date();
  const row = document.createElement("div");
  row.className = "timeline-row";

  const inLateWindow = Boolean(a.dueDate && a.dueDate < now && a.lateDate && a.lateDate >= now);
  const activeDeadline = inLateWindow ? a.lateDate : a.dueDate;
  const remaining = activeDeadline ? activeDeadline - now : null;

  row.classList.toggle("done", Boolean(a.completed));
  row.classList.toggle("urgent", Boolean(!a.completed && remaining !== null && remaining >= 0 && remaining <= DAY_MS));

  const label = document.createElement("div");
  label.className = "assignment-label";

  const check = document.createElement("button");
  check.type = "button";
  check.className = "assignment-check";

  if (a.source === "gradescope") {
    check.title = "Gradescope completion is detected automatically";
    check.setAttribute("aria-label", "Gradescope completion is detected automatically");
  } else {
    check.setAttribute("aria-label", a.completed ? "Mark incomplete" : "Mark complete");
    check.addEventListener("click", () => {
      const baseId = a.parent_id || a.id;
      const item = manualAssignments.find((x) => x.id === baseId);
      if (item) {
        item.completed = !item.completed;
        saveManual();
        render();
      }
    });
  }

  const text = document.createElement("div");
  text.className = "assignment-text";

  const titleRow = document.createElement("div");
  titleRow.className = "assignment-title-row";

  let title;
  if (a.url) {
    title = document.createElement("a");
    title.href = a.url;
    title.target = "_blank";
    title.rel = "noreferrer";
    title.className = "assignment-title assignment-link";
  } else {
    title = document.createElement("span");
    title.className = "assignment-title";
  }
  title.textContent = a.title || "Untitled";
  titleRow.appendChild(title);

  if (a.source !== "gradescope") {
    const tag = document.createElement("span");
    tag.className = "manual-tag";
    tag.textContent = a.recurrence && a.recurrence !== "none" ? a.recurrence : "manual";
    titleRow.appendChild(tag);
  }

  const meta = document.createElement("div");
  meta.className = "assignment-meta";
  const dueText = a.dueDate ? `Due ${fmtDate(a.dueDate)} · ${remainingText(a.dueDate)}` : "No deadline";
  meta.append(document.createTextNode(dueText));
  if (a.lateDate) {
    const late = document.createElement("span");
    late.className = "late-text";
    late.textContent = ` · Late ${fmtDate(a.lateDate)}`;
    meta.appendChild(late);
  }

  text.append(titleRow, meta);
  label.append(check, text);

  if (a.source !== "gradescope") {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-assignment";
    del.textContent = "×";
    del.title = "Delete manual assignment";
    del.setAttribute("aria-label", "Delete manual assignment");
    del.addEventListener("click", () => {
      const baseId = a.parent_id || a.id;
      manualAssignments = manualAssignments.filter((x) => x.id !== baseId);
      saveManual();
      render();
    });
    label.appendChild(del);
  }

  const cell = document.createElement("div");
  cell.className = "timeline-cell timeline-grid";

  const nowLine = document.createElement("div");
  nowLine.className = "now-line";
  nowLine.style.left = `${clamp(nowPct, 0, 100)}%`;
  cell.appendChild(nowLine);

  if (a.dueDate) {
    const dueRaw = pctWithinTimeline(a.dueDate, start, end);
    const duePct = clamp(dueRaw, 0, 100);
    const leftPct = clamp(nowPct, 0, 100);

    const bar = document.createElement("div");
    bar.className = `timeline-bar color-${colorIndex}`;

    if (a.completed && dueRaw < 0) {
      bar.style.left = "0%";
      bar.style.width = "2px";
    } else if (dueRaw <= leftPct) {
      bar.style.left = `${leftPct}%`;
      bar.style.width = "2px";
    } else {
      bar.style.left = `${leftPct}%`;
      bar.style.width = `${Math.max(0.3, duePct - leftPct)}%`;
    }

    const barLabel = document.createElement("span");
    barLabel.className = "timeline-bar-label";
    barLabel.textContent = inLateWindow ? "late window" : (a.completed ? "done" : remainingText(a.dueDate));
    bar.appendChild(barLabel);
    cell.appendChild(bar);

    const dueMarker = document.createElement("div");
    dueMarker.className = "due-marker";
    dueMarker.style.left = `${duePct}%`;
    cell.appendChild(dueMarker);

    const caption = document.createElement("div");
    caption.className = "due-caption";
    caption.style.left = `${duePct}%`;
    caption.textContent = dueRaw > 100 ? "after this week →" : dueRaw < 0 ? "past due" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(a.dueDate);
    cell.appendChild(caption);

    if (a.lateDate && a.lateDate > a.dueDate) {
      const lateRaw = pctWithinTimeline(a.lateDate, start, end);
      const lateStart = clamp(Math.max(dueRaw, nowPct), 0, 100);
      const lateEnd = clamp(lateRaw, 0, 100);
      if (lateEnd > lateStart) {
        const lateBar = document.createElement("div");
        lateBar.className = "timeline-late";
        lateBar.style.left = `${lateStart}%`;
        lateBar.style.width = `${Math.max(0.3, lateEnd - lateStart)}%`;
        lateBar.title = `Late deadline: ${fmtDate(a.lateDate)}`;
        cell.appendChild(lateBar);
      }
    }

    if (dueRaw > 100) {
      const outside = document.createElement("div");
      outside.className = "outside-range";
      outside.textContent = fmtDate(a.dueDate);
      cell.appendChild(outside);
    }
  } else {
    const outside = document.createElement("div");
    outside.className = "outside-range";
    outside.textContent = "No due date";
    cell.appendChild(outside);
  }

  row.append(label, cell);
  return row;
}

function render() {
  const now = new Date();
  const start = startOfToday();
  const end = new Date(start.getTime() + TIMELINE_MS);
  const nowPct = pctWithinTimeline(now, start, end);

  const all = allAssignments();
  const visible = all
    .filter((a) => assignmentVisible(a, now))
    .sort((a, b) => {
      const courseCmp = String(a.course || "Manual").localeCompare(String(b.course || "Manual"));
      if (courseCmp !== 0) return courseCmp;
      return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
    });

  list.innerHTML = "";

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No assignments in this view.";
    list.appendChild(empty);
  } else {
    const grouped = new Map();
    for (const assignment of visible) {
      const course = assignment.course || "Manual";
      if (!grouped.has(course)) grouped.set(course, []);
      grouped.get(course).push(assignment);
    }

    for (const [course, assignments] of grouped) {
      const section = document.createElement("section");
      section.className = "course-section";

      const heading = document.createElement("h2");
      heading.className = "course-heading";
      heading.append(document.createTextNode(course));
      const count = document.createElement("span");
      count.className = "course-count";
      count.textContent = `${assignments.length}`;
      heading.appendChild(count);
      section.appendChild(heading);

      const scroll = document.createElement("div");
      scroll.className = "timeline-scroll";
      const scrollInner = document.createElement("div");
      scrollInner.className = "timeline-scroll-inner";
      const wrap = document.createElement("div");
      wrap.className = "timeline-wrap";

      wrap.appendChild(makeCourseHeader(course, assignments.length, start, nowPct));
      const colorIndex = courseColorIndex(course);
      for (const assignment of assignments) {
        wrap.appendChild(makeAssignmentRow(assignment, start, end, nowPct, colorIndex));
      }

      scrollInner.appendChild(wrap);
      scroll.appendChild(scrollInner);
      section.appendChild(scroll);
      list.appendChild(section);
    }
  }

  const notDone = all.filter((a) => !a.completed);
  document.querySelector("#countToday").textContent = notDone.filter((a) => a.dueDate && isSameDay(a.dueDate, now)).length;
  document.querySelector("#count7").textContent = notDone.filter((a) => a.dueDate && a.dueDate >= now && a.dueDate - now <= TIMELINE_MS).length;
  document.querySelector("#countUpcoming").textContent = notDone.filter((a) => !a.dueDate || a.dueDate >= now || (a.lateDate && a.lateDate >= now)).length;
  document.querySelector("#countDone").textContent = all.filter((a) => a.completed).length;
}

async function loadGradescope() {
  const status = document.querySelector("#syncStatus");
  status.textContent = "Loading Gradescope…";

  try {
    const response = await fetch(`./data/gradescope.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    gradescopeAssignments = Array.isArray(data.assignments) ? data.assignments : [];

    if (data.synced_at) {
      const synced = new Date(data.synced_at).toLocaleString();
      const term = data.term ? ` · ${data.term}` : "";
      status.textContent = `Gradescope synced ${synced}${term} · ${data.course_count ?? "?"} student courses`;
    } else {
      status.textContent = "Gradescope has not synced yet";
    }
  } catch (error) {
    gradescopeAssignments = [];
    status.textContent = "Could not load Gradescope data · manual assignments still work";
    console.error(error);
  }

  render();
}

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  document.querySelector("#themeBtn").textContent = dark ? "☀" : "☾";
  document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#15181b" : "#ffffff");
}

document.querySelector("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  updateThemeButton();
});

document.querySelector("#addBtn").addEventListener("click", () => assignmentDialog.showModal());
document.querySelector("#closeDialog").addEventListener("click", () => assignmentDialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => assignmentDialog.close());
document.querySelector("#searchInput").addEventListener("input", (event) => {
  query = event.target.value.trim().toLowerCase();
  render();
});

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
  tab.classList.add("active");
  filter = tab.dataset.filter;
  render();
}));

assignmentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fd = new FormData(assignmentForm);
  const dueValue = fd.get("due");
  const lateValue = fd.get("late_due");

  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    source: "manual",
    title: String(fd.get("title") || "").trim(),
    course: String(fd.get("course") || "").trim() || "Manual",
    due: new Date(dueValue).toISOString(),
    late_due: lateValue ? new Date(lateValue).toISOString() : null,
    recurrence: fd.get("recurrence"),
    repeat_until: fd.get("repeat_until") || null,
    completed: false,
  };

  manualAssignments.push(item);
  saveManual();
  assignmentForm.reset();
  assignmentDialog.close();
  render();
});

updateCurrentDate();
updateThemeButton();
render();
loadGradescope();
setInterval(() => {
  updateCurrentDate();
  render();
}, 60_000);
