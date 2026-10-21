// Завантажує index.html у фрейм і працює із застосунком так, як користувач: вводить текст,
// надсилає форму, клікає. Код застосунку перевірка не читає — лише DOM, атрибути, тексти й
// запити, які застосунок надсилає.
//
// Сторінка потрапляє у фрейм через srcdoc, щоб до запуску її модулів додати два скрипти:
// невеликий probe (перехоплює alert(), помилки в Console і XMLHttpRequest) і check/net.js —
// підміну fetch, яка відповідає на запити до TVmaze записаними відповідями й дає перевірці
// керувати ними: затримати, повернути помилку, обірвати з'єднання.

export const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Пробіли й переноси — як один пробіл; без пробілів на краях. Апострофи ’ і ʼ — як ': сторінка ТЗ
 * показує «з’єднання» з типографським апострофом, і текст, скопійований з неї, теж правильний.
 */
export const norm = (/** @type {string | null | undefined} */ text) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/[’ʼ]/g, "'").trim();

let html = '';

/** Читає index.html один раз на запуск перевірки. */
export async function loadSource() {
  const response = await fetch('index.html', { cache: 'no-store' });
  if (!response.ok) throw new Error(`index.html: HTTP ${response.status}`);
  html = await response.text();
}

// Виконується у фреймі першим, до будь-якого модуля застосунку.
const PROBE = `(() => {
  const probe = { alerts: [], errors: [], xhr: [], initialStatus: null };
  window.__check = probe;
  window.alert = (message) => { probe.alerts.push(String(message)); };
  window.confirm = (message) => { probe.alerts.push(String(message)); return false; };
  window.prompt = (message) => { probe.alerts.push(String(message)); return null; };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    probe.xhr.push(String(url));
    return open.call(this, method, url, ...rest);
  };
  addEventListener('error', (event) => probe.errors.push(event.message || String(event.error)));
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    probe.errors.push('Uncaught (in promise) ' + (reason && reason.name ? reason.name + ': ' + reason.message : String(reason)));
  });
})();`;

// Виконується наприкінці розбору HTML, до модулів: запам'ятовує live region, що є в самому HTML.
const AFTER_PARSE = `window.__check.initialStatus = document.querySelector('#status');`;

/**
 * @typedef {object} Entry запит застосунку (див. check/net.js)
 * @property {string} url
 * @property {string} method
 * @property {Record<string, string>} headers
 * @property {string} mode
 * @property {string} credentials
 * @property {number} at час надсилання, performance.now() фрейму
 * @property {'pending' | 'answered' | 'failed' | 'blocked' | 'aborted' | 'passed'} state
 * @property {string} blocked чому запит заблоковано як CORS
 * @property {AbortSignal} signal
 * @property {(spec?: object) => Promise<void>} respond
 * @property {() => void} drop
 */

/** Відкриває свіжу копію застосунку. Кожна перевірка працює зі своєю копією. */
export async function openApp() {
  const head = `<script>${PROBE}<\/script><script src="check/net.js"><\/script>`;
  const doc = html
    .replace(/<head(\s[^>]*)?>/i, (tag) => tag + head)
    .replace(/<\/body>/i, `<script>${AFTER_PARSE}<\/script></body>`);

  const frame = document.createElement('iframe');
  frame.title = 'Застосунок ShowFinder під час перевірки';
  const app = new App(frame);
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.addEventListener('load', () => (app.loads += 1));
  frame.srcdoc = doc;
  /** @type {HTMLElement} */ (document.querySelector('#stage')).replaceChildren(frame);
  await loaded;
  app.attach();
  await app.net.ready;
  await sleep(30);
  return app;
}

export class App {
  /** @param {HTMLIFrameElement} frame */
  constructor(frame) {
    this.frame = frame;
    this.loads = 0;
    /** @type {any} */ this.win = null;
    /** @type {Document} */ this.doc = /** @type {any} */ (null);
  }

  attach() {
    this.win = this.frame.contentWindow;
    this.doc = /** @type {Document} */ (this.frame.contentDocument);
  }

  /** @returns {{ alerts: string[], errors: string[], xhr: string[], initialStatus: Element | null }} */
  get probe() {
    return this.win.__check;
  }

  /** @returns {{ log: Entry[], hold: boolean, queue: Entry[], script: { match: (url: string) => boolean, spec: object, times?: number }[], fixtures: any }} */
  get net() {
    return this.win.__net;
  }

  /** Час у фреймі — той самий годинник, що й у записах запитів. */
  now() {
    return this.win.performance.now();
  }

  /** Сторінку перезавантажено або відкрито іншу: стан застосунку втрачено. */
  navigated() {
    return this.loads > 1 || this.frame.contentDocument !== this.doc;
  }

  /** @param {string} selector */
  $(selector) {
    return /** @type {HTMLElement | null} */ (this.doc.querySelector(selector));
  }

  get results() {
    return /** @type {HTMLElement} */ (this.$('#results'));
  }

  get details() {
    return /** @type {HTMLElement} */ (this.$('#details'));
  }

  get query() {
    return /** @type {HTMLInputElement | null} */ (this.$('#search-query'));
  }

  /** Текст live region статусу — того, що є в HTML від початку. */
  status() {
    const initial = this.probe.initialStatus;
    const region = initial?.isConnected ? initial : this.$('#status');
    return norm(region?.textContent);
  }

  cards() {
    return /** @type {HTMLElement[]} */ ([...(this.results?.querySelectorAll('li[data-id]') ?? [])]);
  }

  ids() {
    return this.cards().map((card) => Number(card.dataset.id));
  }

  /** Кнопка картки серіалу в #results. */
  cardButton(/** @type {number} */ id) {
    return /** @type {HTMLButtonElement | null} */ (this.results?.querySelector(`li[data-id="${id}"] button`) ?? null);
  }

  /** Назва серіалу на сторінці в #details, або ''. */
  shownTitle() {
    return norm(this.details?.querySelector('#show-title, h2')?.textContent);
  }

  /** Запити до TVmaze (усі, разом зі скасованими й заблокованими). */
  api(/** @type {RegExp} */ path = /./) {
    return this.net.log.filter((entry) => {
      const url = new URL(entry.url);
      return url.origin === 'https://api.tvmaze.com' && path.test(url.pathname);
    });
  }

  searches() {
    return this.api(/^\/search\/shows\/?$/);
  }

  /** Запити, що стосуються серіалу id: сам серіал, його епізоди, актори тощо. */
  showRequests(/** @type {number} */ id) {
    return this.api(new RegExp(`^/shows/${id}(/|$)`));
  }

  /** Затримані запити, на які ще не відповіли. */
  held(/** @type {RegExp} */ path = /./) {
    return this.net.queue.filter((entry) => entry.state === 'pending' && path.test(new URL(entry.url).pathname));
  }

  /** Вводить текст у поле пошуку: значення змінюється, подія input спливає. */
  async type(/** @type {string} */ text) {
    const input = this.query;
    if (!input) return false;
    input.focus();
    input.value = text;
    input.dispatchEvent(new this.win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    await sleep(15);
    return true;
  }

  /** Enter у полі пошуку: форма надсилається. */
  async submit() {
    const form = /** @type {HTMLFormElement | null} */ (this.$('#search'));
    if (!form) return false;
    form.requestSubmit();
    await sleep(20);
    return true;
  }

  /** Клік по картці серіалу. */
  async open(/** @type {number} */ id) {
    const button = this.cardButton(id);
    if (!button) return false;
    button.focus();
    button.click();
    await sleep(20);
    return true;
  }

  /** Кнопка «Спробувати ще» в області, якщо її видно. */
  retry(/** @type {Element | null} */ region) {
    return /** @type {HTMLButtonElement | null} */ (
      [...(region?.querySelectorAll('button') ?? [])].find((b) => norm(b.textContent) === 'Спробувати ще' && b.getClientRects().length) ?? null
    );
  }

  /** Чекає, доки умова стане істинною. */
  async until(/** @type {() => unknown} */ condition, timeout = 1500) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      if (condition()) return true;
      await sleep(15);
    }
    return Boolean(condition());
  }
}

/** Чи область зайнята: aria-busy="true". */
export const busy = (/** @type {Element | null} */ region) => region?.getAttribute('aria-busy') === 'true';

/** Видимий текст області. */
export const text = (/** @type {Element | null} */ region) => norm(/** @type {HTMLElement | null} */ (region)?.innerText ?? region?.textContent);
