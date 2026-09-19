function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysElapsed(loanDateISO, now = new Date()) {
  const loanDate = new Date(`${loanDateISO}T00:00:00`);
  const diffMs = startOfDay(now) - startOfDay(loanDate);
  return Math.floor(diffMs / 86400000);
}

function dailyAmount(loanAmount, days) {
  if (days <= 0) return null;
  return (loanAmount / days).toFixed(2);
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function buildMessage(profile, template) {
  const days = daysElapsed(profile.loanDateISO);
  if (days <= 0) {
    return { skip: true, reason: 'future-date', days };
  }
  const amount = dailyAmount(profile.loanAmount, days);
  const text = renderTemplate(template, { days, amount });
  return { skip: false, days, amount, text };
}

module.exports = { daysElapsed, dailyAmount, renderTemplate, buildMessage };
