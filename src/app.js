/**
 * Поведінка ShowFinder: пошук (C1), сторінка серіалу (C2), помилки й повторні спроби (C3).
 * Тут — обробники подій, життєвий цикл кожного запиту й стани областей #results і #details:
 * завантаження, результат, порожній результат, помилка. Специфікація — ТЗ, §3–4.
 */
import { getShow, searchShows } from './api.js';
import { renderResults, renderShow } from './view.js';

/** Підключає форму пошуку #search і області #results та #details. main.js викликає її один раз. */
export function initApp() {
  const form = document.querySelector('#search');
  const input = document.querySelector('#search-query');
  const results = document.querySelector('#results');
  const details = document.querySelector('#details');
  const status = document.querySelector('#status');

  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement) || !(results instanceof Element) || !(details instanceof Element) || !(status instanceof Element)) return;

  let timer = 0;
  let requestNumber = 0;
  /** @type {AbortController | null} */
  let controller = null;
  let lastQuery = '';
  let detailsController = null;
  let detailsRequestNumber = 0;
  let selectedId = null;
  const showCache = new Map();

  const setBusy = (busy) => {
    if (busy) results.setAttribute('aria-busy', 'true');
    else results.removeAttribute('aria-busy');
  };

  const state = (templateId, message = '') => {
    const template = document.querySelector(`#${templateId}`);
    if (!(template instanceof HTMLTemplateElement)) return;
    const content = template.content.cloneNode(true);
    if (message) content.querySelector('.state__text, .state--message')?.append(message);
    results.replaceChildren(content);
  };

  const detailsState = (templateId, message = '') => {
    const template = document.querySelector(`#${templateId}`);
    if (!(template instanceof HTMLTemplateElement)) return;
    const content = template.content.cloneNode(true);
    if (message) content.querySelector('.state__text, .state--message')?.append(message);
    details.replaceChildren(content);
  };

  const showError = (message) => {
    setBusy(false);
    state('state-error', message);
    status.textContent = message;
  };

  const showDetailsError = (message, retry = true) => {
    detailsState(retry ? 'state-error' : 'state-message', message);
    details.removeAttribute('aria-busy');
  };

  const messageFor = (error) => {
    if (error?.status === 429) return 'Забагато запитів до TVmaze.';
    if (error?.status === 404) return 'Серіал не знайдено';
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) return "Немає з'єднання з TVmaze.";
    return 'Не вдалося отримати дані від TVmaze.';
  };

  const wait = (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      const timerId = window.setTimeout(resolve, milliseconds);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timerId);
        reject(signal.reason ?? new DOMException('Запит скасовано', 'AbortError'));
      }, { once: true });
    });

  const search = async (immediate = false) => {
    window.clearTimeout(timer);
    const query = input.value.trim();
    lastQuery = query;
    requestNumber += 1;
    const current = requestNumber;
    controller?.abort();
    controller = null;

    if (query.length < 2) {
      setBusy(false);
      results.replaceChildren();
      status.textContent = '';
      return;
    }

    const run = async () => {
      const requestController = new AbortController();
      controller = requestController;
      setBusy(true);
      state('state-loading');
      status.textContent = 'Завантаження…';

      try {
        let shows;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            shows = await searchShows(query, { signal: requestController.signal });
            break;
          } catch (error) {
            if (error?.status !== 429 || attempt > 0) throw error;
            status.textContent = 'Забагато запитів до TVmaze, повторюю…';
            await wait(2500, requestController.signal);
          }
        }

        if (current !== requestNumber || query !== lastQuery) return;
        setBusy(false);
        if (!shows.length) {
          const message = `Нічого не знайдено за запитом «${query}»`;
          state('state-message', message);
          status.textContent = message;
          return;
        }
        renderResults(results, shows);
        status.textContent = `Знайдено: ${shows.length}`;
      } catch (error) {
        if (error?.name === 'AbortError' || current !== requestNumber) return;
        showError(messageFor(error));
      } finally {
        if (current === requestNumber) setBusy(false);
      }
    };

    if (immediate) await run();
    else timer = window.setTimeout(run, 450);
  };

  const openShow = async (id, force = false) => {
    selectedId = id;
    detailsRequestNumber += 1;
    const current = detailsRequestNumber;
    detailsController?.abort();
    detailsController = null;

    if (!force && showCache.has(id)) {
      details.removeAttribute('aria-busy');
      renderShow(details, showCache.get(id));
      return;
    }

    const requestController = new AbortController();
    detailsController = requestController;
    details.setAttribute('aria-busy', 'true');
    detailsState('state-loading');

    try {
      let data;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          data = await getShow(id, { signal: requestController.signal });
          break;
        } catch (error) {
          if (error?.status !== 429 || attempt > 0) throw error;
          await wait(2500, requestController.signal);
        }
      }

      if (current !== detailsRequestNumber || selectedId !== id) return;
      showCache.set(id, data);
      renderShow(details, data);
    } catch (error) {
      if (error?.name === 'AbortError' || current !== detailsRequestNumber) return;
      if (error?.status === 404) showDetailsError('Серіал не знайдено', false);
      else showDetailsError(messageFor(error));
    } finally {
      if (current === detailsRequestNumber) details.removeAttribute('aria-busy');
    }
  };

  input.addEventListener('input', () => void search());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void search(true);
  });

  results.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.action === 'retry') void search(true);
    if (button.dataset.action === 'open') {
      const card = button.closest('[data-id]');
      const id = Number(card?.getAttribute('data-id'));
      if (Number.isInteger(id)) void openShow(id);
    }
  });

  details.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.dataset.action === 'retry' && selectedId !== null) {
      void openShow(selectedId, true);
    }
  });
}
