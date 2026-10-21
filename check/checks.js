// Перевірки ShowFinder. Номер і назва кожної — правило з ТЗ (C2.4 — четверте правило C2).
// Кожна перевірка відкриває свіжу копію застосунку, діє як користувач і сама вирішує, що
// відповість «TVmaze»: записані відповіді, затримку, помилку чи обрив з'єднання. Невдача
// пояснює, що саме не так. Очікувані результати — із записаних відповідей у check/fixtures/.
import { busy, norm, openApp, sleep, text } from './harness.js';

/** @typedef {import('./harness.js').App} App */
/** @typedef {import('./harness.js').Entry} Entry */
/** @typedef {{ id: string, group: string, title: string, run: () => Promise<void> }} Check */

export const groups = [
  { id: 'C1', title: 'C1 · Пошук' },
  { id: 'C2', title: 'C2 · Сторінка серіалу' },
  { id: 'C3', title: 'C3 · Помилки' },
];

export class Fail extends Error {}

/** @returns {asserts condition} */
function expect(/** @type {unknown} */ condition, /** @type {string} */ detail) {
  if (!condition) throw new Fail(detail);
}

const GIRLS = 139;
const DERRY_GIRLS = 33320;
const LOADING = 'Завантаження…';
const NOT_FOUND = 'Серіал не знайдено';
const SERVER = 'Не вдалося отримати дані від TVmaze.';
const OFFLINE = "Немає з'єднання з TVmaze.";
const RATE_WAIT = 'Забагато запитів до TVmaze, повторюю…';
const RATE = 'Забагато запитів до TVmaze.';
/** Сторінка проксі чи captive portal: 200, але не JSON. */
const PORTAL = '<!doctype html><html><head><title>Wi-Fi</title></head><body><h1>Увійдіть у мережу</h1></body></html>';
/** Технічні подробиці, яких користувач не має бачити (ТЗ, C3.10). */
const TECHNICAL = /TypeError|SyntaxError|AbortError|DOMException|Failed to fetch|NetworkError|Unexpected token|JSON|HTTP|\bstatus\b|undefined|\bnull\b|\[object|\bError\b|\b[1-5]\d\d\b|[{}<>]/;

const qOf = (/** @type {Entry | undefined} */ entry) => (entry ? new URL(entry.url).searchParams.get('q') : null);
/** Шлях і рядок запиту: /search/shows?q=girls. Повідомлення будуються заздалегідь, тож запису може не бути. */
const pathOf = (/** @type {Entry | undefined} */ entry) => {
  if (!entry) return '—';
  const url = new URL(entry.url);
  return decodeURIComponent(url.pathname + url.search);
};
const isSearch = (/** @type {string} */ url) => new URL(url).pathname.replace(/\/$/, '') === '/search/shows';
const isShow = (/** @type {number} */ id) => (/** @type {string} */ url) => new RegExp(`^/shows/${id}(/|$)`).test(new URL(url).pathname);
const short = (/** @type {string} */ value) => (value.length > 90 ? `${value.slice(0, 90)}…` : value) || 'нічого';
const same = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * @param {{ search: any, shows: any }} fixtures записані відповіді TVmaze
 */
export function defineChecks(fixtures) {
  const results = (/** @type {string} */ query) => fixtures.search.queries[query].map((/** @type {any} */ r) => r.show);
  const nameOf = new Map(Object.values(fixtures.search.queries).flat().map((/** @type {any} */ r) => [r.show.id, r.show.name]));
  const girls = results('girls').map((/** @type {any} */ show) => show.id);
  const gir = results('gir').map((/** @type {any} */ show) => show.id);
  const listed = (/** @type {number[]} */ ids) =>
    ids.length ? ids.slice(0, 4).map((id) => nameOf.get(id) ?? `id ${id}`).join(', ') + (ids.length > 4 ? ` … (усього ${ids.length})` : '') : 'жодної картки';
  const page = fixtures.shows.shows[GIRLS]._embedded;
  const seasonCount = new Set(page.episodes.map((/** @type {any} */ e) => e.season)).size;

  /** @type {Check[]} */
  const checks = [];
  const check = (/** @type {string} */ id, /** @type {string} */ title, /** @type {() => Promise<void>} */ run) =>
    checks.push({ id, group: id.slice(0, 2), title, run });

  /** Застосунок, у якому вже знайдено «girls» (C1). */
  async function withResults() {
    const app = await openApp();
    await app.type('girls');
    expect(await app.until(() => same(app.ids(), girls), 2500), `після введення «girls» у #results ${listed(app.ids())} замість 10 серіалів — спершу C1`);
    return app;
  }

  /** Чекає, доки застосунок надішле пошук із цим запитом. */
  async function searchSent(/** @type {App} */ app, /** @type {string} */ query) {
    const sent = await app.until(() => app.searches().some((entry) => qOf(entry) === query), 1500);
    expect(sent, `після введення «${query}» запиту пошуку немає: пошук має запускати подія input (C1.3)`);
    return app.searches().filter((entry) => qOf(entry) === query);
  }

  /** Відповідає на всі затримані запити (знімок черги на цей момент). */
  async function release(/** @type {Entry[]} */ entries) {
    for (const entry of entries) await entry.respond();
    await sleep(60);
  }

  /** Відповідь для запитів, що відповідають match, — доки правило не видалено або не вичерпано. */
  function answer(/** @type {App} */ app, /** @type {(url: string) => boolean} */ match, /** @type {object} */ spec, times = 99) {
    const rule = { match, spec, times };
    app.net.script.push(rule);
    return () => {
      const index = app.net.script.indexOf(rule);
      if (index !== -1) app.net.script.splice(index, 1);
    };
  }

  /** Відкриває серіал і чекає на його сторінку. */
  async function openShown(/** @type {App} */ app, /** @type {number} */ id) {
    await app.open(id);
    const name = nameOf.get(id);
    expect(await app.until(() => app.shownTitle() === name, 2000), `після кліку по картці ${name} #details показує «${short(app.shownTitle() || text(app.details))}» — спершу C2.1`);
  }

  /** Чекає, доки в області з'явиться текст. */
  const shows = (/** @type {App} */ app, /** @type {Element} */ region, /** @type {string} */ wanted, timeout = 1500) =>
    app.until(() => text(region).includes(wanted), timeout);

  /** Пояснення, якщо область досі «Завантаження…», бо застосунок сам повторює той самий запит. */
  function autoRetried(/** @type {App} */ app, /** @type {Element} */ region) {
    if (!text(region).includes(LOADING)) return '';
    const urls = (region === app.results ? app.searches() : app.api(/^\/shows\//)).map((entry) => entry.url);
    const repeats = urls.length - new Set(urls).size;
    return repeats ? ` — застосунок сам повторив запит (${repeats}): автоматично повторюється лише 429 (C3.6)` : '';
  }

  /** Помилка з текстом і «Спробувати ще» в області. */
  function expectError(/** @type {App} */ app, /** @type {Element} */ region, /** @type {string} */ message, /** @type {string} */ cause) {
    const where = region === app.results ? '#results' : '#details';
    const retried = message === RATE ? '' : autoRetried(app, region);
    expect(text(region).includes(message), `${cause}: ${where} показує «${short(text(region))}», очікувалося «${message}»${retried}`);
    expect(app.retry(region), `${cause}: у ${where} є повідомлення, але немає кнопки «Спробувати ще» (шаблон #state-error)`);
  }

  /* ---------------- C1 · Пошук ---------------- */

  check('C1.1', 'Запит — GET https://api.tvmaze.com/search/shows?q=… через fetch: без пробілів на краях, закодований', async () => {
    const app = await openApp();
    await app.type('  Law & Order ');
    await app.until(() => app.api().length > 0 || app.probe.xhr.length > 0, 1500);
    await sleep(700);
    expect(!app.probe.xhr.length, `запит через XMLHttpRequest (${app.probe.xhr[0]}): ТЗ вимагає Fetch API`);
    const elsewhere = app.net.log.filter((entry) => new URL(entry.url).origin !== 'https://api.tvmaze.com' && entry.state !== 'passed');
    expect(!elsewhere.length, `запит до ${elsewhere[0]?.url}: дані беруться лише з https://api.tvmaze.com`);
    const sent = app.api();
    expect(sent.length, 'після введення «Law & Order» запиту до TVmaze немає: пошук має запускати подія input (C1.3)');
    const search = app.searches().at(-1);
    expect(search, `запит ${pathOf(sent[0])}: пошук за назвою — GET /search/shows?q=… (документація TVmaze, Show search)`);
    expect(search.method === 'GET', `пошук надіслано методом ${search.method}, а не GET`);
    const q = qOf(search);
    expect(q !== null, `у запиті ${pathOf(search)} немає параметра q`);
    expect(q.trim() === 'Law & Order', `до API дійшло «${q}» замість «Law & Order»: символ & у рядку запиту відділяє параметри, тож значення треба закодувати (encodeURIComponent або URLSearchParams, §4.2)`);
    expect(q === 'Law & Order', `до API дійшло «${q}»: приберіть пробіли на краях запиту (trim)`);
  });

  check('C1.2', 'Результати — картки renderResults у порядку відповіді API; статус «Знайдено: N»', async () => {
    const app = await openApp();
    await app.type('girls');
    await searchSent(app, 'girls');
    const shown = await app.until(() => same(app.ids(), girls), 2000);
    expect(shown, `у #results ${listed(app.ids())}; очікувалися 10 серіалів з відповіді API в її порядку: ${listed(girls)}`);
    expect(app.status() === 'Знайдено: 10', `статус «${app.status()}», очікувався «Знайдено: 10»`);
  });

  check('C1.3', 'Серія введень — один запит, не пізніше ніж за 500 мс після останнього введення', async () => {
    const app = await openApp();
    let last = 0;
    for (const part of ['g', 'gi', 'gir', 'girl', 'girls']) {
      last = app.now();
      await app.type(part);
      await sleep(50);
    }
    await app.until(() => app.searches().some((entry) => qOf(entry) === 'girls'), 1500);
    await sleep(300);
    const sent = app.searches();
    expect(sent.length, 'за серію введень «g» → «girls» жодного запиту: пошук має запускати подія input');
    const queries = sent.map((entry) => `«${qOf(entry)}»`).join(', ');
    expect(sent.length === 1, `${sent.length} запити за одну серію введень (${queries}): надсилайте запит, коли користувач перестав вводити (debounce)`);
    expect(qOf(sent[0]) === 'girls', `запит ${queries}, а в полі «girls»`);
    const wait = Math.round(sent[0].at - last);
    expect(wait <= 650, `запит надіслано через ${wait} мс після останнього введення; ТЗ — не пізніше ніж через 500 мс`);
  });

  check('C1.4', 'Enter шукає одразу, без перезавантаження сторінки й без другого запиту', async () => {
    const app = await openApp();
    await app.type('girls');
    const pressed = app.now();
    await app.submit();
    expect(!app.navigated(), 'Enter перезавантажив сторінку: обробіть submit і скасуйте типову дію (preventDefault)');
    await app.until(() => app.searches().length > 0, 400);
    const first = app.searches()[0];
    expect(first, 'після Enter запиту пошуку немає');
    const wait = Math.round(first.at - pressed);
    expect(wait <= 150, `після Enter запит надіслано через ${wait} мс: Enter шукає одразу, без очікування`);
    await sleep(800);
    expect(!app.navigated(), 'після Enter сторінку перезавантажено');
    const sent = app.searches();
    expect(sent.length === 1, `${sent.length} запити «girls»: після Enter відкладений пошук того самого запиту вже не потрібен`);
    expect(await app.until(() => same(app.ids(), girls), 600), `після Enter у #results ${listed(app.ids())} замість результатів «girls»`);
  });

  check('C1.5', 'Менше 2 символів — запиту немає, #results і статус порожні; незавершений пошук уже не показується', async () => {
    const app = await openApp();
    await app.type('g');
    await sleep(800);
    expect(!app.searches().length, `запит «${qOf(app.searches()[0])}» для одного символу: шукайте від 2 символів`);
    await app.type('girls');
    expect(await app.until(() => same(app.ids(), girls), 2000), `після «girls» у #results ${listed(app.ids())} — спершу C1.2`);
    await app.type('g');
    await sleep(800);
    expect(!app.cards().length && !text(app.results), `після очищення поля до «g» у #results лишилося: «${short(text(app.results))}»`);
    expect(!app.status(), `після очищення поля до «g» статус «${app.status()}», очікувався порожній`);

    app.net.hold = true;
    await app.type('dark');
    expect(await app.until(() => app.held().length > 0, 1500), 'після введення «dark» запиту пошуку немає');
    await app.type('d');
    await sleep(700);
    await release(app.held());
    expect(!app.cards().length, `відповідь на «dark» прийшла вже після очищення поля до «d» — і її показано: ${listed(app.ids())}`);
    expect(!app.status(), `відповідь на «dark» прийшла після очищення поля до «d», і статус — «${app.status()}», а не порожній`);
  });

  check('C1.6', 'Поки запит триває: #results має aria-busy="true" і «Завантаження…», статус «Завантаження…»; після відповіді — ні', async () => {
    const app = await openApp();
    app.net.hold = true;
    await app.type('girls');
    expect(await app.until(() => app.held().length > 0, 1500), 'після введення «girls» запиту пошуку немає');
    await sleep(30);
    expect(busy(app.results), `поки запит триває, у #results aria-busy="${app.results.getAttribute('aria-busy')}", очікувалося "true"`);
    expect(text(app.results).includes(LOADING), `поки запит триває, #results показує «${short(text(app.results))}», а не «${LOADING}» (шаблон #state-loading)`);
    expect(app.status() === LOADING, `поки запит триває, статус «${app.status()}», очікувався «${LOADING}»`);
    app.net.hold = false;
    await release(app.held());
    await app.until(() => same(app.ids(), girls), 1000);
    expect(!busy(app.results), 'після відповіді #results досі має aria-busy="true"');
    expect(!text(app.results).includes(LOADING), `після відповіді #results досі показує «${LOADING}»`);
    expect(app.status() === 'Знайдено: 10', `після відповіді статус «${app.status()}», очікувався «Знайдено: 10»`);
  });

  check('C1.7', 'Порожня відповідь (200 []) — «Нічого не знайдено за запитом «…»» у #results і в статусі, не помилка', async () => {
    const app = await openApp();
    const message = 'Нічого не знайдено за запитом «zzqx»';
    await app.type('zzqx');
    await searchSent(app, 'zzqx');
    await shows(app, app.results, message, 1500);
    expect(!app.cards().length, `на порожню відповідь у #results ${listed(app.ids())}`);
    expect(!app.retry(app.results), 'порожній результат показано як помилку з «Спробувати ще»: 200 [] — це успішна відповідь');
    expect(text(app.results) === message, `#results показує «${short(text(app.results))}», очікувалося «${message}»`);
    expect(app.status() === message, `статус «${app.status()}», очікувався «${message}»`);
  });

  check('C1.8', 'Відповідь на старіший запит ніколи не замінює новішу — в якому б порядку вони не прийшли', async () => {
    for (const order of ['newer first', 'older first']) {
      const app = await openApp();
      app.net.hold = true;
      await app.type('gir');
      const older = await searchSent(app, 'gir');
      await app.type('girls');
      const newer = await searchSent(app, 'girls');
      await sleep(30);
      expect(
        !app.retry(app.results) && text(app.results).includes(LOADING),
        `поки «girls» завантажується, #results показує «${short(text(app.results))}», а не «${LOADING}»: скасований запит «gir» — не помилка (C3.9)`,
      );
      if (order === 'newer first') {
        await release(newer);
        await app.until(() => same(app.ids(), girls), 1000);
        await release(older);
        await sleep(60);
        expect(same(app.ids(), girls), `відповідь на «gir» прийшла після відповіді на «girls» — і замінила її: у #results ${listed(app.ids())}`);
      } else {
        await release(older);
        await sleep(60);
        expect(!same(app.ids(), gir), 'відповідь на «gir» прийшла, поки «girls» ще завантажувався, — і її показано, хоча в полі вже «girls»');
        await release(newer);
        await app.until(() => same(app.ids(), girls), 1000);
        expect(same(app.ids(), girls), `після відповіді на «girls» у #results ${listed(app.ids())}`);
      }
      expect(app.status() === 'Знайдено: 10', `після обох відповідей статус «${app.status()}», очікувався «Знайдено: 10»`);
      expect(!app.retry(app.results), 'після скасованого запиту #results показує помилку: скасування (AbortError) — не помилка (C3.9)');
    }
  });

  check('C1.9', "Без preflight: лише GET, без власних заголовків і Content-Type, без mode: 'no-cors'", async () => {
    const app = await openApp();
    await app.type('girls');
    await app.until(() => app.api().length > 0, 1500);
    await sleep(150);
    const sent = app.api();
    expect(sent.length, 'після введення «girls» запиту до TVmaze немає');
    for (const entry of sent) {
      expect(entry.mode !== 'no-cors', "mode: 'no-cors' дає непрозору відповідь (status 0), тіла не прочитати: це не обхід CORS, а відмова від даних (§4.3)");
      expect(!entry.blocked, `запит заблоковано як CORS: ${entry.blocked}. Справжній TVmaze відповідає на preflight (OPTIONS) кодом 405, тож такий запит падає в браузері (§4.3)`);
    }
  });

  /* ---------------- C2 · Сторінка серіалу ---------------- */

  check('C2.1', 'Клік по картці — сторінка серіалу в #details через renderShow: назва, епізоди за сезонами, актори', async () => {
    const app = await withResults();
    await app.open(GIRLS);
    const episodes = () => app.details.querySelectorAll('[data-episode-id]').length;
    await app.until(() => app.shownTitle() === 'Girls' && episodes() > 0, 2000);
    expect(app.showRequests(GIRLS).length, 'після кліку по картці Girls запиту серіалу немає');
    expect(app.shownTitle() === 'Girls', `після кліку по картці Girls #details показує «${short(app.shownTitle() || text(app.details))}»`);
    expect(episodes() === page.episodes.length, `на сторінці Girls ${episodes()} епізодів, очікувалося ${page.episodes.length}`);
    const seasons = app.details.querySelectorAll('[data-season]').length;
    expect(seasons === seasonCount, `на сторінці Girls ${seasons} сезонів, очікувалося ${seasonCount}`);
    const cast = app.details.querySelectorAll('[data-person-id]').length;
    expect(cast === page.cast.length, `на сторінці Girls ${cast} акторів, очікувалося ${page.cast.length}`);
  });

  check('C2.2', 'Усі дані сторінки запитано одразу: один запит з embed або паралельні запити — не один за одним', async () => {
    const app = await withResults();
    const before = app.net.log.length;
    app.net.hold = true;
    await app.open(GIRLS);
    expect(await app.until(() => app.held().length > 0, 1500), 'після кліку по картці Girls запиту немає');
    await sleep(300);
    const first = app.held();
    /** @type {Entry[]} */
    const later = [];
    let pending = first;
    for (let round = 0; pending.length && round < 10; round += 1) {
      for (const entry of pending) {
        await entry.respond();
        await sleep(60);
      }
      pending = app.held();
      later.push(...pending);
    }
    app.net.hold = false;
    const sent = app.net.log.slice(before).filter((entry) => new URL(entry.url).origin === 'https://api.tvmaze.com');
    const strays = sent.filter((entry) => !isShow(GIRLS)(entry.url));
    expect(!strays.length, `запит ${pathOf(strays[0] ?? sent[0])}: усе для сторінки є в /shows/:id з embed або в /shows/:id/episodes і /shows/:id/cast — без запитів по одному епізоду чи актору`);
    const undocumented = sent.filter((entry) => !/^\/shows\/\d+(\/(episodes|cast|seasons|crew|akas|images))?$/.test(new URL(entry.url).pathname));
    expect(!undocumented.length, `запит ${pathOf(undocumented[0] ?? sent[0])}: такого ендпоїнта немає в документації TVmaze`);
    expect(!later.length, `запит ${pathOf(later[0])} надіслано лише після відповіді на ${pathOf(first[0])}: незалежні запити надсилайте одразу (Promise.all) або об'єднайте через embed`);
    expect(sent.length <= 3, `${sent.length} запитів для однієї сторінки: ${sent.map(pathOf).join(', ')}`);
    expect(await app.until(() => app.shownTitle() === 'Girls', 1000), `після відповідей #details показує «${short(app.shownTitle() || text(app.details))}», а не Girls`);
  });

  check('C2.3', 'Поки сторінка завантажується: #details має aria-busy="true" і «Завантаження…»; список результатів на місці й працює', async () => {
    const app = await withResults();
    app.net.hold = true;
    await app.open(GIRLS);
    expect(await app.until(() => app.held().length > 0, 1500), 'після кліку по картці Girls запиту немає');
    await sleep(30);
    expect(busy(app.details), `поки сторінка завантажується, у #details aria-busy="${app.details.getAttribute('aria-busy')}", очікувалося "true"`);
    expect(text(app.details).includes(LOADING), `поки сторінка завантажується, #details показує «${short(text(app.details))}», а не «${LOADING}»`);
    expect(same(app.ids(), girls), `поки сторінка завантажується, у #results ${listed(app.ids())}: результати пошуку мають лишатися`);
    expect(!busy(app.results), 'поки завантажується сторінка серіалу, aria-busy="true" має #results');
    const disabled = app.cards().filter((card) => card.querySelector('button')?.disabled).length;
    expect(!disabled, `поки сторінка завантажується, ${disabled} кнопок карток вимкнено: список має працювати`);
    app.net.hold = false;
    await release(app.held());
    await app.until(() => app.shownTitle() === 'Girls', 1500);
    expect(!busy(app.details), 'після відповіді #details досі має aria-busy="true"');
    expect(!text(app.details).includes(LOADING), `після відповіді #details досі показує «${LOADING}»`);
  });

  check('C2.4', 'Серіал, уже завантажений раніше, відкривається без нового запиту', async () => {
    const app = await withResults();
    await openShown(app, GIRLS);
    await openShown(app, DERRY_GIRLS);
    const before = app.api().length;
    await app.open(GIRLS);
    await sleep(150);
    const extra = app.api().slice(before);
    expect(!extra.length, `повторне відкриття Girls надіслало запит ${pathOf(extra[0] ?? app.api()[0])}: збережіть уже завантажені сторінки (кеш у пам'яті)`);
    expect(app.shownTitle() === 'Girls', `після повторного відкриття #details показує «${short(app.shownTitle() || text(app.details))}»`);
  });

  check('C2.5', 'Якщо вибрати інший серіал, поки попередній завантажується, показується лише останній вибраний', async () => {
    for (const order of ['newer first', 'older first']) {
      const app = await withResults();
      app.net.hold = true;
      await app.open(GIRLS);
      expect(await app.until(() => app.held().some((entry) => isShow(GIRLS)(entry.url)), 1500), 'після кліку по Girls запиту немає');
      await app.open(DERRY_GIRLS);
      expect(await app.until(() => app.held().some((entry) => isShow(DERRY_GIRLS)(entry.url)), 1500), 'після кліку по Derry Girls запиту немає');
      await sleep(30);
      expect(
        !app.retry(app.details) && text(app.details).includes(LOADING),
        `поки Derry Girls завантажується, #details показує «${short(text(app.details))}», а не «${LOADING}»: скасований запит Girls — не помилка (C3.9)`,
      );
      app.net.hold = false;
      const older = app.held().filter((entry) => isShow(GIRLS)(entry.url));
      const newer = app.held().filter((entry) => isShow(DERRY_GIRLS)(entry.url));
      if (order === 'newer first') {
        await release(newer);
        await app.until(() => app.shownTitle() === 'Derry Girls', 1000);
        await release(older);
        await sleep(60);
        expect(app.shownTitle() === 'Derry Girls', `сторінка Girls прийшла після сторінки Derry Girls — і замінила її: #details показує «${short(app.shownTitle() || text(app.details))}»`);
      } else {
        await release(older);
        await sleep(60);
        expect(app.shownTitle() !== 'Girls', 'сторінка Girls прийшла, поки Derry Girls ще завантажувався, — і її показано, хоча вибрано Derry Girls');
        await release(newer);
        await app.until(() => app.shownTitle() === 'Derry Girls', 1000);
        expect(app.shownTitle() === 'Derry Girls', `після відповіді для Derry Girls #details показує «${short(app.shownTitle() || text(app.details))}»`);
      }
      expect(!app.retry(app.details), 'після скасованого запиту #details показує помилку: скасування (AbortError) — не помилка (C3.9)');
    }
  });

  /* ---------------- C3 · Помилки ---------------- */

  check('C3.1', 'HTTP-помилка — не дані: відповідь 4xx/5xx ніколи не показується як результати чи «Нічого не знайдено»', async () => {
    for (const status of [500, 404]) {
      const app = await openApp();
      answer(app, isSearch, { status });
      await app.type('girls');
      await searchSent(app, 'girls');
      await sleep(400);
      const shown = `${text(app.results)} ${app.status()}`;
      expect(!app.cards().length, `відповідь ${status} показано як результати: ${listed(app.ids())}`);
      expect(!shown.includes('Нічого не знайдено'), `відповідь ${status} показано як «Нічого не знайдено»: fetch не відхиляє проміс для 4xx і 5xx — перевірте response.ok (§4.1, експеримент 1)`);
    }
  });

  check('C3.2', '404 для серіалу — «Серіал не знайдено» в #details', async () => {
    const app = await withResults();
    answer(app, isShow(GIRLS), { status: 404 });
    await app.open(GIRLS);
    await shows(app, app.details, NOT_FOUND);
    expect(text(app.details).includes(NOT_FOUND), `на 404 #details показує «${short(text(app.details))}», очікувалося «${NOT_FOUND}»: 404 — не збій, а відповідь «такого серіалу немає»`);
  });

  check('C3.3', '5xx і відповідь не в JSON — «Не вдалося отримати дані від TVmaze.» і «Спробувати ще» (для пошуку — і в статусі)', async () => {
    for (const [spec, cause] of [[{ status: 503 }, 'на відповідь 503'], [{ text: PORTAL }, 'на відповідь 200 з HTML-сторінкою замість JSON']]) {
      const app = await openApp();
      answer(app, isSearch, spec);
      await app.type('girls');
      await searchSent(app, 'girls');
      await shows(app, app.results, SERVER);
      expectError(app, app.results, SERVER, `пошук ${cause}`);
      expect(app.status() === SERVER, `пошук ${cause}: статус «${app.status()}», очікувався «${SERVER}»`);
    }
    const app = await withResults();
    answer(app, isShow(GIRLS), { status: 500 });
    await app.open(GIRLS);
    await shows(app, app.details, SERVER);
    expectError(app, app.details, SERVER, 'сторінка серіалу на відповідь 500');
  });

  check('C3.4', "Збій мережі (fetch відхилено) — «Немає з'єднання з TVmaze.» і «Спробувати ще»", async () => {
    const app = await openApp();
    answer(app, isSearch, { network: true });
    await app.type('girls');
    await searchSent(app, 'girls');
    await shows(app, app.results, OFFLINE);
    expectError(app, app.results, OFFLINE, 'пошук без мережі');
    expect(app.status() === OFFLINE, `пошук без мережі: статус «${app.status()}», очікувався «${OFFLINE}»`);

    const other = await withResults();
    answer(other, isShow(GIRLS), { network: true });
    await other.open(GIRLS);
    await shows(other, other.details, OFFLINE);
    expectError(other, other.details, OFFLINE, 'сторінка серіалу без мережі');
  });

  check('C3.5', '«Спробувати ще» повторює той самий запит; успішна відповідь замінює помилку', async () => {
    const app = await openApp();
    answer(app, isSearch, { status: 503 }, 1);
    await app.type('girls');
    const [failed] = await searchSent(app, 'girls');
    await shows(app, app.results, SERVER);
    const retry = app.retry(app.results);
    expect(retry, `після помилки пошуку в #results немає «Спробувати ще»: «${short(text(app.results))}»`);
    retry.click();
    expect(await app.until(() => app.searches().length > 1, 1500), '«Спробувати ще» в #results не надіслала нового запиту');
    const again = app.searches().at(-1);
    expect(again?.url === failed.url, `«Спробувати ще» надіслала ${pathOf(again)} замість ${pathOf(failed)}`);
    expect(await app.until(() => same(app.ids(), girls), 1500), `після успішної повторної спроби у #results ${listed(app.ids())}`);
    expect(!app.retry(app.results) && !text(app.results).includes(SERVER), 'після успішної повторної спроби помилка лишилася');

    const other = await withResults();
    answer(other, isShow(GIRLS), { status: 500 });
    await other.open(GIRLS);
    await shows(other, other.details, SERVER);
    other.net.script.length = 0;
    const button = other.retry(other.details);
    expect(button, `після помилки сторінки в #details немає «Спробувати ще»: «${short(text(other.details))}»`);
    button.click();
    expect(await other.until(() => other.shownTitle() === 'Girls', 1500), `після «Спробувати ще» #details показує «${short(text(other.details))}», а не сторінку Girls`);
  });

  check('C3.6', '429 — одна автоматична спроба через 2–5 с зі статусом «Забагато запитів до TVmaze, повторюю…»; повторний 429 — помилка', async () => {
    const app = await openApp();
    answer(app, isSearch, { status: 429 }, 1);
    await app.type('girls');
    const [first] = await searchSent(app, 'girls');
    await app.until(() => app.status() === RATE_WAIT, 800);
    expect(app.status() === RATE_WAIT, `після 429 статус «${app.status()}», очікувався «${RATE_WAIT}»`);
    expect(busy(app.results), 'поки застосунок чекає на повторну спробу, #results має бути в стані завантаження (aria-busy="true")');
    await app.until(() => app.searches().length > 1, 5600);
    const second = app.searches()[1];
    expect(second, 'після 429 повторного запиту немає (чекали 5,5 с)');
    const gap = Math.round(second.at - first.at);
    expect(gap >= 1900 && gap <= 5500, `повторний запит надіслано через ${gap} мс після 429; ТЗ — через 2–5 с: документація TVmaze радить почекати кілька секунд`);
    expect(await app.until(() => same(app.ids(), girls), 1500), `після успішної повторної спроби у #results ${listed(app.ids())}`);

    const other = await openApp();
    answer(other, isSearch, { status: 429 }, 2);
    await other.type('girls');
    await searchSent(other, 'girls');
    expect(await other.until(() => other.searches().length > 1, 5600), 'після 429 повторного запиту немає (чекали 5,5 с)');
    await shows(other, other.results, RATE, 1500);
    expectError(other, other.results, RATE, 'після двох 429 поспіль');
    expect(other.status() === RATE, `після двох 429 поспіль статус «${other.status()}», очікувався «${RATE}»`);
    await sleep(5500);
    const sent = other.searches().length;
    expect(sent === 2, `після двох 429 поспіль застосунок надіслав ${sent - 2} запит(и) сам: після другої відмови повторює лише користувач («Спробувати ще»)`);
  });

  check('C3.7', 'Після будь-якого збою завантаження завершено: aria-busy знято, «Завантаження…» немає', async () => {
    /** @type {[string, object][]} */
    const failures = [['500', { status: 500 }], ['збій мережі', { network: true }]];
    for (const [name, spec] of failures) {
      const app = await openApp();
      answer(app, isSearch, spec);
      await app.type('girls');
      await searchSent(app, 'girls');
      await sleep(400);
      expect(!busy(app.results), `пошук, ${name}: #results досі має aria-busy="true"${autoRetried(app, app.results)}`);
      expect(!text(app.results).includes(LOADING) && app.status() !== LOADING, `пошук, ${name}: досі видно «${LOADING}»`);
    }
    for (const [name, spec] of [['404', { status: 404 }], ...failures]) {
      const app = await withResults();
      answer(app, isShow(GIRLS), /** @type {object} */ (spec));
      await app.open(GIRLS);
      await sleep(400);
      expect(!busy(app.details), `сторінка серіалу, ${name}: #details досі має aria-busy="true"${autoRetried(app, app.details)}`);
      expect(!text(app.details).includes(LOADING), `сторінка серіалу, ${name}: #details досі показує «${LOADING}»`);
    }
  });

  check('C3.8', 'Невдалі відповіді не кешуються: повторне відкриття серіалу після помилки надсилає новий запит', async () => {
    const app = await withResults();
    const stop = answer(app, isShow(GIRLS), { status: 500 });
    await app.open(GIRLS);
    await shows(app, app.details, SERVER);
    stop();
    await openShown(app, DERRY_GIRLS);
    const before = app.showRequests(GIRLS).length;
    await app.open(GIRLS);
    await app.until(() => app.shownTitle() === 'Girls', 1500);
    expect(app.showRequests(GIRLS).length > before, 'після невдалого завантаження Girls повторне відкриття не надіслало запиту: у кеш потрапила помилка');
    expect(app.shownTitle() === 'Girls', `після повторного відкриття #details показує «${short(app.shownTitle() || text(app.details))}»`);
  });

  check('C3.9', 'Скасований запит — не помилка; у Console застосунку немає Uncaught і Uncaught (in promise) за жодного сценарію', async () => {
    const app = await openApp();
    app.net.hold = true;
    await app.type('gir');
    const older = await searchSent(app, 'gir');
    await app.type('girls');
    const newer = await searchSent(app, 'girls');
    app.net.hold = false;
    await release([...newer, ...older]);
    expect(await app.until(() => same(app.ids(), girls), 1500), `після «gir» → «girls» у #results ${listed(app.ids())}`);
    expect(!app.retry(app.results), 'після скасованого пошуку #results показує помилку');

    app.net.hold = true;
    await app.open(GIRLS);
    await app.until(() => app.held().length > 0, 1500);
    await app.open(DERRY_GIRLS);
    await app.until(() => app.held().some((entry) => isShow(DERRY_GIRLS)(entry.url)), 1500);
    app.net.hold = false;
    await release(app.held());
    await app.until(() => app.shownTitle() === 'Derry Girls', 1500);
    expect(!app.retry(app.details), 'після скасованого завантаження сторінки #details показує помилку');

    const stop = answer(app, isShow(GIRLS), { network: true });
    await app.open(GIRLS);
    await sleep(300);
    stop();
    answer(app, isSearch, { status: 500 });
    await app.type('dark');
    await searchSent(app, 'dark');
    await sleep(400);
    const errors = app.probe.errors;
    expect(!errors.length, `у Console застосунку: ${errors[0]}${errors.length > 1 ? ` (і ще ${errors.length - 1})` : ''}`);
  });

  check('C3.10', 'Повідомлення — лише тексти з ТЗ: без TypeError, Failed to fetch, кодів статусу, JSON і alert()', async () => {
    /** @type {[string, object][]} */
    const failures = [['збій мережі', { network: true }], ['500', { status: 500 }], ['HTML замість JSON', { text: PORTAL }]];
    for (const [name, spec] of failures) {
      const app = await openApp();
      answer(app, isSearch, spec);
      await app.type('girls');
      await searchSent(app, 'girls');
      await sleep(400);
      const shown = `${text(app.results)} ${app.status()}`;
      const found = shown.match(TECHNICAL);
      expect(!found, `пошук, ${name}: користувач бачить «${short(norm(shown))}» — «${found?.[0]}» лишіть для Console`);
      expect(!app.probe.alerts.length, `пошук, ${name}: alert(«${app.probe.alerts[0]}»): помилку показує область #results`);
    }
    const app = await withResults();
    answer(app, isShow(GIRLS), { network: true });
    await app.open(GIRLS);
    await sleep(400);
    const found = text(app.details).match(TECHNICAL);
    expect(!found, `сторінка серіалу, збій мережі: користувач бачить «${short(text(app.details))}» — «${found?.[0]}» лишіть для Console`);
    expect(!app.probe.alerts.length, `сторінка серіалу, збій мережі: alert(«${app.probe.alerts[0]}»)`);
  });

  return checks;
}
