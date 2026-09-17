# NewGrad Radar Autofill Helper

This helper transfers prepared answers from the Applications > Auto-Apply queue into the real ATS page. It does not solve or bypass CAPTCHA. The user reviews the filled form, uploads any required local file, completes CAPTCHA, and submits.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this `extension` directory.
4. In NewGrad Radar, open a prepared application and choose **Open & finish**.

Handoff links contain a random one-time token that expires after 10 minutes. The ATS receives the token only in the URL fragment, which browsers do not send to the site server.
