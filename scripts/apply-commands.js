// Parses one command per line from the GitHub Issue body and mutates
// data/assignments.json and data/notes.json accordingly. Run by
// .github/workflows/process-commands.yml on every new issue.

const fs = require('fs');
const path = require('path');

const ASSIGN_PATH = path.join(__dirname, '..', 'data', 'assignments.json');
const NOTES_PATH = path.join(__dirname, '..', 'data', 'notes.json');
const RESULTS_PATH = path.join(__dirname, '..', 'command-results.txt');

const assignData = JSON.parse(fs.readFileSync(ASSIGN_PATH, 'utf8'));
const notesData = JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8'));

const VALID_COURSES = assignData.courses.map(c => c.id);
function normCourse(c) { return c.toLowerCase().replace(/-/g, ''); }
const courseMap = {};
VALID_COURSES.forEach(id => { courseMap[normCourse(id)] = id; });

function toISO(mmddyyyy) {
  const [m, d, y] = mmddyyyy.split('/').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function findAssignment(name, courseId) {
  const lower = name.trim().toLowerCase();
  let matches = assignData.assignments.filter(a => a.course === courseId && a.name.toLowerCase() === lower);
  if (matches.length === 1) return matches[0];
  matches = assignData.assignments.filter(a => a.course === courseId && a.name.toLowerCase().includes(lower));
  if (matches.length === 1) return matches[0];
  return null;
}

function nextId(courseId) {
  const nums = assignData.assignments
    .filter(a => a.course === courseId)
    .map(a => { const m = a.id.match(/-(\d+)$/); return m ? parseInt(m[1], 10) : 0; });
  const max = nums.length ? Math.max(...nums) : 0;
  return `${courseId}-${max + 1}`;
}

const results = [];
const lines = (process.env.ISSUE_BODY || '').split('\n').map(l => l.trim()).filter(Boolean);

for (const line of lines) {
  try {
    let m;

    // add TYPE "NAME" course CODE [start MM/DD/YYYY] [end MM/DD/YYYY] [points N]
    if ((m = line.match(/^add\s+(project|assignment|discussion)\s+"([^"]+)"\s+course\s+([a-z0-9-]+)(?:\s+start\s+(\d{1,2}\/\d{1,2}\/\d{4}))?(?:\s+end\s+(\d{1,2}\/\d{1,2}\/\d{4}))?(?:\s+points\s+(\d+))?\s*$/i))) {
      const [, type, name, courseRaw, start, end, points] = m;
      const courseId = courseMap[normCourse(courseRaw)];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${courseRaw}"`); continue; }
      assignData.assignments.push({
        id: nextId(courseId), course: courseId, name,
        points: points ? parseInt(points, 10) : null,
        type: type.charAt(0).toUpperCase() + type.slice(1),
        due: end ? toISO(end) : null,
        available: start ? toISO(start) : null,
        published: true, completed: false,
      });
      results.push(`OK: added "${name}" to ${courseId}`);
      continue;
    }

    // delete TYPE "NAME" course CODE
    if ((m = line.match(/^delete\s+(project|assignment|discussion)\s+"([^"]+)"\s+course\s+([a-z0-9-]+)\s*$/i))) {
      const [, , name, courseRaw] = m;
      const courseId = courseMap[normCourse(courseRaw)];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${courseRaw}"`); continue; }
      const found = findAssignment(name, courseId);
      if (!found) { results.push(`FAILED: "${line}" — no unique match for "${name}"`); continue; }
      assignData.assignments = assignData.assignments.filter(a => a.id !== found.id);
      results.push(`OK: deleted "${found.name}" from ${courseId}`);
      continue;
    }

    // change TYPE "NAME" course CODE [start ...] [end ...] [points ...]
    if ((m = line.match(/^change\s+(project|assignment|discussion)\s+"([^"]+)"\s+course\s+([a-z0-9-]+)(?:\s+start\s+(\d{1,2}\/\d{1,2}\/\d{4}))?(?:\s+end\s+(\d{1,2}\/\d{1,2}\/\d{4}))?(?:\s+points\s+(\d+))?\s*$/i))) {
      const [, , name, courseRaw, start, end, points] = m;
      const courseId = courseMap[normCourse(courseRaw)];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${courseRaw}"`); continue; }
      const found = findAssignment(name, courseId);
      if (!found) { results.push(`FAILED: "${line}" — no unique match for "${name}"`); continue; }
      if (start) found.available = toISO(start);
      if (end) found.due = toISO(end);
      if (points) found.points = parseInt(points, 10);
      results.push(`OK: updated "${found.name}" in ${courseId}`);
      continue;
    }

    // complete/uncomplete "NAME" course CODE
    if ((m = line.match(/^(complete|uncomplete)\s+"([^"]+)"\s+course\s+([a-z0-9-]+)\s*$/i))) {
      const [, action, name, courseRaw] = m;
      const courseId = courseMap[normCourse(courseRaw)];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${courseRaw}"`); continue; }
      const found = findAssignment(name, courseId);
      if (!found) { results.push(`FAILED: "${line}" — no unique match for "${name}"`); continue; }
      found.completed = action.toLowerCase() === 'complete';
      results.push(`OK: marked "${found.name}" ${found.completed ? 'complete' : 'incomplete'}`);
      continue;
    }

    // note add "TEXT"
    if ((m = line.match(/^note\s+add\s+"([^"]+)"\s*$/i))) {
      const text = m[1];
      const maxId = notesData.notes.reduce((mx, n) => Math.max(mx, n.id), 0);
      notesData.notes.push({ id: maxId + 1, text, created: new Date().toISOString().slice(0, 10) });
      results.push(`OK: added note`);
      continue;
    }

    // note delete N
    if ((m = line.match(/^note\s+delete\s+(\d+)\s*$/i))) {
      const id = parseInt(m[1], 10);
      const before = notesData.notes.length;
      notesData.notes = notesData.notes.filter(n => n.id !== id);
      results.push(notesData.notes.length < before ? `OK: deleted note #${id}` : `FAILED: note #${id} not found`);
      continue;
    }

    // note edit N "TEXT"
    if ((m = line.match(/^note\s+edit\s+(\d+)\s+"([^"]+)"\s*$/i))) {
      const id = parseInt(m[1], 10);
      const note = notesData.notes.find(n => n.id === id);
      if (!note) { results.push(`FAILED: note #${id} not found`); continue; }
      note.text = m[2];
      results.push(`OK: updated note #${id}`);
      continue;
    }

    results.push(`FAILED: "${line}" — didn't match any known command syntax`);
  } catch (err) {
    results.push(`FAILED: "${line}" — ${err.message}`);
  }
}

fs.writeFileSync(ASSIGN_PATH, JSON.stringify(assignData, null, 2));
fs.writeFileSync(NOTES_PATH, JSON.stringify(notesData, null, 2));
fs.writeFileSync(RESULTS_PATH, results.length ? results.join('\n') : 'No commands found in issue body.');
console.log(results.join('\n'));
