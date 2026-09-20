function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysElapsed(debtDateISO, now = new Date()) {
  const debtDate = new Date(`${debtDateISO}T00:00:00`);
  const diffMs = startOfDay(now) - startOfDay(debtDate);
  return Math.floor(diffMs / 86400000);
}

function dailyAmount(debtAmount, days) {
  if (days <= 0) return null;
  return (debtAmount / days).toFixed(2);
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function buildMessage(profile, template) {
  const days = daysElapsed(profile.debtDateISO);
  if (days <= 0) {
    return { skip: true, reason: 'future-date', days };
  }
  const amount = dailyAmount(profile.debtAmount, days);
  const text = renderTemplate(template, { days, amount });
  return { skip: false, days, amount, text };
}

module.exports = { daysElapsed, dailyAmount, renderTemplate, buildMessage };
