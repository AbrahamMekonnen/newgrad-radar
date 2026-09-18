# NewGrad Radar Autofill Helper

This helper transfers prepared answers from the Applications > Auto-Apply queue into the real ATS page. It does not solve or bypass CAPTCHA. When the user has already requested submission and every required field is complete, version 0.3.0 clicks the ATS submit button and reports a verified success page back to HireRadar. If the ATS displays a challenge or an incomplete field, the helper stops for the user.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this `extension` directory.
4. In HireRadar, open a prepared application and choose **Open & finish**.

After updating the repository, return to the extensions page and choose **Reload** on this extension so version 0.3.0 is active.

Handoff links contain a random short-lived token that expires after 10 minutes and is cleared after a verified submission report. The ATS receives the token only in the URL fragment, which browsers do not send to the site server.
