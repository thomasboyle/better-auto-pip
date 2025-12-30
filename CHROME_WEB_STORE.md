# Chrome Web Store Listing Information

This document contains all the information needed for the Chrome Web Store listing.

## Basic Information

**Extension Name:** Better Auto PiP

**Short Description:** (132 characters max)
Automatically enable Picture-in-Picture for videos when switching tabs or collapsing Vivaldi panels.

**Category:** Productivity

**Language:** English

## Detailed Description

Automatically enable Picture-in-Picture for videos when switching tabs or collapsing Vivaldi panels. Works seamlessly with YouTube, Netflix, Plex, Twitch, and many other popular video streaming sites.

**Key Features:**

• **Smart Tab Switching** - Automatically enters PiP mode when you switch away from a video tab, keeping your content visible while you work

• **Vivaldi Panel Integration** - Specially designed for Vivaldi browser users - automatically enters PiP when you collapse panels

• **Per-Site Control** - Customize which websites should trigger auto-PiP behavior with easy per-site toggles

• **Fully Customizable** - Adjust timing, delays, and behavior to match your preferences

**Supported Sites:**
YouTube, Netflix, Plex, Twitch, Hulu, Vimeo, Dailymotion, Crunchyroll, ESPN, Microsoft Teams, Google Meet, and more.

**Privacy:**
This extension does not collect, store, or transmit any user data. All settings are stored locally on your device.

**Perfect for:**
- Multitaskers who want to keep videos visible while working
- Vivaldi browser users who use panel collapse features
- Anyone who frequently switches between tabs while watching videos
- Remote workers attending video calls

Simple, lightweight, and respects your privacy. Install Better Auto PiP and never miss a moment of your videos again!

## Screenshots Required

You need to provide the following:

1. **Screenshots** (1280x800 or 640x400 pixels)
   - Minimum: 1 screenshot
   - Recommended: 3-5 screenshots
   - Suggested screenshots:
     - Extension in action showing PiP window
     - Settings/options page
     - Extension working on YouTube
     - Extension working on Netflix/Plex
     - Per-site controls interface

2. **Promotional Images** (Optional but recommended)
   - Small tile: 440x280 pixels
   - Marquee: 1400x560 pixels

## Store Assets Checklist

- [ ] At least 1 screenshot (1280x800 recommended)
- [ ] Extension icons already included (16, 32, 48, 128px)
- [ ] Privacy policy (if collecting data) - NOT NEEDED, we don't collect data
- [ ] Promotional images (optional)

## Permissions Justification

When submitting, you'll need to justify the following permissions:

**storage**
- Used to save user preferences and per-site settings locally
- No data is transmitted outside the user's device

**tabs**
- Required to detect when user switches tabs to trigger PiP mode
- No browsing history or sensitive tab information is collected

**host_permissions (specific sites)**
- Required to inject content scripts that detect and control video elements
- Only activates on supported video streaming sites
- Each site listed is explicitly supported

## Publishing Steps

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click "New Item"
3. Upload `dist/better-auto-pip-vX.Y.Z.zip`
4. Fill in the information from this document
5. Upload screenshots
6. Submit for review

## Version Update Steps

1. Update version number in `src/manifest.json`
2. Run `./build.sh` to create new package
3. Go to Chrome Web Store Developer Dashboard
4. Select "Better Auto PiP"
5. Click "Upload Updated Package"
6. Upload new ZIP file
7. Update any changed information
8. Submit for review

## Support & Contact

**Support Email:** [Your support email]
**Website:** https://github.com/seanharsh/Better-Auto-PiP
**Issues:** https://github.com/seanharsh/Better-Auto-PiP/issues

## Notes

- First review typically takes 1-3 business days
- Updates are usually faster (same day to 1 day)
- Make sure all permissions are justified
- Keep description clear and user-focused
- Avoid making unrealistic claims
