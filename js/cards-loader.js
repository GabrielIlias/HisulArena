/* ==========================================================
   cards-loader.js — Fetch and cache cards.json data
   Usage: const data = await loadCards();
          const eliminated = await getEliminated();
          const alive = await getAlive();
   ========================================================== */

let _cardsCache = null;

/**
 * Load and cache all card data from cards.json.
 * Uses root-absolute path so it works from any page depth.
 * @returns {Promise<{eliminated: Array, alive: Array}>}
 */
async function loadCards() {
  if (_cardsCache) return _cardsCache;

  const response = await fetch('/cards.json');

  if (!response.ok) {
    throw new Error(`Failed to load cards.json: ${response.status}`);
  }

  _cardsCache = await response.json();
  return _cardsCache;
}

/**
 * Get only eliminated cards.
 * @returns {Promise<Array>}
 */
async function getEliminated() {
  const data = await loadCards();
  return data.eliminated;
}

/**
 * Get only alive cards.
 * @returns {Promise<Array>}
 */
async function getAlive() {
  const data = await loadCards();
  return data.alive;
}

/**
 * Get a card by id from either array.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getCardById(id) {
  const data = await loadCards();
  return (
    data.eliminated.find(c => c.id === id) ||
    data.alive.find(c => c.id === id) ||
    null
  );
}

/**
 * Invalidate cache (useful after local state updates in betting game).
 */
function invalidateCardsCache() {
  _cardsCache = null;
}

/**
 * Resolve a card image path to a root-relative URL that works from any page.
 * "assets/cards/foo.png"  → "/assets/cards/foo.png"
 * "/assets/cards/foo.png" → "/assets/cards/foo.png"  (already root-relative)
 * Accepts a card object or a raw path string.
 * @param {Object|string} cardOrPath
 * @returns {string}
 */
function getImageUrl(cardOrPath) {
  const src = typeof cardOrPath === 'string'
    ? cardOrPath
    : (cardOrPath && cardOrPath.image) || '';
  if (!src) return '';
  if (src.startsWith('/') || src.startsWith('http')) return src;
  return '/' + src;
}
