const loginForm = document.querySelector("#login-form");
const signinPill = document.querySelector("#signin-pill");
const identifierInput = document.querySelector("#identifier");
const submitButton = document.querySelector("#submit-button");
const identifierField = document.querySelector("#identifier-field");
const identifierHelp = document.querySelector("#identifier-help");
const passwordField = document.querySelector("#password-field");
const passwordInput = document.querySelector("#password");
const passwordToggle = document.querySelector("#password-toggle");
const passwordToggleLabel = document.querySelector("#password-toggle-label");
const submitLabel = document.querySelector("#submit-label");
const stepDescription = document.querySelector("#step-description");
const formMessage = document.querySelector("#form-message");
const createAccountLink = document.querySelector("#create-account a");
const forgotPasswordLink = document.querySelector(".forgot-password");
const requestAccountForm = document.querySelector("#request-account-form");
const recoveryForm = document.querySelector("#recovery-form");

let passwordStep = false;

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value) && value.length <= 254;
}

function isDiuEmail(value) {
  return /^[^\s@]+@diu\.edu\.bd$/i.test(value);
}

signinPill.addEventListener("click", () => {
  signinPill.style.display = "none";
  loginForm.removeAttribute("hidden");
  loginForm.getBoundingClientRect();
  loginForm.classList.add("is-visible");
  identifierInput.focus();
});

function showPasswordStep() {
  passwordStep = true;
  identifierField.hidden = true;
  passwordField.hidden = false;
  passwordInput.required = true;
  submitLabel.textContent = "Sign in";
  stepDescription.textContent = "Enter the password for your account.";
  formMessage.textContent = "";
  delete formMessage.dataset.kind;
  passwordInput.focus();
}

function showIdentifierStep() {
  passwordStep = false;
  identifierField.hidden = false;
  passwordField.hidden = true;
  passwordInput.required = false;
  passwordInput.value = "";
  submitLabel.textContent = "Continue";
  stepDescription.textContent = "Enter your email address to continue. A DIU email is recommended.";
  identifierHelp.textContent = "A @diu.edu.bd address is recommended, but other valid email addresses are accepted.";
  identifierHelp.dataset.kind = "hint";
  formMessage.textContent = "";
  delete formMessage.dataset.kind;
  identifierInput.focus();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";

  if (!passwordStep) {
    const identifier = identifierInput.value.trim();

    if (!isValidEmail(identifier)) {
      identifierHelp.textContent = "Enter a valid email address.";
      identifierHelp.dataset.kind = "error";
      identifierInput.focus();
      return;
    }

    identifierHelp.textContent = isDiuEmail(identifier)
      ? "DIU university email detected."
      : "You can continue with this email. A @diu.edu.bd address is recommended.";
    identifierHelp.dataset.kind = "hint";
    showPasswordStep();
    return;
  }

  if (!passwordInput.value) {
    passwordInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitLabel.textContent = "Signing in…";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifierInput.value.trim(), password: passwordInput.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign in.");
    window.location.assign("/dashboard.html");
  } catch (error) {
    formMessage.textContent = error.message === "Failed to fetch"
      ? "Could not reach the server. Please try again."
      : error.message;
    formMessage.dataset.kind = "error";
    submitButton.disabled = false;
    submitLabel.textContent = "Sign in";
  }
});

document.querySelector("#change-identifier").addEventListener("click", showIdentifierStep);

passwordToggle.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  passwordToggle.classList.toggle("is-visible", isHidden);
  passwordToggleLabel.textContent = isHidden ? "Hide" : "Show";
  passwordToggle.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  passwordToggle.setAttribute("aria-pressed", String(isHidden));
});

createAccountLink.addEventListener("click", (event) => {
  event.preventDefault();
  loginForm.hidden = true;
  recoveryForm.hidden = true;
  requestAccountForm.hidden = false;
  requestAccountForm.querySelector("input").focus();
});

forgotPasswordLink.addEventListener("click", (event) => {
  event.preventDefault();
  loginForm.hidden = true;
  requestAccountForm.hidden = true;
  recoveryForm.hidden = false;
  document.querySelector("#recovery-email").focus();
});

function returnToSignIn() {
  requestAccountForm.hidden = true;
  recoveryForm.hidden = true;
  loginForm.hidden = false;
  loginForm.classList.add("is-visible");
  showIdentifierStep();
}

document.querySelector("#request-back").addEventListener("click", returnToSignIn);
document.querySelector("#recovery-back").addEventListener("click", returnToSignIn);

requestAccountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("#request-email").value.trim();
  const message = document.querySelector("#request-message");
  if (!isValidEmail(email)) {
    message.textContent = "Enter a valid email address. A @diu.edu.bd address is recommended.";
    message.dataset.kind = "error";
    return;
  }
  message.textContent = "Account requests are managed by a workspace Admin. A @diu.edu.bd address is recommended, but other valid email addresses are accepted.";
  message.dataset.kind = "info";
});

recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const emailInput = document.querySelector("#recovery-email");
  const message = document.querySelector("#recovery-message");
  const submit = recoveryForm.querySelector("button[type='submit']");
  const email = emailInput.value.trim();

  if (!isValidEmail(email)) {
    message.textContent = "Enter a valid email address.";
    message.dataset.kind = "error";
    return;
  }

  submit.disabled = true;
  message.textContent = "Sending recovery instructions…";
  delete message.dataset.kind;

  try {
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not send recovery instructions.");
    message.textContent = result.message || "If an active account exists for that email, password reset instructions will be sent.";
    message.dataset.kind = "info";
  } catch (error) {
    message.textContent = error.message === "Failed to fetch"
      ? "Could not reach the server. Please try again."
      : error.message;
    message.dataset.kind = "error";
  } finally {
    submit.disabled = false;
  }
});
