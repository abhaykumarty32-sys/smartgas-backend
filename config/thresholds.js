const THRESHOLDS = {
  NORMAL_MAX: 500,
  WARNING_MIN: 501,
  CRITICAL_MIN: 900,
};

function getAlertState(gas) {
  const value = Number(gas) || 0;
  if (value >= THRESHOLDS.CRITICAL_MIN) {
    return "Critical";
  }
  if (value > THRESHOLDS.NORMAL_MAX) {
    return "Warning";
  }
  return "Normal";
}

module.exports = {
  THRESHOLDS,
  NORMAL_MAX_GAS: THRESHOLDS.NORMAL_MAX,
  WARNING_GAS: THRESHOLDS.WARNING_MIN,
  CRITICAL_GAS: THRESHOLDS.CRITICAL_MIN,
  getAlertState,
};