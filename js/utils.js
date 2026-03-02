/* ==========================================================
   utils.js — Shared utility functions
   ========================================================== */

/**
 * Fisher-Yates shuffle — returns new shuffled array.
 * @param {Array} array
 * @returns {Array}
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick a random element from an array.
 * @param {Array} array
 * @returns {*}
 */
function randomPick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Format seconds as MM:SS string.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Save value to localStorage under namespaced key.
 * @param {string} key
 * @param {*} value
 */
function saveToStorage(key, value) {
  try {
    localStorage.setItem(`hisularena_${key}`, JSON.stringify(value));
  } catch (e) {
    console.warn('localStorage unavailable:', e);
  }
}

/**
 * Load value from localStorage. Returns defaultValue if missing or invalid.
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
function loadFromStorage(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(`hisularena_${key}`);
    return item !== null ? JSON.parse(item) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Remove a namespaced key from localStorage.
 * @param {string} key
 */
function removeFromStorage(key) {
  try {
    localStorage.removeItem(`hisularena_${key}`);
  } catch (e) {}
}

/**
 * Show a toast notification.
 * Expects a <div class="toast" id="toast"> in the DOM.
 * @param {string} message
 * @param {number} duration  ms, default 3000
 */
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), duration);
}

/**
 * Delay execution.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clamp a number between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generate a random alphanumeric room code for War game.
 * @param {number} length  default 6
 * @returns {string}
 */
function generateRoomCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => randomPick([...chars])).join('');
}
