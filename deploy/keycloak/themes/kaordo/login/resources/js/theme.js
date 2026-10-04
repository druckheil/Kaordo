// Applies the app color-mode preference to Keycloak's native credential forms
(() => {
  const modeKey = 'kaordo.color-mode';
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function applyMode() {
    let preference;
    try { preference = localStorage.getItem(modeKey); } catch {}
    const dark = preference === 'dark' || (preference !== 'light' && systemDark.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = 'deep-purple';
  }
  applyMode();
  systemDark.addEventListener('change', applyMode);
  window.addEventListener('storage', (event) => {
    if (event.key === modeKey || event.key === null) applyMode();
  });
})();
