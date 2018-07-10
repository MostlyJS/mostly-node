'use strict';

const semver = require('semver');

// Check the bare-minimum version of mostly-node
// Provide consistent interface to register plugins even when the api is changed
function checkPlugin (fn, version) {
  if (typeof fn !== 'function') {
    throw new TypeError(`mostly-plugin expects a function, instead got a '${typeof fn}'`);
  }

  if (version) {
    if (typeof version !== 'string') {
      throw new TypeError(`mostly-plugin expects a version string as second parameter, instead got '${typeof version}'`);
    }

    const mostlyVersion = require('mostly-node/package.json').version;
    if (!semver.satisfies(mostlyVersion, version)) {
      throw new Error(`mostly-plugin - expected '${version}' mostly-node version, '${mostlyVersion}' is installed`);
    }
  }

  return fn;
}

module.exports = checkPlugin;