/**
 * Показ даних TVmaze. Наданий модуль: не змінюйте його.
 *
 * Модуль не робить запитів і нічого не знає про завантаження чи помилки: він показує лише
 * ті дані, які йому передали. Запити (src/api.js), стани завантаження, порожнього результату
 * й помилки та обробники подій (src/app.js) — ваша частина роботи.
 *
 * Обидві функції приймають об'єкти у формі відповідей TVmaze API (https://www.tvmaze.com/api):
 * поля, яких немає (`null`), показують як «—» чи «невідомо». Перед показом функції
 * перевіряють аргументи й кидають TypeError з поясненням, якщо форма даних не та.
 */

/**
 * @typedef {object} Show серіал — об'єкт `show` з відповіді TVmaze (поля, які показує модуль)
 * @property {number} id
 * @property {string} name
 * @property {string} url сторінка серіалу на TVmaze
 * @property {string[]} genres
 * @property {string | null} premiered дата прем'єри, "2012-04-15"
 * @property {string | null} ended
 * @property {{ average: number | null }} rating
 * @property {{ name: string } | null} network телеканал
 * @property {{ name: string } | null} webChannel стримінг, якщо телеканалу немає
 * @property {{ medium: string } | null} image
 * @property {string | null} summary опис — HTML-розмітка TVmaze (`<p>`, `<b>`, `<i>`)
 */

/**
 * @typedef {object} Episode епізод — як у `/shows/:id/episodes`
 * @property {number} id
 * @property {string} name
 * @property {number} season
 * @property {number | null} number `null` у спецвипусків
 * @property {string | null} airdate
 */

/**
 * @typedef {object} CastMember актор і роль — як у `/shows/:id/cast`
 * @property {{ id: number, name: string }} person
 * @property {{ id: number, name: string }} character
 */

/**
 * Показує серіали карткою-кнопкою кожен, у тому самому порядку, і замінює вміст `container`.
 * Кожна картка — `<li data-id="<id>">` з кнопкою `[data-action="open"]`. Що відбувається
 * після натискання — вирішує ваш код.
 *
 * Порожній масив дає порожній список: повідомлення «нічого не знайдено» показуєте ви.
 *
 * @param {Element} container зазвичай `#results`
 * @param {readonly Show[]} shows серіали, а не відповідь пошуку цілком
 */
export function renderResults(container, shows) {
  requireElement('renderResults', container);
  if (!Array.isArray(shows)) {
    fail('renderResults', 'shows', 'очікувався масив серіалів', shows);
  }
  shows.forEach((show, index) => requireShow('renderResults', `shows[${index}]`, show));

  const list = el('ul', { class: 'cards' });
  for (const show of shows) {
    const button = el('button', { type: 'button', class: 'card', 'data-action': 'open' }, [
      poster(show, 'card__image'),
      el('span', { class: 'card__body' }, [
        el('span', { class: 'card__title', lang: 'en' }, [show.name]),
        el('span', { class: 'card__meta' }, [meta(show)]),
        el('span', { class: 'card__genres', lang: 'en' }, [genres(show)]),
      ]),
    ]);
    list.append(el('li', { 'data-id': String(show.id) }, [button]));
  }
  container.replaceChildren(list);
}

/**
 * Показує сторінку серіалу: назву, дані, опис, епізоди за сезонами й акторів, — і замінює
 * вміст `container`. Заголовок сторінки — `<h2 id="show-title">` з назвою серіалу.
 *
 * @param {Element} container зазвичай `#details`
 * @param {{ show: Show, episodes: readonly Episode[], cast: readonly CastMember[] }} data
 */
export function renderShow(container, data) {
  requireElement('renderShow', container);
  if (!data || typeof data !== 'object') {
    fail('renderShow', 'другий аргумент', 'очікувався об\'єкт { show, episodes, cast }', data);
  }
  const { show, episodes, cast } = data;
  requireShow('renderShow', 'show', show);
  const missing = 'Епізоди й актори — окремі дані, а не поля об\'єкта show: див. документацію TVmaze API';
  if (!Array.isArray(episodes)) fail('renderShow', 'episodes', 'очікувався масив епізодів', episodes, missing);
  if (!Array.isArray(cast)) fail('renderShow', 'cast', 'очікувався масив акторів', cast, missing);
  episodes.forEach((episode, index) => {
    if (!episode || typeof episode.id !== 'number' || typeof episode.season !== 'number') {
      fail('renderShow', `episodes[${index}]`, 'очікувався епізод з числовими id і season', episode);
    }
  });
  cast.forEach((member, index) => {
    if (!member?.person || !member?.character) {
      fail('renderShow', `cast[${index}]`, 'очікувався об\'єкт { person, character }', member);
    }
  });

  const title = el('h2', { id: 'show-title', class: 'show__title', lang: 'en', tabindex: '-1' }, [show.name]);
  const head = el('div', { class: 'show__head' }, [
    poster(show, 'show__image'),
    el('div', { class: 'show__intro' }, [
      title,
      el('p', { class: 'show__meta' }, [meta(show)]),
      el('p', { class: 'show__genres', lang: 'en' }, [genres(show)]),
      el('p', {}, [el('a', { href: show.url }, ['Сторінка серіалу на TVmaze'])]),
    ]),
  ]);

  const article = el('article', { class: 'show', 'aria-labelledby': 'show-title' }, [
    head,
    summary(show.summary),
    el('h3', {}, ['Епізоди']),
    seasons(episodes),
    el('h3', {}, ['У ролях']),
    people(cast),
  ]);
  container.replaceChildren(article);
}

/* ---------------- Частини сторінки ---------------- */

/** @param {Show} show @param {string} className */
function poster(show, className) {
  if (!show.image?.medium) return el('span', { class: `${className} poster--none`, 'aria-hidden': 'true' });
  return el('img', { class: className, src: show.image.medium, alt: '', width: '210', height: '295', loading: 'lazy' });
}

/** «2012–2017 · HBO · оцінка 6.5». */
function meta(/** @type {Show} */ show) {
  const from = show.premiered?.slice(0, 4);
  const to = show.ended?.slice(0, 4);
  const years = !from ? 'рік невідомий' : !to ? `з ${from}` : from === to ? from : `${from}–${to}`;
  const channel = show.network?.name ?? show.webChannel?.name ?? '—';
  const rating = show.rating?.average ?? '—';
  return `${years} · ${channel} · оцінка ${rating}`;
}

const genres = (/** @type {Show} */ show) => (show.genres?.length ? show.genres.join(', ') : '—');

/** Опис TVmaze — HTML. Його розбирає інертний документ, а на сторінку потрапляє лише текст. */
function summary(/** @type {string | null} */ html) {
  const box = el('div', { class: 'show__summary', lang: 'en' });
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const paragraphs = [...doc.body.querySelectorAll('p')];
  const blocks = paragraphs.length ? paragraphs : [doc.body];
  const texts = blocks.map((block) => block.textContent?.trim() ?? '').filter(Boolean);
  if (!texts.length) box.append(el('p', { lang: 'uk' }, ['Опису немає.']));
  for (const text of texts) box.append(el('p', {}, [text]));
  return box;
}

/** Епізоди за сезонами: кожен сезон — <details data-season>. */
function seasons(/** @type {readonly Episode[]} */ episodes) {
  if (!episodes.length) return el('p', { class: 'empty' }, ['Епізодів немає.']);
  /** @type {Map<number, Episode[]>} */
  const bySeason = new Map();
  for (const episode of episodes) {
    bySeason.set(episode.season, [...(bySeason.get(episode.season) ?? []), episode]);
  }
  const wrap = el('div', { class: 'seasons' });
  for (const [season, list] of [...bySeason].sort(([a], [b]) => a - b)) {
    const items = list.map((episode) =>
      el('li', { class: 'episode', 'data-episode-id': String(episode.id) }, [
        el('span', { class: 'episode__code' }, [code(episode)]),
        ' ',
        el('span', { lang: 'en' }, [episode.name || '—']),
        ' ',
        el('span', { class: 'episode__date' }, [date(episode.airdate)]),
      ]),
    );
    wrap.append(
      el('details', { class: 'season', 'data-season': String(season) }, [
        el('summary', {}, [`Сезон ${season} · ${count(list.length)}`]),
        el('ol', { class: 'episodes' }, items),
      ]),
    );
  }
  return wrap;
}

function people(/** @type {readonly CastMember[]} */ cast) {
  if (!cast.length) return el('p', { class: 'empty' }, ['Акторів немає.']);
  return el(
    'ul',
    { class: 'cast' },
    cast.map(({ person, character }) =>
      el('li', { 'data-person-id': String(person.id) }, [
        el('span', { lang: 'en' }, [person.name]),
        ' — ',
        el('span', { class: 'cast__role', lang: 'en' }, [character.name]),
      ]),
    ),
  );
}

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
const code = (/** @type {Episode} */ e) => (e.number === null ? `S${pad(e.season)} · спецвипуск` : `S${pad(e.season)}E${pad(e.number)}`);
const date = (/** @type {string | null} */ iso) => (iso ? iso.split('-').reverse().join('.') : 'дата невідома');

/** «1 епізод», «3 епізоди», «10 епізодів». */
function count(/** @type {number} */ n) {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return `${n} епізод`;
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${n} епізоди`;
  return `${n} епізодів`;
}

/* ---------------- Перевірка аргументів ---------------- */

function requireElement(/** @type {string} */ fn, /** @type {unknown} */ container) {
  if (!(container instanceof Element)) {
    fail(fn, 'container', 'очікувався елемент сторінки, наприклад document.querySelector(\'#results\')', container);
  }
}

function requireShow(/** @type {string} */ fn, /** @type {string} */ name, /** @type {any} */ show) {
  if (show && typeof show === 'object' && 'show' in show && 'score' in show) {
    fail(fn, name, 'очікувався серіал', show, 'Це елемент відповіді пошуку { score, show }: серіал — у його полі show');
  }
  if (!show || typeof show.id !== 'number' || typeof show.name !== 'string') {
    fail(fn, name, 'очікувався серіал з числовим id і назвою name', show);
  }
}

/**
 * @param {string} fn @param {string} name @param {string} expected @param {unknown} value
 * @param {string} [hint]
 * @returns {never}
 */
function fail(fn, name, expected, value, hint) {
  throw new TypeError(`${fn}: ${name} — ${expected}, отримано ${describe(value)}.${hint ? ` ${hint}.` : ''}`);
}

/** Коротко: тип і початок значення. */
function describe(/** @type {unknown} */ value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `масив з ${value.length} елементів`;
  if (typeof value !== 'object') return `${JSON.stringify(value)} (${typeof value})`;
  if (value instanceof Element) return `<${value.tagName.toLowerCase()}>`;
  const text = JSON.stringify(value) ?? String(value);
  return `об'єкт ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
}

/**
 * Елемент з атрибутами й дітьми; рядки стають текстовими вузлами.
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
