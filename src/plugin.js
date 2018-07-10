class Plugin {
  constructor (plugin) {
    this.attributes = plugin.attributes || {};
    this.options = plugin.options;
    this.parentPluginName = plugin.parentPluginName;
    this.register = plugin.register;
  }
}

module.exports = Plugin;