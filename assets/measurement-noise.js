(() => {
  'use strict';

  // Two independent uniform draws give bounded, zero-centred triangular error.
  // The half-width is in the units of the instrument reading.
  function sample(value, halfWidth, { min = -Infinity, max = Infinity } = {}) {
    if (!Number.isFinite(value) || !Number.isFinite(halfWidth) || halfWidth <= 0) return value;
    const error = (Math.random() + Math.random() - 1) * halfWidth;
    return Math.min(max, Math.max(min, value + error));
  }

  function createSampler() {
    const readings = new Map();
    return {
      read(key, value, halfWidth, { min = -Infinity, max = Infinity } = {}) {
        const last = readings.get(key);
        if (last && last.value === value && last.halfWidth === halfWidth && last.min === min && last.max === max) {
          return last.measured;
        }
        const measured = sample(value, halfWidth, { min, max });
        readings.set(key, { value, halfWidth, min, max, measured });
        return measured;
      },
      reset(key) {
        if (key === undefined) readings.clear();
        else readings.delete(key);
      }
    };
  }

  window.PhysLabNoise = Object.freeze({ sample, createSampler });
})();
