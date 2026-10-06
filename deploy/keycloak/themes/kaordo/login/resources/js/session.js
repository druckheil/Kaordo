// Defaults native Keycloak sign-in to a remembered session and preserves the device choice
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.querySelector('#kc-form-login input[name="rememberMe"]');
    if (!checkbox) return;

    const preferenceKey = 'kaordo.stay-signed-in';
    let preference;
    try { preference = localStorage.getItem(preferenceKey); } catch { /* Native form still works without storage */ }

    if (preference === 'true' || preference === 'false') checkbox.checked = preference === 'true';
    else if (!document.querySelector('#kc-form-login [aria-invalid="true"]')) checkbox.checked = true;

    checkbox.addEventListener('change', () => {
      try { localStorage.setItem(preferenceKey, String(checkbox.checked)); } catch { /* Keep the current form choice */ }
    });
  }, { once: true });
})();
