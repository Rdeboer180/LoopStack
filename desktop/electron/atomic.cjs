// Atomic file write: temp file beside the target, then rename over it.
const fs = require('node:fs');
const crypto = require('node:crypto');

/** Write to a temp file in the same folder, then rename over the target. */
function writeAtomic(file, text, mode = 0o600) {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
}

module.exports = { writeAtomic };
