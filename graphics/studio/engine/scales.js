// Predefined broadcast color scales matching the reference graphics. Each scale
// is an ordered list of { id, label, color } stops. Deterministic palettes.

export const THREAT_SCALE = [
  { id: 1, label: '1.Low', color: '#2e9e2e' },
  { id: 2, label: '2.Limited', color: '#ffd400' },
  { id: 3, label: '3.Elevated', color: '#ff8a00' },
  { id: 4, label: '4.Significant', color: '#ff2a2a' },
  { id: 5, label: '5.Extreme', color: '#d400d4' },
];

export const OUTLOOK_SCALE = [
  { id: 'TSTM', label: 'T-STORM', color: '#86d486' },
  { id: 'MRGL', label: 'MARGINAL', color: '#2f8f3a' },
  { id: 'SLGT', label: 'SLIGHT', color: '#f7e733' },
  { id: 'ENH', label: 'ENHANCED', color: '#ef9a32' },
  { id: 'MDT', label: 'MODERATE', color: '#e74c3c' },
  { id: 'HIGH', label: 'HIGH', color: '#d400d4' },
];

export const PRECIP_SCALE = [
  { id: 'rain', label: 'RAIN', color: '#27c24c' },
  { id: 'snow', label: 'SNOW', color: '#29b6f6' },
  { id: 'mix', label: 'MIX', color: '#ff6fb5' },
  { id: 'frz', label: 'FRZ RAIN', color: '#b388ff' },
  { id: 'tstm', label: 'TSTMS', color: '#ffa000' },
  { id: 'svr', label: 'SEVERE', color: '#e53935' },
];

export const CONDITIONS_SCALE = [
  { id: 'sunny', label: 'SUNNY', color: '#ffd200' },
  { id: 'pcloudy', label: 'P. CLOUDY', color: '#9fb6cc' },
  { id: 'cloudy', label: 'CLOUDY', color: '#7d8a98' },
  { id: 'showers', label: 'SHOWERS', color: '#27c24c' },
  { id: 'storms', label: 'STORMS', color: '#ff7a00' },
  { id: 'snow', label: 'SNOW', color: '#7fdcff' },
];

export const ICE_SCALE = [
  { value: '.10', color: '#ffe082' },
  { value: '.25', color: '#ffb300' },
  { value: '.50', color: '#fb8c00' },
  { value: '.75', color: '#f4511e' },
  { value: '1.0', color: '#b71c1c' },
  { value: '1.5', color: '#ff2bd6' },
  { value: '2.0', color: '#9c27b0' },
  { value: '2.5', color: '#1e88e5' },
  { value: '3.0', color: '#0d47a1' },
];

// Templates start from a built-in scale but the studio lets users rename levels
// and recolor them; those edits live on config._scale (same ids, new label/color).
// effectiveScale returns the user's edited scale when present, else the base.
export function effectiveScale(base, config) {
  return (config && config._scale) || base;
}

export function scaleColor(scale, id) {
  const s = scale.find((x) => x.id === id || x.value === id);
  if (s) return s.color;
  // Custom-color brush stores a raw hex string as the value; paint it directly
  // so any template's choropleth can render user-chosen colors.
  if (typeof id === 'string' && /^#[0-9a-f]{3,8}$/i.test(id)) return id;
  return null;
}
