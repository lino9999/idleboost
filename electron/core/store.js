const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  get(name, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  set(name, value) {
    try {
      fs.writeFileSync(this.file(name), JSON.stringify(value, null, 2), 'utf8');
    } catch {
      return false;
    }
    return true;
  }
}

module.exports = { JsonStore };
