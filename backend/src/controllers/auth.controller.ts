import type { Request, Response, NextFunction } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../auth.js';

let handler: any = null;

export const betterAuthHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!handler && auth) {
    handler = toNodeHandler(auth);
  }
  
  if (handler) {
    return handler(req, res, next);
  }
  
  next();
};

export const resetPasswordWebController = (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset Password &bull; Chatuk</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #0F172A;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #F8FAFC;
      padding: 24px 16px;
      position: relative;
      overflow-x: hidden;
    }
    .background-blob-1 {
      position: absolute;
      top: -100px;
      left: -100px;
      width: 380px;
      height: 380px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.22) 0%, rgba(15, 23, 42, 0) 70%);
      pointer-events: none;
    }
    .background-blob-2 {
      position: absolute;
      bottom: -120px;
      right: -80px;
      width: 440px;
      height: 440px;
      background: radial-gradient(circle, rgba(168, 85, 247, 0.2) 0%, rgba(15, 23, 42, 0) 70%);
      pointer-events: none;
    }
    .card {
      position: relative;
      width: 100%;
      max-width: 440px;
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      z-index: 10;
    }
    .brand-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .brand-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6366F1 0%, #A855F7 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
    }
    .brand-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #FFFFFF 0%, #E2E8F0 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-subtitle {
      font-size: 13px;
      color: #94A3B8;
    }
    .title {
      font-size: 20px;
      font-weight: 600;
      color: #F8FAFC;
      margin-bottom: 8px;
    }
    .description {
      font-size: 14px;
      color: #94A3B8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    .label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #CBD5E1;
      margin-bottom: 8px;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input {
      width: 100%;
      height: 48px;
      background: #131B2E;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 0 44px 0 16px;
      font-size: 15px;
      color: #F8FAFC;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .input:focus {
      border-color: #6366F1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
    }
    .toggle-visibility-btn {
      position: absolute;
      right: 12px;
      background: transparent;
      border: none;
      color: #94A3B8;
      cursor: pointer;
      padding: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }
    .toggle-visibility-btn:hover {
      color: #F8FAFC;
    }
    .strength-container {
      margin-top: 8px;
    }
    .strength-bars {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
    }
    .strength-bar {
      height: 4px;
      flex: 1;
      border-radius: 2px;
      background: #334155;
      transition: background-color 0.2s ease;
    }
    .strength-label {
      font-size: 12px;
      color: #94A3B8;
    }
    .error-banner {
      display: none;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 13px;
      color: #FCA5A5;
      line-height: 1.4;
      margin-bottom: 20px;
    }
    .match-status {
      font-size: 12px;
      margin-top: 6px;
      display: none;
    }
    .submit-btn {
      width: 100%;
      height: 48px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #6366F1 0%, #A855F7 100%);
      color: #FFFFFF;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
      transition: transform 0.1s ease, opacity 0.15s ease;
      margin-top: 26px;
    }
    .submit-btn:hover {
      opacity: 0.95;
    }
    .submit-btn:active {
      transform: scale(0.98);
    }
    .submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #FFFFFF;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: none;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .success-view {
      display: none;
      text-align: center;
      padding: 12px 0;
    }
    .success-icon-badge {
      width: 64px;
      height: 64px;
      border-radius: 32px;
      background: rgba(16, 185, 129, 0.15);
      border: 2px solid #10B981;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px auto;
      color: #10B981;
    }
    .action-links {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 24px;
    }
    .app-link-btn {
      display: block;
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366F1 0%, #A855F7 100%);
      color: #FFFFFF;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }
    .secondary-link {
      font-size: 13px;
      color: #94A3B8;
      text-decoration: none;
      text-align: center;
    }
    .secondary-link:hover {
      color: #CBD5E1;
    }
  </style>
</head>
<body>
  <div class="background-blob-1"></div>
  <div class="background-blob-2"></div>

  <div class="card">
    <div class="brand-header">
      <div class="brand-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <div>
        <h1 class="brand-title">Chatuk</h1>
        <p class="brand-subtitle">Private & End-to-End Encrypted</p>
      </div>
    </div>

    <!-- Form View -->
    <div id="form-container">
      <h2 class="title">Reset Your Password</h2>
      <p class="description">Enter your new password below. Make sure it is at least 8 characters long.</p>

      <div id="error-banner" class="error-banner"></div>

      <form id="reset-form" onsubmit="handleResetPassword(event)">
        <div class="form-group">
          <label class="label" for="new-password">New Password</label>
          <div class="input-wrapper">
            <input type="password" id="new-password" class="input" required minlength="8" placeholder="Enter new password" oninput="checkPasswordStrength()" />
            <button type="button" class="toggle-visibility-btn" onclick="togglePasswordVisibility('new-password', this)" aria-label="Toggle password visibility">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
          <div class="strength-container">
            <div class="strength-bars">
              <div id="str-1" class="strength-bar"></div>
              <div id="str-2" class="strength-bar"></div>
              <div id="str-3" class="strength-bar"></div>
              <div id="str-4" class="strength-bar"></div>
            </div>
            <div id="strength-label" class="strength-label">Password strength</div>
          </div>
        </div>

        <div class="form-group">
          <label class="label" for="confirm-password">Confirm New Password</label>
          <div class="input-wrapper">
            <input type="password" id="confirm-password" class="input" required minlength="8" placeholder="Confirm new password" oninput="checkPasswordMatch()" />
            <button type="button" class="toggle-visibility-btn" onclick="togglePasswordVisibility('confirm-password', this)" aria-label="Toggle password visibility">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
          <div id="match-status" class="match-status"></div>
        </div>

        <button type="submit" id="submit-btn" class="submit-btn">
          <span id="btn-text">Reset Password</span>
          <div id="btn-spinner" class="spinner"></div>
        </button>
      </form>
    </div>

    <!-- Success View -->
    <div id="success-view" class="success-view">
      <div class="success-icon-badge">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <h2 class="title" style="margin-bottom: 10px;">Password Changed!</h2>
      <p class="description" style="margin-bottom: 24px;">
        Your password has been successfully updated. You can now use your new password to sign into Chatuk.
      </p>

      <div class="action-links">
        <a id="open-app-btn" href="chatuk://" class="app-link-btn">Open Chatuk App</a>
        <a href="/" class="secondary-link">Return to Home</a>
      </div>
    </div>
  </div>

  <script>
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token') || '';

    if (!token) {
      showError('Missing reset token. Please verify the link in your email or request a new reset email.');
      document.getElementById('submit-btn').disabled = true;
    }

    function togglePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId);
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    }

    function checkPasswordStrength() {
      const pass = document.getElementById('new-password').value;
      const b1 = document.getElementById('str-1');
      const b2 = document.getElementById('str-2');
      const b3 = document.getElementById('str-3');
      const b4 = document.getElementById('str-4');
      const label = document.getElementById('strength-label');

      [b1, b2, b3, b4].forEach(b => b.style.backgroundColor = '#334155');

      if (!pass) {
        label.textContent = 'Password strength';
        label.style.color = '#94A3B8';
        return;
      }

      let score = 0;
      if (pass.length >= 8) score++;
      if (/[A-Z]/.test(pass)) score++;
      if (/[0-9]/.test(pass)) score++;
      if (/[^A-Za-z0-9]/.test(pass) || pass.length >= 12) score++;

      if (score === 1) {
        b1.style.backgroundColor = '#EF4444';
        label.textContent = 'Weak';
        label.style.color = '#EF4444';
      } else if (score === 2) {
        b1.style.backgroundColor = '#F59E0B';
        b2.style.backgroundColor = '#F59E0B';
        label.textContent = 'Fair';
        label.style.color = '#F59E0B';
      } else if (score === 3) {
        b1.style.backgroundColor = '#3B82F6';
        b2.style.backgroundColor = '#3B82F6';
        b3.style.backgroundColor = '#3B82F6';
        label.textContent = 'Good';
        label.style.color = '#3B82F6';
      } else if (score >= 4) {
        b1.style.backgroundColor = '#10B981';
        b2.style.backgroundColor = '#10B981';
        b3.style.backgroundColor = '#10B981';
        b4.style.backgroundColor = '#10B981';
        label.textContent = 'Strong';
        label.style.color = '#10B981';
      }
      checkPasswordMatch();
    }

    function checkPasswordMatch() {
      const pass = document.getElementById('new-password').value;
      const confirm = document.getElementById('confirm-password').value;
      const matchStatus = document.getElementById('match-status');

      if (!confirm) {
        matchStatus.style.display = 'none';
        return;
      }

      matchStatus.style.display = 'block';
      if (pass === confirm) {
        matchStatus.textContent = '\u2713 Passwords match';
        matchStatus.style.color = '#10B981';
      } else {
        matchStatus.textContent = '\u2717 Passwords do not match';
        matchStatus.style.color = '#EF4444';
      }
    }

    function showError(msg) {
      const banner = document.getElementById('error-banner');
      banner.textContent = msg;
      banner.style.display = 'block';
    }

    function hideError() {
      const banner = document.getElementById('error-banner');
      banner.style.display = 'none';
      banner.textContent = '';
    }

    async function handleResetPassword(e) {
      e.preventDefault();
      hideError();

      if (!token) {
        showError('Missing reset token. Please request a new reset email.');
        return;
      }

      const newPassword = document.getElementById('new-password').value;
      const confirmPassword = document.getElementById('confirm-password').value;

      if (newPassword.length < 8) {
        showError('Password must be at least 8 characters long.');
        return;
      }

      if (newPassword !== confirmPassword) {
        showError('Passwords do not match. Please re-enter.');
        return;
      }

      const submitBtn = document.getElementById('submit-btn');
      const btnText = document.getElementById('btn-text');
      const spinner = document.getElementById('btn-spinner');

      submitBtn.disabled = true;
      btnText.style.display = 'none';
      spinner.style.display = 'block';

      try {
        const response = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token: token,
            newPassword: newPassword,
          }),
        });

        const data = await response.json();

        if (response.ok && (data.status === true || !data.error)) {
          document.getElementById('form-container').style.display = 'none';
          document.getElementById('success-view').style.display = 'block';
        } else {
          const errMsg = data.message || data.error || 'Password reset failed. The link may have expired or already been used.';
          showError(errMsg);
          submitBtn.disabled = false;
          btnText.style.display = 'inline';
          spinner.style.display = 'none';
        }
      } catch (err) {
        showError('Network error connecting to Chatuk server. Please try again.');
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        spinner.style.display = 'none';
      }
    }
  </script>
</body>
</html>`);
};

