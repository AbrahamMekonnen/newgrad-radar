# HireRadar browser worker

This extension runs applications that a user has explicitly authorized from a job card or Auto-Apply rule. HireRadar prepares the answers on the server; the extension opens the real ATS page in a visible browser tab, fills the prepared fields, and reports live progress to **Applications → Auto-Apply**.

It marks an application Submitted only after the ATS displays a recognized success page. It does not solve or bypass CAPTCHA. If a required answer, file, consent, or security challenge needs the user, the queue changes to **waiting for user** and keeps the prepared form open.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` directory.
4. In HireRadar, open **Applications → Auto-Apply** and choose **Connect browser**.
5. Click the extension icon, paste the one-time code, and choose **Connect browser**.

The Manifest V3 background worker checks for authorized work once per minute, including while the HireRadar website is closed. The computer and browser must remain running. Pairing codes expire after 10 minutes and can be exchanged once. The resulting random device credential is stored in extension storage; only its SHA-256 hash is stored in the database.

The older tokenized **Open & finish** flow remains available as a fallback during migration.
