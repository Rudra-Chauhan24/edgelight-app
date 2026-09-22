const { app } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

class AppUpdater {
  constructor(options = {}) {
    this.checkUrl = options.checkUrl || 'https://edgelight-backend.vercel.app/api/updates/latest';
    this.fallbackUrl = options.fallbackUrl || 'https://api.github.com/repos/CHAUHANRUDRA24/edgelight-app/releases/latest';
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
          'User-Agent': 'EdgeLight-Desktop-Updater/' + (app?.getVersion ? app.getVersion() : '1.0.4'),
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

  // Check for updates
  async checkForUpdates() {
    const currentVersion = app?.getVersion ? app.getVersion() : '1.0.4';

    try {
      // 1. Try primary backend update endpoint
      let manifest = null;
      try {
        manifest = await this.fetchJson(this.checkUrl);
      } catch (e) {
        // Fallback to GitHub releases API
        try {
          const ghRelease = await this.fetchJson(this.fallbackUrl);
          if (ghRelease && ghRelease.tag_name) {
            const setupAsset = ghRelease.assets?.find(a => a.name.endsWith('.exe') && a.name.toLowerCase().includes('setup')) || ghRelease.assets?.find(a => a.name.endsWith('.exe'));
            manifest = {
              version: ghRelease.tag_name.replace(/^v/i, ''),
              releaseDate: ghRelease.published_at,
              notes: ghRelease.body || '✨ Edge Light update with optical and performance improvements.',
              downloadUrl: setupAsset?.browser_download_url || `https://github.com/CHAUHANRUDRA24/edgelight-app/releases/download/${ghRelease.tag_name}/Edge.Light.Setup.${ghRelease.tag_name}.exe`
            };
          }
        } catch (ghErr) {}
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
    const child = spawn(installerPath, [], {
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
