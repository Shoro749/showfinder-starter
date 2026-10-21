// Підміна fetch для самоперевірки й офлайн-режиму. Змінювати цей файл не потрібно.
//
// Скрипт виконується у вікні застосунку до його модулів і замінює window.fetch. Запити до
// https://api.tvmaze.com отримують відповіді із записаних відповідей TVmaze (check/fixtures/),
// тож застосунок працює без мережі й без ліміту запитів. Решту браузер робить як завжди:
//
// - запит, якому потрібен preflight (метод, крім GET/HEAD/POST, або заголовок поза
//   CORS-safelisted, як-от Content-Type: application/json), падає так само, як зі справжнім
//   TVmaze: той відповідає на OPTIONS кодом 405 без заголовків CORS;
// - запит до іншого домену, що не дозволяє CORS (наприклад, www.tvmaze.com), падає;
// - mode: 'no-cors' дає непрозору відповідь: status 0, тіла не прочитати;
// - AbortSignal скасовує запит з AbortError;
// - відповідь має лише ті заголовки, які браузер показує скрипту для чужого домену.
//
// Самоперевірка керує відповідями через window.__net: затримує їх, повертає помилки або
// обриває з'єднання. В офлайн-режимі (offline.html) відповіді приходять через 0,25–0,9 с.
//
// Обидві сторінки відкривають застосунок у srcdoc-фреймі з адресою about:srcdoc. Там
// history.pushState і replaceState з новою адресою (наприклад, ?q=girls) кидають SecurityError,
// хоча в index.html працюють, тож скрипт зберігає стан, але адресу не змінює.
(() => {
  const API = 'https://api.tvmaze.com';
  const script = document.currentScript;
  const offline = script?.hasAttribute('data-offline') ?? false;
  const base = new URL('fixtures/', script?.src ?? new URL('check/net.js', document.baseURI));
  const pageOrigin = new URL(document.baseURI).origin;
  const realFetch = window.fetch.bind(window);

  const net = {
    /** Кожен запит застосунку: { url, method, headers, mode, credentials, at, state, blocked, signal }. */
    log: [],
    /** true — нові запити до API чекають у queue, доки перевірка не відповість на них. */
    hold: false,
    /** Затримані запити: entry.respond(spec?) відповідає, entry.drop() обриває з'єднання. */
    queue: [],
    /** Разові відповіді: { match(url) → boolean, spec, times }. Перша відповідна спрацьовує. */
    script: [],
    /** Затримка автоматичних відповідей, мс. */
    latency: offline ? [250, 900] : [10, 10],
    ready: null,
    fixtures: null,
    answer: null,
  };
  window.__net = net;

  /* ---------------- history у srcdoc-фреймі ---------------- */

  for (const name of ['pushState', 'replaceState']) {
    const original = history[name].bind(history);
    history[name] = function (state, unused, url) {
      try {
        original(state, unused, url);
      } catch (error) {
        if (error?.name !== 'SecurityError') throw error;
        original(state, unused);
      }
    };
  }

  net.ready = Promise.all(
    ['search.json', 'shows.json'].map((name) => realFetch(new URL(name, base), { cache: 'no-store' }).then((r) => r.json())),
  ).then(([search, shows]) => {
    net.fixtures = { search, shows };
  });

  /* ---------------- Відповіді за замовчуванням: записані відповіді TVmaze ---------------- */

  const STATUS = { 200: 'OK', 404: 'Not Found', 405: 'Method Not Allowed', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable' };
  const errorBody = (status) => ({ name: STATUS[status] ?? 'Error', message: '', code: 0, status });

  /** Усі серіали з записаних пошуків — для запитів, яких немає серед записаних. */
  function catalogue() {
    const all = new Map();
    for (const results of Object.values(net.fixtures.search.queries)) {
      for (const { show } of results) all.set(show.id, show);
    }
    return all;
  }

  function search(query) {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return [];
    const recorded = net.fixtures.search.queries[key];
    if (recorded) return recorded;
    return [...catalogue().values()]
      .filter((show) => show.name.toLowerCase().includes(key))
      .slice(0, 10)
      .map((show) => ({ score: show.name.toLowerCase() === key ? 1 : 0.6, show }));
  }

  /** Серіал з епізодами й акторами: записаний повністю або з порожніми списками. */
  function fullShow(id) {
    const recorded = net.fixtures.shows.shows[id];
    if (recorded) return recorded;
    const show = catalogue().get(Number(id));
    return show ? { ...show, _embedded: { episodes: [], cast: [] } } : null;
  }

  function seasonsOf(episodes) {
    const numbers = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
    return numbers.map((number) => ({ id: number, number, episodeOrder: episodes.filter((e) => e.season === number).length }));
  }

  function embedded(full, name) {
    const { episodes, cast } = full._embedded;
    if (name === 'episodes') return episodes;
    if (name === 'cast') return cast;
    if (name === 'seasons') return seasonsOf(episodes);
    if (name === 'nextepisode' || name === 'previousepisode') return undefined;
    return [];
  }

  /** Відповідь, яку дав би TVmaze на цей GET. */
  function answer(url) {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    if (path === '/search/shows') return { body: search(u.searchParams.get('q') ?? '') };
    if (path === '/singlesearch/shows') {
      const [first] = search(u.searchParams.get('q') ?? '');
      return first ? { body: first.show } : { status: 404 };
    }
    let match = path.match(/^\/shows\/(\d+)$/);
    if (match) {
      const full = fullShow(match[1]);
      if (!full) return { status: 404 };
      const { _embedded, ...show } = full;
      const embeds = [...u.searchParams.getAll('embed[]'), ...u.searchParams.getAll('embed')];
      if (!embeds.length) return { body: show };
      return { body: { ...show, _embedded: Object.fromEntries(embeds.map((name) => [name, embedded(full, name)])) } };
    }
    match = path.match(/^\/shows\/(\d+)\/(episodes|cast|seasons|crew|akas|images)$/);
    if (match) {
      const full = fullShow(match[1]);
      return full ? { body: embedded(full, match[2]) } : { status: 404 };
    }
    return { status: 404 };
  }
  net.answer = answer;

  /* ---------------- Відповідь у формі Response ---------------- */

  /**
   * spec: { status = 200, body, text, contentType } — JSON-тіло, або текст (наприклад, HTML
   * сторінки проксі), або { network: true } — з'єднання обірвано.
   */
  function toResponse(url, spec) {
    const status = spec.status ?? 200;
    const text = spec.text ?? JSON.stringify(spec.body ?? errorBody(status));
    const contentType = spec.contentType ?? (spec.text === undefined ? 'application/json; charset=UTF-8' : 'text/html; charset=UTF-8');
    // Лише CORS-safelisted заголовки: інших (date, server) браузер скрипту чужого домену не показує.
    const response = new Response(text, {
      status,
      statusText: STATUS[status] ?? '',
      headers: { 'content-type': contentType, 'cache-control': 'public, max-age=3600' },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }

  function opaque() {
    const response = new Response(null, { status: 200 });
    for (const [name, value] of Object.entries({ type: 'opaque', status: 0, ok: false, statusText: '', url: '' })) {
      Object.defineProperty(response, name, { value });
    }
    return response;
  }

  /* ---------------- CORS ---------------- */

  const SIMPLE_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

  /** Заголовки запиту, через які браузер надішле preflight (OPTIONS). */
  function preflightHeaders(headers) {
    const reasons = [];
    headers.forEach((value, name) => {
      if (['accept', 'accept-language', 'content-language'].includes(name)) return;
      if (name === 'content-type' && SIMPLE_TYPES.includes(value.split(';')[0].trim().toLowerCase())) return;
      reasons.push(`${name}: ${value}`);
    });
    return reasons;
  }

  const corsError = (url, why) =>
    console.error(`Access to fetch at '${url}' from origin '${pageOrigin}' has been blocked by CORS policy: ${why}`);

  /* ---------------- fetch ---------------- */

  const delay = () => net.latency[0] + Math.random() * (net.latency[1] - net.latency[0]);

  function takeScript(url) {
    const index = net.script.findIndex((rule) => rule.match(url));
    if (index === -1) return null;
    const rule = net.script[index];
    rule.times = (rule.times ?? 1) - 1;
    if (rule.times <= 0) net.script.splice(index, 1);
    return rule.spec;
  }

  window.fetch = function fetch(input, init) {
    let request;
    try {
      request = new Request(input, init);
    } catch (error) {
      return Promise.reject(error);
    }
    const url = request.url;
    const headers = {};
    request.headers.forEach((value, name) => (headers[name] = value));
    const entry = {
      url,
      method: request.method,
      headers,
      mode: request.mode,
      credentials: request.credentials,
      at: performance.now(),
      state: 'pending',
      blocked: '',
      signal: request.signal,
      respond: () => {},
      drop: () => {},
    };
    net.log.push(entry);

    // Свої файли (не API) завантажує справжній fetch.
    if (new URL(url).origin === pageOrigin) {
      entry.state = 'passed';
      return realFetch(input, init);
    }

    return new Promise((resolve, reject) => {
      const signal = request.signal;
      const settle = (fn) => {
        if (entry.state !== 'pending') return;
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () =>
        settle(() => {
          entry.state = 'aborted';
          reject(signal.reason ?? new DOMException('signal is aborted without reason', 'AbortError'));
        });
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);

      const failNetwork = (blocked = '') =>
        settle(() => {
          entry.state = blocked ? 'blocked' : 'failed';
          entry.blocked = blocked;
          reject(new TypeError('Failed to fetch'));
        });
      const succeed = (response) =>
        settle(() => {
          entry.state = 'answered';
          resolve(response);
        });
      const later = (fn) => setTimeout(fn, 5);

      const target = new URL(url);
      if (request.mode === 'same-origin') {
        later(() => failNetwork(`mode: 'same-origin' для іншого домену`));
        return;
      }
      if (request.mode === 'no-cors') {
        later(() => succeed(opaque()));
        return;
      }
      if (target.origin !== API) {
        later(() => {
          corsError(url, `No 'Access-Control-Allow-Origin' header is present on the requested resource.`);
          failNetwork(`${target.origin} не дозволяє CORS`);
        });
        return;
      }
      const preflight = preflightHeaders(request.headers);
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) preflight.unshift(`метод ${request.method}`);
      if (preflight.length) {
        later(() => {
          corsError(url, `Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.`);
          failNetwork(`preflight (OPTIONS → 405) через ${preflight.join(', ')}`);
        });
        return;
      }
      if (request.credentials === 'include') {
        later(() => {
          corsError(url, `The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.`);
          failNetwork(`credentials: 'include' з Access-Control-Allow-Origin: *`);
        });
        return;
      }

      const scripted = takeScript(url);
      const reply = async (spec) => {
        await net.ready;
        if (request.method !== 'GET' && request.method !== 'HEAD') spec = { status: 405 };
        spec = spec ?? answer(url);
        if (spec.network) failNetwork();
        else succeed(toResponse(url, spec));
      };
      entry.respond = (spec) => reply(spec ?? scripted);
      entry.drop = () => failNetwork();
      if (net.hold) net.queue.push(entry);
      else setTimeout(() => reply(scripted), delay());
    });
  };
})();
