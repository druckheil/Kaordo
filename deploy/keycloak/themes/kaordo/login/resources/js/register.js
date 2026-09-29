// Keycloak's built-in password validator requires password-confirm in the POST body.
// Add it to the form payload without showing a confirmation field to the user.
export function addPasswordConfirmation(formData, password) {
  formData.set('password-confirm', password);
}

if (typeof document !== 'undefined') {
  const form = document.getElementById('kc-register-form');
  const password = document.getElementById('password');
  if (form && password) {
    form.addEventListener('formdata', (event) => {
      addPasswordConfirmation(event.formData, password.value);
    });
  }
}
