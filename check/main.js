// Запускає перевірки по черзі й показує результат. Змінювати цей файл не потрібно.
import { Fail, defineChecks, groups } from './checks.js';
import { loadSource, openApp } from './harness.js';

const results = /** @type {HTMLElement} */ (document.querySelector('#results'));
const summary = /** @type {HTMLElement} */ (document.querySelector('#summary'));
const runButton = /** @type {HTMLButtonElement} */ (document.querySelector('#run'));

/** Результати останнього запуску — для інструментів, що читають сторінку. */
/** @type {{ id: string, title: string, ok: boolean, detail: string }[]} */
let report = [];

async function readFixtures() {
  const read = async (/** @type {string} */ name) => {
    const response = await fetch(`check/fixtures/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`check/fixtures/${name}.json: HTTP ${response.status}`);
    return response.json();
  };
  const [search, shows] = await Promise.all([read('search'), read('shows')]);
  return { search, shows };
}

async function run() {
  runButton.disabled = true;
  results.replaceChildren();
  report = [];
  summary.textContent = 'Перевірка триває…';
  document.body.dataset.state = 'running';

  let checks;
  try {
    if (location.protocol === 'file:') throw new Error('сторінку відкрито через file://');
    await loadSource();
    checks = defineChecks(await readFixtures());
  } catch (error) {
    summary.textContent = `Перевірку не запущено: ${error instanceof Error ? error.message : error}. Відкрийте check.html через Live Preview (або npx serve .), як і index.html.`;
    document.body.dataset.state = 'error';
    runButton.disabled = false;
    return;
  }

  const lists = new Map();
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'group';
    const heading = document.createElement('h2');
    heading.textContent = group.title;
    const list = document.createElement('ol');
    list.className = 'checks';
    section.append(heading, list);
    results.append(section);
    lists.set(group.id, { list, heading, passed: 0, total: 0, title: group.title });
  }

  let passed = 0;
  for (const [index, check] of checks.entries()) {
    summary.textContent = `Перевірка ${index + 1} з ${checks.length}…`;
    let ok = true;
    let detail = '';
    try {
      await check.run();
    } catch (error) {
      ok = false;
      detail = error instanceof Fail ? error.message : `перевірка зупинилася з помилкою: ${error instanceof Error ? error.message : error}`;
    }
    /** @type {string[]} */
    let errors = [];
    /** @type {string[]} */
    let blocked = [];
    try {
      const win = /** @type {any} */ (document.querySelector('#stage iframe'))?.contentWindow;
      errors = win?.__check?.errors ?? [];
      blocked = (win?.__net?.log ?? []).map((/** @type {{ blocked: string }} */ entry) => entry.blocked).filter(Boolean);
    } catch {
      errors = [];
    }
    if (!ok && errors.length) detail += ` · Помилка в Console застосунку: ${errors[0]}`;
    if (!ok && blocked.length && check.id !== 'C1.9') {
      detail += ` · Запит заблоковано як CORS (${blocked[0]}), тож відповіді застосунок не отримав (C1.9)`;
    }
    if (ok) passed += 1;
    report.push({ id: check.id, title: check.title, ok, detail });
    showResult(lists.get(check.group), check, ok, detail);
  }

  for (const group of lists.values()) {
    group.heading.textContent = `${group.title} — ${group.passed} з ${group.total}`;
  }
  // Застосунок з останньої перевірки не потрібен: показуємо чисту копію.
  await openApp().catch(() => {});
  summary.textContent = `Пройдено: ${passed} з ${checks.length}`;
  document.body.dataset.state = passed === checks.length ? 'passed' : 'failed';
  runButton.disabled = false;
}

/**
 * @param {{ list: HTMLOListElement, passed: number, total: number }} group
 * @param {{ id: string, title: string }} check
 * @param {boolean} ok
 * @param {string} detail
 */
function showResult(group, check, ok, detail) {
  group.total += 1;
  if (ok) group.passed += 1;
  const item = document.createElement('li');
  item.className = ok ? 'pass' : 'fail';
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = ok ? '✓' : '✗';
  const label = document.createElement('span');
  label.className = 'visually-hidden';
  label.textContent = ok ? 'Пройдено: ' : 'Не пройдено: ';
  const id = document.createElement('strong');
  id.textContent = check.id;
  const title = document.createElement('span');
  title.textContent = ` ${check.title}`;
  item.append(mark, label, id, title);
  if (detail) {
    const why = document.createElement('p');
    why.className = 'detail';
    why.textContent = detail;
    item.append(why);
  }
  group.list.append(item);
}

Object.defineProperty(window, 'checkReport', { get: () => report });
runButton.addEventListener('click', run);
run();
