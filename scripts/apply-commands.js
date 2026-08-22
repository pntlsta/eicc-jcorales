// Parses one command per line from the GitHub Issue body and mutates
// data/assignments.json accordingly. Run by
// .github/workflows/process-commands.yml on every new issue.

const fs = require('fs');
const path = require('path');

const ASSIGN_PATH = path.join(__dirname, '..', 'data', 'assignments.json');
const NOTES_PATH = path.join(__dirname, '..', 'data', 'notes.json');
const NOTEBOOKS_INDEX_PATH = path.join(__dirname, '..', 'data', 'notebooks.json');
const NOTEBOOKS_DIR = path.join(__dirname, '..', 'data', 'notebooks');
const RESULTS_PATH = path.join(__dirname, '..', 'command-results.txt');

const assignData = JSON.parse(fs.readFileSync(ASSIGN_PATH, 'utf8'));
const notesData = JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8'));
const notebooksData = fs.existsSync(NOTEBOOKS_INDEX_PATH)
  ? JSON.parse(fs.readFileSync(NOTEBOOKS_INDEX_PATH, 'utf8'))
  : { notebooks: [] };
if (!fs.existsSync(NOTEBOOKS_DIR)) fs.mkdirSync(NOTEBOOKS_DIR, { recursive: true });

function normCourse(c) { return c.toLowerCase().replace(/-/g, ''); }

function courseMap() {
  const map = {};
  assignData.courses.forEach(c => { map[normCourse(c.id)] = c.id; });
  return map;
}

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

function slugify(str) {
  const base = (str || 'untitled').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'untitled';
}
function uniqueFolderId(base) {
  let candidate = base, n = 2;
  while (notebooksData.notebooks.some(f => f.id === candidate)) { candidate = `${base}-${n}`; n++; }
  return candidate;
}
function findFolder(id) { return notebooksData.notebooks.find(f => f.id === id); }

const results = [];
const lines = (process.env.ISSUE_BODY || '').split('\n').map(l => l.trim()).filter(Boolean);

for (const line of lines) {
  try {
    let m;
    const cMap = courseMap();

    // add course "XXX-000" "Name" "Description" color #HEX
    if ((m = line.match(/^add\s+course\s+"([A-Za-z]{3}-\d{3})"\s+"([^"]+)"\s+"([^"]*)"\s+color\s+(#[0-9a-fA-F]{6})\s*$/i))) {
      const [, code, name, desc, hex] = m;
      const courseId = normCourse(code);
      if (assignData.courses.some(c => c.id === courseId)) {
        results.push(`FAILED: "${line}" — course ${code} already exists`);
        continue;
      }
      assignData.courses.push({ id: courseId, code: code.toUpperCase(), name, desc, hex });
      results.push(`OK: added course ${code.toUpperCase()} — ${name}`);
      continue;
    }

    // delete course CODE
    if ((m = line.match(/^delete\s+course\s+([a-z0-9-]+)\s*$/i))) {
      const courseId = cMap[normCourse(m[1])];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${m[1]}"`); continue; }
      const before = assignData.assignments.length;
      assignData.assignments = assignData.assignments.filter(a => a.course !== courseId);
      assignData.courses = assignData.courses.filter(c => c.id !== courseId);
      results.push(`OK: deleted course ${courseId} and ${before - assignData.assignments.length} assignment(s)`);
      continue;
    }

    // add TYPE "NAME" course CODE [points N] [start MM/DD/YYYY] [end MM/DD/YYYY]
    if ((m = line.match(/^add\s+(project|assignment|discussion)\s+"([^"]+)"\s+course\s+([a-z0-9-]+)(?:\s+points\s+(\d+))?(?:\s+start\s+(\d{1,2}\/\d{1,2}\/\d{4}))?(?:\s+end\s+(\d{1,2}\/\d{1,2}\/\d{4}))?\s*$/i))) {
      const [, type, name, courseRaw, points, start, end] = m;
      const courseId = cMap[normCourse(courseRaw)];
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
      const courseId = cMap[normCourse(courseRaw)];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${courseRaw}"`); continue; }
      const found = findAssignment(name, courseId);
      if (!found) { results.push(`FAILED: "${line}" — no unique match for "${name}"`); continue; }
      assignData.assignments = assignData.assignments.filter(a => a.id !== found.id);
      results.push(`OK: deleted "${found.name}" from ${courseId}`);
      continue;
    }

    // change TYPE "NAME" course CODE [points N] [start ...] [end ...]
    if ((m = line.match(/^change\s+(project|assignment|discussion)\s+"([^"]+)"\s+course\s+([a-z0-9-]+)(?:\s+points\s+(\d+))?(?:\s+start\s+(\d{1,2}\/\d{1,2}\/\d{4}))?(?:\s+end\s+(\d{1,2}\/\d{1,2}\/\d{4}))?\s*$/i))) {
      const [, , name, courseRaw, points, start, end] = m;
      const courseId = cMap[normCourse(courseRaw)];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${courseRaw}"`); continue; }
      const found = findAssignment(name, courseId);
      if (!found) { results.push(`FAILED: "${line}" — no unique match for "${name}"`); continue; }
      if (points) found.points = parseInt(points, 10);
      if (start) found.available = toISO(start);
      if (end) found.due = toISO(end);
      results.push(`OK: updated "${found.name}" in ${courseId}`);
      continue;
    }

    // complete/uncomplete "NAME" course CODE
    if ((m = line.match(/^(complete|uncomplete)\s+"([^"]+)"\s+course\s+([a-z0-9-]+)\s*$/i))) {
      const [, action, name, courseRaw] = m;
      const courseId = cMap[normCourse(courseRaw)];
      if (!courseId) { results.push(`FAILED: "${line}" — unknown course "${courseRaw}"`); continue; }
      const found = findAssignment(name, courseId);
      if (!found) { results.push(`FAILED: "${line}" — no unique match for "${name}"`); continue; }
      found.completed = action.toLowerCase() === 'complete';
      results.push(`OK: marked "${found.name}" ${found.completed ? 'complete' : 'incomplete'}`);
      continue;
    }

    // notebook folder add "Title"
    if ((m = line.match(/^notebook\s+folder\s+add\s+"([^"]+)"\s*$/i))) {
      const title = m[1];
      const id = uniqueFolderId(slugify(title));
      const now = new Date().toISOString().slice(0, 10);
      notebooksData.notebooks.push({ id, title, created: now, updated: now, pages: [] });
      results.push(`OK: added notebook folder "${title}" (${id})`);
      continue;
    }

    // notebook folder rename "id" "New Title"
    if ((m = line.match(/^notebook\s+folder\s+rename\s+"([^"]+)"\s+"([^"]+)"\s*$/i))) {
      const [, id, title] = m;
      const folder = findFolder(id);
      if (!folder) { results.push(`FAILED: "${line}" — unknown folder "${id}"`); continue; }
      folder.title = title;
      folder.updated = new Date().toISOString().slice(0, 10);
      results.push(`OK: renamed folder "${id}" to "${title}"`);
      continue;
    }

    // notebook folder delete "id"
    if ((m = line.match(/^notebook\s+folder\s+delete\s+"([^"]+)"\s*$/i))) {
      const id = m[1];
      const folder = findFolder(id);
      if (!folder) { results.push(`FAILED: "${line}" — unknown folder "${id}"`); continue; }
      (folder.pages || []).forEach(p => {
        const fp = path.join(NOTEBOOKS_DIR, p.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
      const pageCount = (folder.pages || []).length;
      notebooksData.notebooks = notebooksData.notebooks.filter(f => f.id !== id);
      results.push(`OK: deleted notebook folder "${id}" and ${pageCount} page(s)`);
      continue;
    }

    // notebook page save "folderId" "filename.md" "Title" BASE64CONTENT
    if ((m = line.match(/^notebook\s+page\s+save\s+"([^"]+)"\s+"([^"]+\.md)"\s+"([^"]*)"\s+(\S+)\s*$/i))) {
      const [, folderId, filename, title, b64] = m;
      const folder = findFolder(folderId);
      if (!folder) { results.push(`FAILED: "${line}" — unknown folder "${folderId}"`); continue; }
      let content;
      try {
        content = Buffer.from(b64, 'base64').toString('utf8');
      } catch (e) {
        results.push(`FAILED: "notebook page save ${filename}" — couldn't decode content`);
        continue;
      }
      fs.writeFileSync(path.join(NOTEBOOKS_DIR, filename), content, 'utf8');
      const now = new Date().toISOString().slice(0, 10);
      folder.pages = folder.pages || [];
      const existingPage = folder.pages.find(p => p.filename === filename);
      if (existingPage) {
        existingPage.title = title || existingPage.title;
        existingPage.updated = now;
      } else {
        folder.pages.push({ filename, title: title || filename, created: now, updated: now });
      }
      folder.updated = now;
      results.push(`OK: saved page "${filename}" in folder "${folderId}"`);
      continue;
    }

    // notebook page delete "folderId" "filename.md"
    if ((m = line.match(/^notebook\s+page\s+delete\s+"([^"]+)"\s+"([^"]+\.md)"\s*$/i))) {
      const [, folderId, filename] = m;
      const folder = findFolder(folderId);
      if (!folder) { results.push(`FAILED: "${line}" — unknown folder "${folderId}"`); continue; }
      const filePath = path.join(NOTEBOOKS_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      const before = (folder.pages || []).length;
      folder.pages = (folder.pages || []).filter(p => p.filename !== filename);
      folder.updated = new Date().toISOString().slice(0, 10);
      results.push(folder.pages.length < before ? `OK: deleted page "${filename}" from "${folderId}"` : `FAILED: page "${filename}" not found in "${folderId}"`);
      continue;
    }

    // edit item ID name "Name" type "Type" points VAL start VAL end VAL  (VAL is a value or "none")
    if ((m = line.match(/^edit\s+item\s+([a-z0-9-]+)\s+name\s+"([^"]+)"\s+type\s+"([^"]+)"\s+points\s+(none|\d+)\s+start\s+(none|\d{1,2}\/\d{1,2}\/\d{4})\s+end\s+(none|\d{1,2}\/\d{1,2}\/\d{4})\s*$/i))) {
      const [, id, name, type, points, start, end] = m;
      const item = assignData.assignments.find(a => a.id === id);
      if (!item) { results.push(`FAILED: "${line}" — unknown item "${id}"`); continue; }
      item.name = name;
      item.type = type;
      item.points = points === 'none' ? null : parseInt(points, 10);
      item.available = start === 'none' ? null : toISO(start);
      item.due = end === 'none' ? null : toISO(end);
      results.push(`OK: updated item "${id}"`);
      continue;
    }

    // delete item ID
    if ((m = line.match(/^delete\s+item\s+([a-z0-9-]+)\s*$/i))) {
      const id = m[1];
      const before = assignData.assignments.length;
      assignData.assignments = assignData.assignments.filter(a => a.id !== id);
      results.push(assignData.assignments.length < before ? `OK: deleted item "${id}"` : `FAILED: item "${id}" not found`);
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
fs.writeFileSync(NOTEBOOKS_INDEX_PATH, JSON.stringify(notebooksData, null, 2));
fs.writeFileSync(RESULTS_PATH, results.length ? results.join('\n') : 'No commands found in issue body.');
console.log(results.join('\n'));
