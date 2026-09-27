const { execFile } = require('child_process');

function checkWebcamUsage() {
  return new Promise((resolve) => {
    execFile('reg.exe', [
      'query',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam',
      '/s'
    ], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        return resolve({ inUse: false, error: err?.message });
      }

      const sections = stdout.split(/(?=HKEY_CURRENT_USER)/i);
      const activeApps = [];

      for (const section of sections) {
        const lines = section.trim().split(/\r?\n/);
        if (!lines.length) continue;
        const header = lines[0].trim();
        const lowerHeader = header.toLowerCase();

        // Exclude Edge Light itself and Electron dev environment
        if (
          lowerHeader.includes('edge light') ||
          lowerHeader.includes('edgelight') ||
          lowerHeader.includes('electron.exe')
        ) {
          continue;
        }

        let startVal = null;
        let stopVal = null;

        for (const line of lines) {
          const matchStart = line.match(/LastUsedTimeStart\s+REG_QWORD\s+(0x[0-9a-fA-F]+|\d+)/i);
          if (matchStart) startVal = matchStart[1];
          const matchStop = line.match(/LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-fA-F]+|\d+)/i);
          if (matchStop) stopVal = matchStop[1];
        }

        if (startVal !== null && stopVal !== null) {
          try {
            const start = BigInt(startVal);
            const stop = BigInt(stopVal);
            // If stop is 0, the app is actively holding/using the webcam right now!
            // If start > stop, the app started and hasn't stopped yet!
            if (stop === 0n || start > stop) {
              // Extract clean app name from registry path
              const appName = header.split('\\').pop() || header;
              activeApps.push({ header, appName, start: start.toString(), stop: stop.toString() });
            }
          } catch (e) {}
        }
      }

      resolve({ inUse: activeApps.length > 0, activeApps });
    });
  });
}

checkWebcamUsage().then(res => {
  console.log('Webcam Status:', JSON.stringify(res, null, 2));
});
