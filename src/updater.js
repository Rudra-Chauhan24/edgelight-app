const { app } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

class AppUpdater {
  constructor(options = {}) {
    // Primary: GitHub Releases API (always available, no server deployment needed)
    this.checkUrl = options.checkUrl || 'https://api.github.com/repos/Rudra-Chauhan24/edgelight-app/releases/latest';
    // Secondary: backend manifest endpoint
    this.fallbackUrl = options.fallbackUrl || 'https://edgelight-backend.vercel.app/api/updates/latest';
    this.currentVersion = options.currentVersion || null;
    this.downloadedFilePath = null;
    this.downloadInProgress = false;
    this.currentUpdateInfo = null;
  }

  // Parse semver numbers like "1.0.4" -> [1, 0, 4]
  parseSemver(verStr) {
    if (!verStr) return [0, 0, 0];
    const cleaned = verStr.replace(/^v/i, '').trim();
    const parts = cleaned.split('.').map(p => parseInt(p, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return parts;
  }

  // Return true if vA > vB
  isNewerVersion(remoteVer, localVer) {
    const [rMajor, rMinor, rPatch] = this.parseSemver(remoteVer);
    const [lMajor, lMinor, lPatch] = this.parseSemver(localVer);

    if (rMajor !== lMajor) return rMajor > lMajor;
    if (rMinor !== lMinor) return rMinor > lMinor;
    return rPatch > lPatch;
  }

  // Fetch JSON from URL with redirect limit guard
  fetchJson(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      if (redirectCount >= 5) {
        return reject(new Error('Too many redirects while checking update'));
      }
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(url, {
        headers: {
          'User-Agent': 'EdgeLight-Desktop-Updater/' + (app?.getVersion ? app.getVersion() : '1.0.7'),
          'Accept': 'application/json'
        },
        timeout: 6000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(this.fetchJson(res.headers.location, redirectCount + 1));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Server responded with HTTP ${res.statusCode}`));
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse update manifest JSON'));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Update check request timed out'));
      });
      req.on('error', reject);
    });
  }

  // Fallback: Check GitHub web redirect to /releases/tag/vX.Y.Z (never rate-limited)
  fetchLatestReleaseRedirect() {
    return new Promise((resolve, reject) => {
      const req = https.get('https://github.com/Rudra-Chauhan24/edgelight-app/releases/latest', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 6000
      }, (res) => {
        const location = res.headers.location;
        if (location && location.includes('/releases/tag/')) {
          const tag = location.split('/releases/tag/').pop().split('?')[0].trim();
          const version = tag.replace(/^v/i, '').trim();
          return resolve({
            version,
            releaseDate: new Date().toISOString(),
            notes: `✨ Edge Light v${version} release.`,
            downloadUrl: `https://github.com/Rudra-Chauhan24/edgelight-app/releases/download/${tag}/Edge.Light.Setup.${version}.exe`
          });
        }
        reject(new Error(`Invalid redirect: ${location || res.statusCode}`));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Redirect check timed out')); });
      req.on('error', reject);
    });
  }

  async checkForUpdates() {
    let currentVersion = this.currentVersion;
    if (!currentVersion) {
      try {
        currentVersion = app?.getVersion ? app.getVersion() : require('../package.json').version;
      } catch (e) {
        currentVersion = require('../package.json').version;
      }
    }

    try {
      let manifest = null;

      // 1. Primary: GitHub Releases API
      try {
        const ghRelease = await this.fetchJson(this.checkUrl);
        if (ghRelease && ghRelease.tag_name) {
          const setupAsset = ghRelease.assets?.find(a => a.name.endsWith('.exe') && a.name.toLowerCase().includes('setup'))
            || ghRelease.assets?.find(a => a.name.endsWith('.exe'));
          const version = ghRelease.tag_name.replace(/^v/i, '').trim();
          manifest = {
            version,
            releaseDate: ghRelease.published_at,
            notes: ghRelease.body || '✨ Edge Light update with new features and improvements.',
            downloadUrl: setupAsset?.browser_download_url
              || `https://github.com/Rudra-Chauhan24/edgelight-app/releases/download/${ghRelease.tag_name}/Edge.Light.Setup.${version}.exe`
          };
        } else if (ghRelease && ghRelease.version) {
          manifest = ghRelease;
        }
      } catch (ghErr) {
        // 2. Secondary: Fallback to GitHub Web Releases redirect (bypasses GitHub API rate limit)
        try {
          manifest = await this.fetchLatestReleaseRedirect();
        } catch (redirErr) {
          // 3. Tertiary: backend manifest endpoint
          try {
            manifest = await this.fetchJson(this.fallbackUrl);
          } catch (e) {}
        }
      }

      if (!manifest || !manifest.version) {
        return {
          updateAvailable: false,
          currentVersion,
          message: 'Already on the latest version of Edge Light.'
        };
      }

      const updateAvailable = this.isNewerVersion(manifest.version, currentVersion);
      this.currentUpdateInfo = {
        updateAvailable,
        currentVersion,
        latestVersion: manifest.version,
        releaseDate: manifest.releaseDate || '',
        releaseNotes: manifest.notes || 'Performance enhancements, optical glow tuning, and stability improvements.',
        downloadUrl: manifest.downloadUrl || manifest.setupUrl || ''
      };

      return this.currentUpdateInfo;
    } catch (err) {
      console.warn('[AppUpdater] Check error:', err.message);
      return {
        updateAvailable: false,
        currentVersion,
        error: err.message
      };
    }
  }

  // Download update binary with live progress stream
  downloadUpdate(downloadUrl, onProgress) {
    return new Promise((resolve, reject) => {
      const urlToDownload = downloadUrl || this.currentUpdateInfo?.downloadUrl;
      if (!urlToDownload) {
        return reject(new Error('No download URL available for update'));
      }

      if (this.downloadInProgress) {
        return reject(new Error('Download already in progress'));
      }

      this.downloadInProgress = true;
      const tempDir = app?.getPath ? app.getPath('temp') : os.tmpdir();
      const targetFileName = `EdgeLight-Setup-${this.currentUpdateInfo?.latestVersion || 'update'}-${Date.now()}.exe`;
      const targetFilePath = path.join(tempDir, targetFileName);

      const makeDownloadRequest = (targetUrl, redirectCount = 0) => {
        if (redirectCount >= 5) {
          this.downloadInProgress = false;
          return reject(new Error('Too many download redirects'));
        }
        const parsedUrl = new URL(targetUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const req = client.get(targetUrl, {
          headers: {
            'User-Agent': 'EdgeLight-Desktop-Updater/' + (app?.getVersion ? app.getVersion() : '1.0.4')
          }
        }, (res) => {
          // Follow HTTP 301/302/307 redirects (standard on GitHub Releases and CDNs)
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return makeDownloadRequest(res.headers.location, redirectCount + 1);
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            this.downloadInProgress = false;
            return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
          }

          const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
          let downloadedBytes = 0;
          const fileStream = fs.createWriteStream(targetFilePath);

          fileStream.on('error', (err) => {
            this.downloadInProgress = false;
            try { fileStream.close(); } catch (e) {}
            try { fs.unlinkSync(targetFilePath); } catch (e) {}
            reject(err);
          });

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            fileStream.write(chunk);

            if (typeof onProgress === 'function') {
              const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
              onProgress({
                percent,
                downloadedBytes,
                totalBytes
              });
            }
          });

          res.on('end', () => {
            fileStream.end();
            this.downloadInProgress = false;
            this.downloadedFilePath = targetFilePath;
            if (typeof onProgress === 'function') {
              onProgress({ percent: 100, downloadedBytes, totalBytes });
            }
            resolve({
              success: true,
              filePath: targetFilePath,
              version: this.currentUpdateInfo?.latestVersion
            });
          });

          res.on('error', (err) => {
            fileStream.close();
            try { fs.unlinkSync(targetFilePath); } catch (e) {}
            this.downloadInProgress = false;
            reject(err);
          });
        });

        req.on('error', (err) => {
          this.downloadInProgress = false;
          reject(err);
        });
      };

      makeDownloadRequest(urlToDownload);
    });
  }

  // Execute installer and quit old instance
  installUpdate() {
    if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
      throw new Error('Downloaded installer executable not found. Please download the update first.');
    }

    const installerPath = this.downloadedFilePath;
    console.log('[AppUpdater] Spawning installer:', installerPath);

    // Launch installer detached from current Electron process
    const child = spawn(installerPath, ['/S'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Cleanly quit current application
    setTimeout(() => {
      app.isQuitting = true;
      app.quit();
    }, 400);

    return true;
  }
}

module.exports = { AppUpdater };
