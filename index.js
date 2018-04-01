require = require("esm")(module/*, options*/);
console.time('mostly-node import');
module.exports = require("./src/index").default;
module.exports.checkPlugin = require('./src/checkPlugin').default;
module.exports.Errors = require('./src/errors').default;
console.timeEnd('mostly-node import');
