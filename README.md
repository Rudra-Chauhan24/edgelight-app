<div align="center">

  <img src="assets/icon.png" alt="Edge Light Logo" width="80" height="80">

  # Edge Light

  **Screen-edge studio ring illumination for Windows video calls**

  [![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?style=flat-square&logo=windows)](https://microsoft.com)
  [![Electron](https://img.shields.io/badge/Electron-33.2-47848F?style=flat-square&logo=electron)](https://electronjs.org)
  [![Node](https://img.shields.io/badge/Node-%3E%3D18.0-339933?style=flat-square&logo=node.js)](https://nodejs.org)
  [![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

  [Download](https://github.com/CHAUHANRUDRA24/edgelight-landing) • [Report Issue](https://github.com/CHAUHANRUDRA24/edgelight-app/issues) • [Documentation](#quick-start)

</div>

---

## Overview

**Edge Light** transforms the perimeter of your Windows display into a calibrated illumination ring. It provides balanced facial lighting for video calls on **WhatsApp, Zoom, Microsoft Teams, and Google Meet** without requiring external hardware or blocking on-screen content.

---

## Features

- **Automatic Screen Calibration**: Detects monitor resolution on startup (768p through 4K) and scales ring thickness proportionally.
- **Camera Activity Detection**: Reads Windows `CapabilityAccessManager` to activate illumination when a call begins and deactivate it when the camera closes.
- **Cursor Avoidance & Click-Through**: Dynamic cutout prevents cursor obstruction while allowing standard window interactions beneath the overlay.
- **Color Temperature Tuning**: Continuous adjustment between 3000K (warm) and 6500K (cool daylight).
- **Device-Bound Licensing**: Generates a persistent Hardware ID (HWID) based on machine components, backed by local AES-256-GCM encryption and remote Firestore verification.
- **Included Trial**: 3-day evaluation period available upon first launch.

---

## Plans & Licensing

Edge Light offers flexible pricing options payable via Razorpay and UPI:

| Tier | Price | Duration | Coverage |
| :--- | :--- | :--- | :--- |
| **Monthly** | ₹29 | 30 Days | Full access, auto camera detection, updates |
| **Quarterly** | ₹49 | 90 Days | Full access, priority updates |
| **Lifetime** | ₹99 | Permanent | Lifetime license tied to device HWID |

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl` + `Shift` + `L` | Toggle illumination on/off |
| `Hover right screen edge` | Display glassmorphic control dock |
| `Ctrl` + `Shift` + `Q` | Exit application |

---

## Project Structure

```
application/
├── assets/                  # Icons and application branding
│   ├── icon.ico
│   ├── icon.png
│   └── tray-icon.png
├── scripts/                 # Build and test scripts
│   ├── generate-icons.js
│   ├── test-setup-wizard-and-plans.js
│   └── test-firebase-integration.js
├── src/                     # Core application source
│   ├── index.html           # Main overlay window and setup wizard
│   ├── main.js              # Electron main process and system integrations
│   ├── preload.js           # Secure IPC bridge
│   ├── renderer.js          # Canvas rendering and animation loop
│   ├── style.css            # Overlay and dock styles
│   └── license-manager.js   # HWID generation and license verification
├── .env.example             # Environment variable template
├── package.json             # Build configuration and dependencies
└── README.md
```

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) (v18 or later)
- Windows 10 or 11 (64-bit)

### Installation

```bash
# Clone the repository
git clone https://github.com/CHAUHANRUDRA24/edgelight-app.git
cd edgelight-app

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
```

### Development

```bash
# Start application in development mode
npm start
```

### Testing

```bash
# Run verification test suites
node scripts/test-setup-wizard-and-plans.js
node scripts/test-firebase-integration.js
```

---

## Distribution Builds

Packaged executables are built using `electron-builder`:

```bash
# Portable executable (.exe)
npm run dist:portable

# Full installer (.exe)
npm run dist
```

Build outputs are generated in the `dist/` folder:
- `dist/Edge.Light.Setup.1.0.12.exe` (NSIS Installer)

---

## Author

- **Maintainer**: Chauhan Rudra ([@CHAUHANRUDRA24](https://github.com/CHAUHANRUDRA24))
- **Contact**: rudrachauhan2475@gmail.com

---

## License

This project is licensed under the [MIT License](LICENSE).
