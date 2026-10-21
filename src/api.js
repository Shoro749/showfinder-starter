/**
 * Запити до TVmaze API: https://www.tvmaze.com/api. Які ендпоїнти, які відповіді й помилки —
 * ТЗ, §3.2 і §4.
 */

/** Адреса API. */
export const API = 'https://api.tvmaze.com';

/**
 * C1. Шукає серіали за назвою. Повертає масив серіалів (об'єктів show) у порядку відповіді
 * API — те, що приймає renderResults з view.js.
 *
 * @param {string} query
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<object[]>}
 */
export async function searchShows(query, { signal } = {}) {
  const params = new URLSearchParams({ q: query.trim() });
  const response = await fetch(`${API}/search/shows?${params}`, { signal });

  if (!response.ok) {
    const error = new Error(`TVmaze відповів статусом ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (!Array.isArray(data)) throw new TypeError('TVmaze повернув некоректні дані пошуку');
  return data.map((result) => result.show);
}

/**
 * C2. Завантажує серіал з епізодами й акторами. Повертає { show, episodes, cast } — те, що
 * приймає renderShow з view.js.
 *
 * @param {number} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ show: object, episodes: object[], cast: object[] }>}
 */
export async function getShow(id, { signal } = {}) {
  // TODO C2
}
