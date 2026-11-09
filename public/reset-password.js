const token = new URLSearchParams(window.location.search).get("token") || "";
const form = document.querySelector("#reset-password-form");
const message = document.querySelector("#reset-message");
const returnLink = document.querySelector("#return-to-signin");

function showError(text) {
  message.textContent = text;
  message.dataset.kind = "error";
}

function passwordPolicyError(password) {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 128) return "Use no more than 128 characters.";
  if (!/[A-Z]/.test(password)) return "Include at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Include at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Include at least one special character, such as !, @, or #.";
  return null;
}

if (!token || token.length > 256) {
  showError("This password reset link is invalid. Request a new password reset email.");
} else {
  form.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#new-password").value;
  const confirmation = document.querySelector("#confirm-password").value;
  const policyError = passwordPolicyError(password);

  if (policyError) {
    showError(policyError);
    return;
  }
  if (password !== confirmation) {
    showError("The passwords do not match.");
    return;
  }

  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  message.textContent = "Updating your password…";
  delete message.dataset.kind;

  try {
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not reset your password.");

    form.hidden = true;
    message.textContent = result.message || "Your password has been reset. You can now sign in.";
    message.dataset.kind = "success";
    returnLink.hidden = false;
  } catch (error) {
    showError(error.message === "Failed to fetch" ? "Could not reach the server. Please try again." : error.message);
    submit.disabled = false;
  }
});
