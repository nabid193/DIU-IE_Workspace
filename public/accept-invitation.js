const token = new URLSearchParams(window.location.search).get("token") || "";
const details = document.querySelector("#invitation-details");
const message = document.querySelector("#invitation-message");
const form = document.querySelector("#accept-invitation-form");

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

if (!token) {
  showError("This invitation link is invalid or expired. Ask the Admin for a new link.");
} else {
  try {
    const response = await fetch(`/api/auth/invitation?token=${encodeURIComponent(token)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "This invitation link is invalid or expired.");
    details.textContent = `Invitation for ${result.invitation.name} (${result.invitation.email}) as ${result.invitation.role}.`;
    form.hidden = false;
  } catch (error) {
    showError(error.message);
  }
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
  message.textContent = "Creating your account…";
  delete message.dataset.kind;

  try {
    const response = await fetch("/api/auth/accept-invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not accept invitation.");
    window.location.assign("/dashboard.html");
  } catch (error) {
    showError(error.message === "Failed to fetch" ? "Could not reach the server." : error.message);
    submit.disabled = false;
  }
});
