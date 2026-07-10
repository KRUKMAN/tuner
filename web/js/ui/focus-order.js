// PURE (Node-safe). Computes the next index for a Tab/Shift+Tab keypress inside a
// focus-trapped container (the tuning/settings sheet — see controls.js). Takes the
// number of currently-focusable elements and the currently-focused element's index
// (-1 when focus isn't on any tracked element, e.g. right after the panel
// re-rendered) and returns the index to focus next, WRAPPING at both ends so focus
// can never escape the trap. No DOM access — controls.js supplies count/index from
// a live query, recomputed on every keypress so it stays correct across re-renders
// (the tuning list and the custom-tuning editor rebuild their DOM on state changes).

/**
 * @param {number} count         number of focusable elements in the trap
 * @param {number} currentIndex  index of the currently-focused element, or -1
 * @param {boolean} shiftKey     true for Shift+Tab (backward)
 * @returns {number} index to focus, or -1 if there is nothing focusable
 */
export function nextFocusIndex(count, currentIndex, shiftKey) {
  if (count <= 0) return -1;
  if (shiftKey) {
    return currentIndex <= 0 ? count - 1 : currentIndex - 1;
  }
  return currentIndex < 0 || currentIndex >= count - 1 ? 0 : currentIndex + 1;
}
