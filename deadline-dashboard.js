const MANUAL_KEY = "deadline-dashboard-manual-v2";
const THEME_KEY = "deadline-theme";
const COURSE_REGISTRY_KEY = "deadline-course-registry-v1";
const DEFAULT_COURSES_KEY = "deadline-default-courses-v1";
const DEFAULTS_CONFIGURED_KEY = "deadline-default-courses-configured-v1";
const ACTIVE_COURSES_KEY = "deadline-active-courses-v1";
const COURSE_LIMITS_KEY = "deadline-course-assignment-limits-v1";
const COURSE_MERGES_KEY = "deadline-course-merges-v1";
const MERGED_NAME_SOURCE_KEY = "deadline-merged-course-name-source-v1";
const DEFAULT_COURSE_LIMIT_KEY = "deadline-default-course-assignment-limit-v1";
const VIEW_MODE_KEY = "deadline-calendar-view-v1";
const TIMELINE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMELINE_MS = TIMELINE_DAYS * DAY_MS;

let gradescopeAssignments = [];
let bcoursesAssignments = [];
let manualAssignments = loadManual();
let courseRegistry = loadCourseRegistry();
let defaultCourses = new Set(loadStringArray(localStorage, DEFAULT_COURSES_KEY));
let defaultsConfigured = localStorage.getItem(DEFAULTS_CONFIGURED_KEY) === "1";
let activeCourses = null;
let activeCoursesInitialized = false;
let courseAssignmentLimits = loadCourseLimits();
let courseMerges = loadCourseMerges();
let mergedNameSource = localStorage.getItem(MERGED_NAME_SOURCE_KEY) === "gradescope" ? "gradescope" : "bcourses";
let defaultCourseLimit = localStorage.getItem(DEFAULT_COURSE_LIMIT_KEY) || "all";
let viewMode = localStorage.getItem(VIEW_MODE_KEY) === "combined" ? "combined" : "course";
let filter = "upcoming";
let query = "";

const list = document.querySelector("#assignmentList");
const assignmentDialog = document.querySelector("#assignmentDialog");
const assignmentForm = document.querySelector("#assignmentForm");
const coursesDialog = document.querySelector("#coursesDialog");
const courseOptions = document.querySelector("#courseOptions");
const courseMergeOptions = document.querySelector("#courseMergeOptions");
const mergedNameSourceSelect = document.querySelector("#mergedNameSource");
const allCourseLimitSelect = document.querySelector("#allCourseLimit");

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

function loadStringArray(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function loadCourseRegistry() {
  try {
    const value = JSON.parse(localStorage.getItem(COURSE_REGISTRY_KEY));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadCourseLimits() {
  try {
    const value = JSON.parse(localStorage.getItem(COURSE_LIMITS_KEY));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function saveCourseLimits() {
  localStorage.setItem(COURSE_LIMITS_KEY, JSON.stringify(courseAssignmentLimits));
}

function loadCourseMerges() {
  try {
    const value = JSON.parse(localStorage.getItem(COURSE_MERGES_KEY));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const clean = {};
    for (const [bcourse, gradescope] of Object.entries(value)) {
      if (typeof bcourse === "string" && typeof gradescope === "string" && bcourse && gradescope) {
        clean[bcourse] = gradescope;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function saveCourseMerges() {
  localStorage.setItem(COURSE_MERGES_KEY, JSON.stringify(courseMerges));
}

function sourceCourseNames(assignments) {
  return [...new Set(
    assignments
      .map((assignment) => String(assignment.course || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function canonicalCourseName(assignment) {
  const original = String(assignment.course || "Manual").trim() || "Manual";

  if (assignment.source === "gradescope") {
    for (const [bcoursesName, gradescopeName] of Object.entries(courseMerges)) {
      if (gradescopeName === original) {
        return mergedNameSource === "gradescope" ? gradescopeName : bcoursesName;
      }
    }
  }

  if (assignment.source === "bcourses" && courseMerges[original]) {
    return mergedNameSource === "gradescope" ? courseMerges[original] : original;
  }

  return original;
}

function migrateCoursePreferences(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;

  if (activeCourses?.has(oldName)) activeCourses.add(newName);
  activeCourses?.delete(oldName);

  if (defaultCourses.has(oldName)) defaultCourses.add(newName);
  defaultCourses.delete(oldName);

  if (courseAssignmentLimits[newName] === undefined && courseAssignmentLimits[oldName] !== undefined) {
    courseAssignmentLimits[newName] = courseAssignmentLimits[oldName];
  }

  saveActiveCourses();
  if (defaultsConfigured) saveDefaults();
  saveCourseLimits();
}

function getCourseLimit(courseName) {
  const raw = courseAssignmentLimits[courseName] ?? defaultCourseLimit;
  if (raw === "all" || raw === undefined || raw === null) return Infinity;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
}

function canonicalNameForMerge(bcoursesName, gradescopeName, source = mergedNameSource) {
  return source === "gradescope" ? gradescopeName : bcoursesName;
}

function changeMergedNameSource(nextSource) {
  const normalized = nextSource === "gradescope" ? "gradescope" : "bcourses";
  if (normalized === mergedNameSource) return;

  const previousSource = mergedNameSource;
  for (const [bcoursesName, gradescopeName] of Object.entries(courseMerges)) {
    migrateCoursePreferences(
      canonicalNameForMerge(bcoursesName, gradescopeName, previousSource),
      canonicalNameForMerge(bcoursesName, gradescopeName, normalized)
    );
  }

  mergedNameSource = normalized;
  localStorage.setItem(MERGED_NAME_SOURCE_KEY, mergedNameSource);
  reconcileCourseRegistry();
  renderCourseOptions();
  render();
}

function applyLimitToAllCourses(value) {
  const normalized = ["all", "1", "2", "3", "5", "10", "15"].includes(String(value))
    ? String(value)
    : "all";

  defaultCourseLimit = normalized;
  localStorage.setItem(DEFAULT_COURSE_LIMIT_KEY, defaultCourseLimit);

  // Apply this choice to every known course now. Newly discovered courses use
  // the same value through defaultCourseLimit until individually overridden.
  for (const course of courseRegistry) {
    courseAssignmentLimits[course.name] = normalized;
  }
  saveCourseLimits();
  renderCourseOptions();
  render();
}

function setViewMode(nextMode) {
  viewMode = nextMode === "combined" ? "combined" : "course";
  localStorage.setItem(VIEW_MODE_KEY, viewMode);
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewMode);
  });
  render();
}

function saveActiveCourses() {
  if (!activeCourses) return;
  sessionStorage.setItem(ACTIVE_COURSES_KEY, JSON.stringify([...activeCourses]));
}

function saveDefaults() {
  localStorage.setItem(DEFAULT_COURSES_KEY, JSON.stringify([...defaultCourses]));
  localStorage.setItem(DEFAULTS_CONFIGURED_KEY, "1");
  defaultsConfigured = true;
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

function fmtTime(date) {
  if (!date) return "No time";
  return new Intl.DateTimeFormat(undefined, {
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

function sourceAssignments() {
  return [
    ...gradescopeAssignments,
    ...bcoursesAssignments,
    ...expandManual(manualAssignments),
  ];
}

function rawAssignments() {
  return sourceAssignments().map((assignment) => ({
    ...assignment,
    original_course: assignment.original_course || assignment.course || "Manual",
    course: canonicalCourseName(assignment),
  }));
}

function allAssignments() {
  return rawAssignments().map((a) => ({
    ...a,
    dueDate: parseDate(a.due),
    lateDate: parseDate(a.late_due),
  }));
}

function sourceLabel(source) {
  if (source === "gradescope") return "Gradescope";
  if (source === "bcourses") return "bCourses";
  return "Manual";
}

function reconcileCourseRegistry() {
  const current = new Map();
  for (const assignment of rawAssignments()) {
    const name = String(assignment.course || "Manual").trim() || "Manual";
    if (!current.has(name)) current.set(name, { name, sources: [] });
    const entry = current.get(name);
    const label = sourceLabel(assignment.source);
    if (!entry.sources.includes(label)) entry.sources.push(label);
  }

  // Keep previously discovered classes, except for the non-canonical alias of
  // a paired bCourses/Gradescope course.
  const mergedAliases = new Set();
  const canonicalMergedNames = new Set();
  for (const [bcoursesName, gradescopeName] of Object.entries(courseMerges)) {
    mergedAliases.add(bcoursesName);
    mergedAliases.add(gradescopeName);
    canonicalMergedNames.add(canonicalNameForMerge(bcoursesName, gradescopeName));
  }
  for (const item of courseRegistry) {
    if (!item || typeof item.name !== "string") continue;
    if (current.has(item.name)) continue;
    if (mergedAliases.has(item.name) && !canonicalMergedNames.has(item.name)) continue;
    current.set(item.name, {
      name: item.name,
      sources: Array.isArray(item.sources) ? [...item.sources] : [],
    });
  }

  courseRegistry = [...current.values()].sort((a, b) => a.name.localeCompare(b.name));
  localStorage.setItem(COURSE_REGISTRY_KEY, JSON.stringify(courseRegistry));

  const knownNames = new Set(courseRegistry.map((x) => x.name));

  if (!activeCoursesInitialized) {
    const sessionSaved = loadStringArray(sessionStorage, ACTIVE_COURSES_KEY);
    if (sessionSaved.length || sessionStorage.getItem(ACTIVE_COURSES_KEY) !== null) {
      activeCourses = new Set(sessionSaved.filter((name) => knownNames.has(name)));
    } else if (defaultsConfigured) {
      activeCourses = new Set([...defaultCourses].filter((name) => knownNames.has(name)));
    } else {
      activeCourses = new Set(knownNames);
    }
    activeCoursesInitialized = true;
    saveActiveCourses();
  } else if (!defaultsConfigured && activeCourses) {
    // Before the user explicitly configures defaults, newly discovered courses
    // behave like the original dashboard and appear automatically.
    for (const name of knownNames) activeCourses.add(name);
    saveActiveCourses();
  }

  updateCourseButton();
  updateCourseSuggestions();
}

function updateCourseButton() {
  const total = courseRegistry.length;
  const shown = activeCourses ? courseRegistry.filter((x) => activeCourses.has(x.name)).length : total;
  const count = document.querySelector("#courseButtonCount");
  count.textContent = total ? `${shown}/${total}` : "";
}

function updateCourseSuggestions() {
  let datalist = document.querySelector("#courseSuggestions");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "courseSuggestions";
    document.body.appendChild(datalist);
    const input = assignmentForm?.querySelector('input[name="course"]');
    if (input) input.setAttribute("list", "courseSuggestions");
  }
  datalist.innerHTML = "";
  for (const course of courseRegistry) {
    const option = document.createElement("option");
    option.value = course.name;
    datalist.appendChild(option);
  }
}

function ensureDefaultsConfigured() {
  if (defaultsConfigured) return;
  defaultCourses = new Set(courseRegistry.map((x) => x.name));
  defaultsConfigured = true;
  localStorage.setItem(DEFAULTS_CONFIGURED_KEY, "1");
}

function renderCourseMergeOptions() {
  if (!courseMergeOptions) return;
  courseMergeOptions.innerHTML = "";

  const bcoursesCourses = sourceCourseNames(bcoursesAssignments);
  const gradescopeCourses = sourceCourseNames(gradescopeAssignments);

  if (!bcoursesCourses.length || !gradescopeCourses.length) {
    const empty = document.createElement("div");
    empty.className = "course-merge-empty";
    empty.textContent = !bcoursesCourses.length
      ? "No bCourses classes are available to match yet."
      : "No Gradescope classes are available to match yet.";
    courseMergeOptions.appendChild(empty);
    return;
  }

  for (const bcourse of bcoursesCourses) {
    const row = document.createElement("div");
    row.className = "course-merge-row";

    const label = document.createElement("div");
    label.className = "course-merge-class";
    const name = document.createElement("strong");
    name.textContent = bcourse;
    const source = document.createElement("span");
    source.textContent = mergedNameSource === "gradescope" ? "paired with Gradescope" : "bCourses display name";
    label.append(name, source);

    const select = document.createElement("select");
    select.setAttribute("aria-label", `Gradescope class to combine with ${bcourse}`);

    const separate = document.createElement("option");
    separate.value = "";
    separate.textContent = "Keep separate";
    select.appendChild(separate);

    for (const gradescope of gradescopeCourses) {
      const option = document.createElement("option");
      option.value = gradescope;
      option.textContent = gradescope;
      option.selected = courseMerges[bcourse] === gradescope;

      const usedBy = Object.entries(courseMerges).find(
        ([otherBCourse, mappedGradescope]) => otherBCourse !== bcourse && mappedGradescope === gradescope
      );
      if (usedBy) {
        option.disabled = true;
        option.textContent = `${gradescope} · paired with ${usedBy[0]}`;
      }
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      const previous = courseMerges[bcourse] || "";
      const selected = select.value;

      if (selected) {
        // One Gradescope course can belong to only one bCourses course.
        for (const [otherBCourse, mappedGradescope] of Object.entries(courseMerges)) {
          if (otherBCourse !== bcourse && mappedGradescope === selected) {
            delete courseMerges[otherBCourse];
          }
        }
        courseMerges[bcourse] = selected;
        const oldCanonical = previous
          ? canonicalNameForMerge(bcourse, previous)
          : (mergedNameSource === "gradescope" ? bcourse : selected);
        const newCanonical = canonicalNameForMerge(bcourse, selected);
        migrateCoursePreferences(oldCanonical, newCanonical);
      } else {
        delete courseMerges[bcourse];
      }

      saveCourseMerges();
      reconcileCourseRegistry();
      renderCourseOptions();
      render();

      // If a prior pairing was removed, its Gradescope course can now be selected again.
      if (previous && previous !== selected) renderCourseMergeOptions();
    });

    const arrow = document.createElement("span");
    arrow.className = "course-merge-arrow";
    arrow.textContent = "←";
    arrow.title = mergedNameSource === "gradescope"
      ? "bCourses assignments will display under the Gradescope name"
      : "Gradescope assignments will display under the bCourses name";

    row.append(label, arrow, select);
    courseMergeOptions.appendChild(row);
  }
}

function renderCourseOptions() {
  reconcileCourseRegistry();
  courseOptions.innerHTML = "";

  if (!courseRegistry.length) {
    const empty = document.createElement("div");
    empty.className = "course-options-empty";
    empty.textContent = "No courses have been discovered yet.";
    courseOptions.appendChild(empty);
    renderCourseMergeOptions();
    return;
  }

  for (const course of courseRegistry) {
    const row = document.createElement("div");
    row.className = "course-option";

    const info = document.createElement("div");
    info.className = "course-option-info";
    const name = document.createElement("strong");
    name.textContent = course.name;
    const source = document.createElement("span");
    source.textContent = course.sources.join(" · ") || "Saved course";
    info.append(name, source);

    const showWrap = document.createElement("label");
    showWrap.className = "course-toggle";
    const show = document.createElement("input");
    show.type = "checkbox";
    show.checked = Boolean(activeCourses && activeCourses.has(course.name));
    show.setAttribute("aria-label", `Show ${course.name}`);
    show.addEventListener("change", () => {
      if (!activeCourses) activeCourses = new Set();
      if (show.checked) activeCourses.add(course.name);
      else activeCourses.delete(course.name);
      saveActiveCourses();
      updateCourseButton();
      render();
    });
    showWrap.appendChild(show);

    const defaultWrap = document.createElement("label");
    defaultWrap.className = "course-toggle";
    const defaultBox = document.createElement("input");
    defaultBox.type = "checkbox";
    defaultBox.checked = defaultsConfigured ? defaultCourses.has(course.name) : true;
    defaultBox.setAttribute("aria-label", `Use ${course.name} by default`);
    defaultBox.addEventListener("change", () => {
      ensureDefaultsConfigured();
      if (defaultBox.checked) defaultCourses.add(course.name);
      else defaultCourses.delete(course.name);
      saveDefaults();
    });
    defaultWrap.appendChild(defaultBox);

    const limitWrap = document.createElement("label");
    limitWrap.className = "course-limit";
    const limitSelect = document.createElement("select");
    limitSelect.setAttribute("aria-label", `Assignments to show for ${course.name}`);
    const selectedLimit = courseAssignmentLimits[course.name] ?? defaultCourseLimit;
    for (const [value, labelText] of [
      ["all", "All"],
      ["1", "1"],
      ["2", "2"],
      ["3", "3"],
      ["5", "5"],
      ["10", "10"],
      ["15", "15"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = labelText;
      option.selected = String(selectedLimit) === value;
      limitSelect.appendChild(option);
    }
    limitSelect.addEventListener("change", () => {
      courseAssignmentLimits[course.name] = limitSelect.value;
      saveCourseLimits();
      render();
    });
    limitWrap.appendChild(limitSelect);

    row.append(info, showWrap, defaultWrap, limitWrap);
    courseOptions.appendChild(row);
  }

  renderCourseMergeOptions();
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
  const courseName = String(a.course || "Manual");
  if (activeCourses && !activeCourses.has(courseName)) return false;

  const haystack = `${a.title || ""} ${courseName}`.toLowerCase();
  if (query && !haystack.includes(query)) return false;

  if (filter === "done") return Boolean(a.completed);
  if (filter === "all") return true;

  if (a.completed) return false;
  if (!a.dueDate) return true;
  if (a.dueDate >= now) return true;
  return Boolean(a.lateDate && a.lateDate >= now);
}

function makeAssignmentRow(a, start, end, nowPct, colorIndex, showCourseTag = false) {
  const now = new Date();
  const row = document.createElement("div");
  row.className = "timeline-row";

  const inLateWindow = Boolean(a.dueDate && a.dueDate < now && a.lateDate && a.lateDate >= now);
  const activeDeadline = inLateWindow ? a.lateDate : a.dueDate;
  const remaining = activeDeadline ? activeDeadline - now : null;

  row.classList.toggle("done", Boolean(a.completed));
  row.classList.toggle("urgent", Boolean(!a.completed && remaining !== null && remaining >= 0 && remaining <= DAY_MS));

  const label = document.createElement("div");
  label.className = "assignment-label assignment-label-row";

  // The date is already represented by the seven-day axis, so the left edge
  // intentionally contains only the assignment's time.
  const time = document.createElement("div");
  time.className = "assignment-time";
  time.textContent = a.dueDate ? fmtTime(a.dueDate) : "—";

  const check = document.createElement("button");
  check.type = "button";
  check.className = "assignment-check";

  if (a.source === "gradescope" || a.source === "bcourses") {
    check.title = `${sourceLabel(a.source)} completion is detected automatically`;
    check.setAttribute("aria-label", check.title);
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

  if (showCourseTag) {
    const courseTag = document.createElement("span");
    courseTag.className = `course-tag color-${courseColorIndex(a.course || "Manual")}`;
    courseTag.textContent = a.course || "Manual";
    titleRow.appendChild(courseTag);
  }

  const tag = document.createElement("span");
  tag.className = a.source === "manual" ? "manual-tag" : "source-tag";
  if (a.source === "manual") {
    tag.textContent = a.recurrence && a.recurrence !== "none" ? a.recurrence : "manual";
  } else {
    tag.textContent = sourceLabel(a.source);
  }
  titleRow.appendChild(tag);

  const meta = document.createElement("div");
  meta.className = "assignment-meta";
  meta.textContent = a.dueDate ? remainingText(a.dueDate) : "No deadline";
  if (a.lateDate) {
    const late = document.createElement("span");
    late.className = "late-text";
    late.textContent = ` · late until ${fmtDate(a.lateDate)}`;
    meta.appendChild(late);
  }

  text.append(titleRow, meta);
  label.append(time, check, text);

  if (a.source === "manual") {
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
      reconcileCourseRegistry();
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
    caption.textContent = dueRaw > 100 ? "after this week →" : dueRaw < 0 ? "past due" : fmtTime(a.dueDate);
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


function groupVisibleAssignments(assignments) {
  const grouped = new Map();
  for (const assignment of assignments) {
    const course = String(assignment.course || "Manual");
    if (!grouped.has(course)) grouped.set(course, []);
    grouped.get(course).push(assignment);
  }

  for (const items of grouped.values()) {
    items.sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
  }
  return grouped;
}

function applyCourseAssignmentLimits(grouped) {
  const limited = new Map();
  for (const [course, assignments] of grouped) {
    const limit = getCourseLimit(course);
    limited.set(course, Number.isFinite(limit) ? assignments.slice(0, limit) : assignments);
  }
  return limited;
}

function render() {
  const now = new Date();
  const start = startOfToday();
  const end = new Date(start.getTime() + TIMELINE_MS);
  const nowPct = pctWithinTimeline(now, start, end);

  reconcileCourseRegistry();

  const all = allAssignments();
  const matching = all
    .filter((a) => assignmentVisible(a, now))
    .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));

  const uncappedGroups = groupVisibleAssignments(matching);
  const limitedGroups = applyCourseAssignmentLimits(uncappedGroups);
  const visible = [...limitedGroups.values()]
    .flat()
    .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));

  list.innerHTML = "";

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No assignments in this view.";
    list.appendChild(empty);
  } else if (viewMode === "combined") {
    const section = document.createElement("section");
    section.className = "course-section combined-section";

    const heading = document.createElement("h2");
    heading.className = "course-heading";
    heading.append(document.createTextNode("All selected courses"));
    const count = document.createElement("span");
    count.className = "course-count";
    count.textContent = `${visible.length}`;
    heading.appendChild(count);
    section.appendChild(heading);

    const scroll = document.createElement("div");
    scroll.className = "timeline-scroll";
    const scrollInner = document.createElement("div");
    scrollInner.className = "timeline-scroll-inner";
    const wrap = document.createElement("div");
    wrap.className = "timeline-wrap";

    wrap.appendChild(makeCourseHeader("All selected courses", visible.length, start, nowPct));
    for (const assignment of visible) {
      wrap.appendChild(
        makeAssignmentRow(
          assignment,
          start,
          end,
          nowPct,
          courseColorIndex(assignment.course || "Manual"),
          true
        )
      );
    }

    scrollInner.appendChild(wrap);
    scroll.appendChild(scrollInner);
    section.appendChild(scroll);
    list.appendChild(section);
  } else {
    for (const [course, assignments] of limitedGroups) {
      if (!assignments.length) continue;

      const section = document.createElement("section");
      section.className = "course-section";

      const heading = document.createElement("h2");
      heading.className = "course-heading";
      heading.append(document.createTextNode(course));

      const count = document.createElement("span");
      count.className = "course-count";
      const totalForCourse = uncappedGroups.get(course)?.length ?? assignments.length;
      count.textContent = totalForCourse > assignments.length
        ? `${assignments.length} of ${totalForCourse}`
        : `${assignments.length}`;
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
        wrap.appendChild(makeAssignmentRow(assignment, start, end, nowPct, colorIndex, false));
      }

      scrollInner.appendChild(wrap);
      scroll.appendChild(scrollInner);
      section.appendChild(scroll);
      list.appendChild(section);
    }
  }

  const shownAll = all.filter((a) => !activeCourses || activeCourses.has(String(a.course || "Manual")));
  const notDone = shownAll.filter((a) => !a.completed);
  document.querySelector("#countToday").textContent = notDone.filter((a) => a.dueDate && isSameDay(a.dueDate, now)).length;
  document.querySelector("#count7").textContent = notDone.filter((a) => a.dueDate && a.dueDate >= now && a.dueDate - now <= TIMELINE_MS).length;
  document.querySelector("#countUpcoming").textContent = notDone.filter((a) => !a.dueDate || a.dueDate >= now || (a.lateDate && a.lateDate >= now)).length;
  document.querySelector("#countDone").textContent = shownAll.filter((a) => a.completed).length;
  updateCourseButton();
}

async function fetchDashboardData(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadRemoteData() {
  const status = document.querySelector("#syncStatus");
  status.textContent = "Loading assignment sources…";

  const [gradescopeResult, bcoursesResult] = await Promise.allSettled([
    fetchDashboardData("./data/gradescope.json"),
    fetchDashboardData("./data/bcourses.json"),
  ]);

  let gradescopeStatus = "Gradescope unavailable";
  if (gradescopeResult.status === "fulfilled") {
    const data = gradescopeResult.value;
    gradescopeAssignments = Array.isArray(data.assignments) ? data.assignments : [];
    if (data.synced_at) {
      gradescopeStatus = `Gradescope ${new Date(data.synced_at).toLocaleString()}`;
    } else {
      gradescopeStatus = "Gradescope not synced";
    }
  } else {
    console.error(gradescopeResult.reason);
    gradescopeAssignments = [];
  }

  let bcoursesStatus = "bCourses unavailable";
  if (bcoursesResult.status === "fulfilled") {
    const data = bcoursesResult.value;
    bcoursesAssignments = Array.isArray(data.assignments) ? data.assignments : [];
    if (data.enabled === false) {
      bcoursesStatus = "bCourses not configured";
    } else if (data.synced_at) {
      bcoursesStatus = `bCourses ${new Date(data.synced_at).toLocaleString()}`;
    } else {
      bcoursesStatus = "bCourses not synced";
    }
  } else {
    console.error(bcoursesResult.reason);
    bcoursesAssignments = [];
  }

  status.textContent = `${gradescopeStatus} · ${bcoursesStatus}`;
  reconcileCourseRegistry();
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

document.querySelector("#coursesBtn").addEventListener("click", () => {
  renderCourseOptions();
  coursesDialog.showModal();
});
document.querySelector("#closeCoursesDialog").addEventListener("click", () => coursesDialog.close());
document.querySelector("#doneCoursesDialog").addEventListener("click", () => coursesDialog.close());
document.querySelector("#showAllCourses").addEventListener("click", () => {
  activeCourses = new Set(courseRegistry.map((x) => x.name));
  saveActiveCourses();
  renderCourseOptions();
  render();
});
document.querySelector("#hideAllCourses").addEventListener("click", () => {
  activeCourses = new Set();
  saveActiveCourses();
  renderCourseOptions();
  render();
});
document.querySelector("#showDefaultCourses").addEventListener("click", () => {
  activeCourses = defaultsConfigured
    ? new Set(defaultCourses)
    : new Set(courseRegistry.map((x) => x.name));
  saveActiveCourses();
  renderCourseOptions();
  render();
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

document.querySelectorAll(".view-tab").forEach((button) => button.addEventListener("click", () => {
  setViewMode(button.dataset.view);
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
  reconcileCourseRegistry();
  if (activeCourses) {
    activeCourses.add(item.course);
    saveActiveCourses();
  }
  render();
});

if (mergedNameSourceSelect) {
  mergedNameSourceSelect.value = mergedNameSource;
  mergedNameSourceSelect.addEventListener("change", () => changeMergedNameSource(mergedNameSourceSelect.value));
}
if (allCourseLimitSelect) {
  allCourseLimitSelect.value = defaultCourseLimit;
  allCourseLimitSelect.addEventListener("change", () => applyLimitToAllCourses(allCourseLimitSelect.value));
}

updateCurrentDate();
updateThemeButton();
document.querySelectorAll(".view-tab").forEach((button) => {
  button.classList.toggle("active", button.dataset.view === viewMode);
});
reconcileCourseRegistry();
render();
loadRemoteData();
setInterval(() => {
  updateCurrentDate();
  render();
}, 60_000);
