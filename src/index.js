'use strict';

const EventEmitter = require('events');
const Os = require('os');
const Bloomrun = require('bloomrun');
const Errio = require('errio');
const Heavy = require('heavy');
const _ = require('lodash');
const Pino = require('pino');
const TinySonic = require('tinysonic');
const SuperError = require('super-error');
const Co = require('co');
const makeDebug = require('debug');

const BeforeExit = require('./beforeExit');
const Errors = require('./errors');
const Constants = require('./constants');
const Extension = require('./extension');
const Util = require('./util');
const NatsTransport = require('./transport');
const DefaultExtensions = require('./extensions');
const DefaultEncoder = require('./encoder');
const DefaultDecoder = require('./decoder');
const ServerResponse = require('./serverResponse');
const ServerRequest = require('./serverRequest');
const ClientRequest = require('./clientRequest');
const ClientResponse = require('./clientResponse');
const Serializers = require('./serializer');
const CodecPipeline = require('./codecPipeline');
const Add = require('./add');
const Plugin = require('./plugin');
const Handlers = require('./handlers');

const debug = makeDebug('mostly:node');

const defaultConfig = {
  timeout: 2000,      // max execution time of a request
  pluginTimeout: 3000,// max intialization time for a plugin
  tag: '',            // The tag string of this mostly instance
  prettyLog: true,    // enables pino pretty logger (Don't use it in production the output isn't JSON)
  name: `node-${Os.hostname()}-${Util.randomId()}`, // node name
  crashOnFatal: true, // Should gracefully exit the process at unhandled exceptions or fatal errors
  logLevel: 'silent', // 'fatal', 'error', 'warn', 'info', 'debug', 'trace'; also 'silent'
  childLogger: false, // create a child logger per section / plugin. Only possible with default logger Pino.
  maxRecursion: 0,    // max recursive method calls
  errio: {
    recursive: true, // recursively serialize and deserialize nested errors
    inherited: true, // include inherited properties
    stack: true,     // include stack property
    private: false,  // include properties with leading or trailing underscores
    exclude: [],     // property names to exclude (low priority)
    include: []      // property names to include (high priority)
  },
  bloomrun: {
    indexing: 'inserting', // pattern indexing method "inserting" or "depth"
    lookupBeforeAdd: true  // checks if the pattern is no duplicate based on to the indexing strategy
  },
  load: {
    checkPolicy: true,     // check on every request (server) if the load policy was observed
    shouldCrash: true,     // should gracefully exit the process to recover from memory leaks or load, crashOnFatal must be enabled
    process: {
      sampleInterval: 0    // frequency of load sampling in milliseconds (zero is no sampling)
    },
    policy: {
      maxHeapUsedBytes: 0, // reject requests when V8 heap is over size in bytes (zero is no max)
      maxRssBytes: 0,      // reject requests when process RSS is over size in bytes (zero is no max)
      maxEventLoopDelay: 0 // milliseconds of delay after which requests are rejected (zero is no max)
    }
  },
  circuitBreaker: {
    enabled: false,
    minSuccesses: 1,        // minimum successes in the half-open state to change to close state
    halfOpenTime: 5 * 1000, // the duration when the server is ready to accept further calls after changing to open state
    resetIntervalTime: 15 * 1000, // frequency of reseting the circuit breaker to close state in milliseconds
    maxFailures: 3          // the threshold when the circuit breaker change to open state
  }
};

class MostlyCore extends EventEmitter {

  constructor (transport, options) {
    super();

    options = options || {};
    if (options.name) options.name = options.name + '-' + Util.randomId();
    this._config = Object.assign(defaultConfig, options);
    this._router = Bloomrun(this._config.bloomrun);
    this._heavy = new Heavy(this._config.load.process);
    this._transport = new NatsTransport({
      transport
    });
    this._topics = {};
    this._exposition = {};

    // special variables for the new execution context
    this.context$ = {};
    this.meta$ = {};
    this.delegate$ = {};
    this.auth$ = {};
    this.plugin$ = new Plugin({
      options: {},
      attributes: {
        name: 'core'
      }
    });
    this.trace$ = {};
    this.request$ = {
      parentId: '',
      type: Constants.REQUEST_TYPE_REQUEST,
      id: ''
    };

    // client and server locales
    this._shouldCrash = false;
    this._topic = '';
    this._replyTo = '';
    this._request = null;
    this._response = null;
    this._pattern = null;
    this._actMeta = null;
    this._actCallback = null;
    this._execute = null;
    this._cleanPattern = '';
    this._pluginRegistrations = [];
    this._decorations = {};
    // create reference to root mostly instance
    this._root = this;

    // contains the list of all registered plugins
    // the core is also a plugin
    this._plugins = {
      core: this.plugin$
    };

    this._encoderPipeline = new CodecPipeline().add(DefaultEncoder.encode);
    this._decoderPipeline = new CodecPipeline().add(DefaultDecoder.decode);

    // define extension points
    this._extensions = {
      onClientPreRequest: new Extension('onClientPreRequest'),
      onClientPostRequest: new Extension('onClientPostRequest'),
      onServerPreHandler: new Extension('onServerPreHandler'),
      onServerPreRequest: new Extension('onServerPreRequest'),
      onServerPreResponse: new Extension('onServerPreResponse'),
      onClose: new Extension('onClose')
    };

    // errio settings
    Errio.setDefaults(this._config.errio);

    // create load policy
    this._loadPolicy = this._heavy.policy(this._config.load.policy);

    // start tracking process stats
    this._heavy.start();

    // contains the list of circuit breaker of all act calls
    this._circuitBreakerMap = new Map();

    // will be executed before the client request is executed.
    this._extensions.onClientPreRequest.add(DefaultExtensions.onClientPreRequest);
    // will be executed after the client has received and decoded the request
    this._extensions.onClientPostRequest.add(DefaultExtensions.onClientPostRequest);
    // will be executed before the server has received the requests
    this._extensions.onServerPreRequest.add(DefaultExtensions.onServerPreRequest);
    // will be executed before the server action is executed
    this._extensions.onServerPreHandler.add(DefaultExtensions.onServerPreHandler);
    // will be executed before the server has replied the response and build the message
    this._extensions.onServerPreResponse.add(DefaultExtensions.onServerPreResponse);

    // use own logger
    if (this._config.logger) {
      this.log = this._config.logger;
    } else {
      if (this._config.prettyLog) {
        let pretty = Pino.pretty();
        this.log = Pino({
          name: this._config.name,
          safe: true, // avoid error caused by circular references
          level: this._config.logLevel,
          serializers: Serializers
        });

        // Leads to too much listeners in tests
        if (this._config.logLevel !== 'silent') {
          pretty.pipe(process.stdout);
        }
      } else {
        this.log = Pino({
          name: this._config.name,
          safe: true, // avoid error caused by circular references
          level: this._config.logLevel,
          serializers: Serializers
        });
      }
    }

    this._beforeExit = new BeforeExit();

    this._beforeExit.addAction((signal) => {
      this.log.fatal({ signal }, 'process exited');
      this.emit('exit', { signal });
      this.close();
    });

    this._beforeExit.addAction(() => {
      return new Promise((resolve, reject) => {
        this.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });

    this._beforeExit.init();
  }

  /**
   * Return the decoder pipeline
   */
  get decoder () {
    return this._decoderPipeline;
  }

  /**
   * Return the encoder pipeline
   */
  get encoder () {
    return this._encoderPipeline;
  }

  /**
   * Return all registered plugins
   */
  get plugins () {
    return this._plugins;
  }

  /**
   * Return the bloomrun instance
   */
  get router () {
    return this._router;
  }

  /**
   * Return the heavy instance
   */
  get load () {
    return this._heavy.load;
  }

  /**
   * Return the shared object of all exposed data
   */
  get exposition () {
    return this._exposition;
  }

  /**
   * Return the underlying NATS driver
   */
  get transport () {
    return this._transport.driver;
  }

  /**
   * Return all registered topics
   */
  get topics () {
    return this._topics;
  }

  get config () {
    return this._config;
  }

  get errorDetails () {
    if (this._isServer) {
      return {
        app: this._config.name,
        isServer: this._isServer,
        pattern: this.trace$.method
      };
    } else {
      return {
        app: this._config.name,
        isServer: this._isServer,
        pattern: this.trace$.method
      };
    }
  }
  
  /**
   * Return all mostly errors
   */
  static get errors () {
    return Errors;
  }

  /**
   * Exposed data in context of the current plugin
   * It is accessible by this.expositions[<plugin>][<key>]
   */
  expose (key, object) {
    let pluginName = this.plugin$.attributes.name;

    if (!this._exposition[pluginName]) {
      this._exposition[pluginName] = {};
      this._exposition[pluginName][key] = object;
    } else {
      this._exposition[pluginName][key] = object;
    }
  }

  /**
   * Add an extension. Extensions are called in serie
   */
  ext (type, handler) {
    if (!this._extensions[type]) {
      let error = new Errors.MostlyError(Constants.INVALID_EXTENSION_TYPE, {
        type
      });
      this.log.error(error);
      this.emit('error', error);
    }

    this._extensions[type].add(handler);
  }

  /**
   * Use a plugin.
   */
  use (params, options) {
    // use plugin infos from package.json
    if (_.isObject(params.attributes.pkg)) {
      params.attributes = params.attributes || {};
      params.attributes = Object.assign(params.attributes,
        _.pick(params.attributes.pkg, ['name', 'description', 'version']));
    }

    let pluginOptions = {};

    // pass options as second argument during plugin registration
    if (_.isObject(options)) {
      pluginOptions = _.clone(params.options) || {};
      pluginOptions = _.defaults(pluginOptions, options);
    } else if (params.options) {
      pluginOptions = _.clone(params.options);
    }

    // plugin name is required
    if (!params.attributes.name) {
      let error = new Errors.MostlyError(Constants.PLUGIN_NAME_REQUIRED);
      this.log.error(error);
      this.emit('error', error);
      return;
    }

    // create new execution context
    let ctx = this.createContext();

    const plugin = new Plugin({
      register: params.plugin.bind(ctx),
      attributes: params.attributes,
      parentPluginName: this.plugin$.attributes.name,
      options: pluginOptions
    });
    ctx.plugin$ = plugin;

    if (ctx._config.childLogger) {
      ctx.log = this.log.child({ plugin: plugin.attributes.name });
    }

    this._pluginRegistrations.push(plugin);

    this.log.info(params.attributes.name, Constants.PLUGIN_ADDED);
    this._plugins[params.attributes.name] = plugin;
  }

  /**
   * Change the current plugin configuration
   * e.g to set the payload validator
   */
  setOption (key, value) {
    this.plugin$.options[key] = value;
  }

  /**
   * Change the base configuration.
   */
  setConfig (key, value) {
    this._config[key] = value;
  }

  /**
   * Exit the process
   */
  fatal () {
    this._beforeExit.doActions('fatal');
  }

  /**
   * Create a custom super error object without to start mostly
   */
  static createError (name) {
    return SuperError.subclass(name);
  }

  /**
   * Create a custom super error object in a running mostly instance
   */
  createError (name) {
    return SuperError.subclass(name);
  }

  /**
   * Decorate the root instance with a method or other value
   * Value is globaly accesible
   */
  decorate (prop, value) {
    if (this._decorations[prop]) {
      this.emit('error', new Error(Constants.DECORATION_ALREADY_DEFINED));
    } else if (this[prop]) {
      this.emit('error', new Error(Constants.OVERRIDE_BUILTIN_METHOD_NOT_ALLOWED));
    }

    this._decorations[prop] = { plugin: this.plugin$, value };
    // decorate root mostly instance
    this._root[prop] = value;
  }

  registerPlugins (plugins, cb) {
    const each = (item, next) => {
      // plugin has no callback
      if (item.register.length < 2) {
        item.register(item.options);
        return next();
      }

      // Detect plugin timeouts
      const pluginTimer = setTimeout(() => {
        const internalError = new Errors.PluginTimeoutError(Constants.PLUGIN_TIMEOUT_ERROR);
        this.log.error(internalError, `Plugin: ${item.attributes.name}`);
        next(internalError);
      }, this._config.pluginTimeout);

      item.register(item.options, (err) => {
        clearTimeout(pluginTimer);
        next(err);
      });
    };

    // register all plugins in serie
    Util.serial(plugins, each, (err) => {
      if (err) {
        if (err instanceof SuperError) {
          err = err.rootCause || err.cause || err;
        }
        const internalError = new Errors.MostlyError(Constants.PLUGIN_REGISTRATION_ERROR).causedBy(err);
        this.log.error(internalError);
        this.emit('error', internalError);
      }
      if (_.isFunction(cb)) {
        cb.call(this);
      }
    });
  }

  /**
   * Ready callback when Nats connected
   */
  ready (cb) {
    this._transport.driver.on('error', (error) => {
      this.log.error(error, Constants.NATS_TRANSPORT_ERROR);
      this.log.error('NATS Code: \'%s\', Message: %s', error.code, error.message);

      // exit only on connection issues
      if (Constants.NATS_CONN_ERROR_CODES.indexOf(error.code) > -1) {
        // No callback therefore only gracefully shutdown of mostly not NATS
        this.close();
      }
    });
    this._transport.driver.on('permission_error', (err) => {
      this.log.error(err, Constants.NATS_PERMISSION_ERROR);
    });
    this._transport.driver.on('reconnect', () => {
      this.log.info(Constants.NATS_TRANSPORT_RECONNECTED);
    });
    this._transport.driver.on('reconnecting', () => {
      this.log.warn(Constants.NATS_TRANSPORT_RECONNECTING);
    });
    this._transport.driver.on('disconnect', () => {
      this.log.warn(Constants.NATS_TRANSPORT_DISCONNECTED);
    });
    this._transport.driver.on('close', () => {
      this.log.warn(Constants.NATS_TRANSPORT_CLOSED);
    });
    this._transport.driver.on('connect', () => {
      this.log.info(Constants.NATS_TRANSPORT_CONNECTED);
      this.registerPlugins(this._pluginRegistrations, cb);
    });
  }

  /**
   * Ready callback when Nats connected
   */
  onError (cb) {
    this._transport.driver.on('error', (e) => {
      this.log.info(Constants.TRANSPORT_ERROR);
      if (_.isFunction(cb)) {
        cb.call(this, e);
      }
    });
  }

  /**
   * Build the final payload for the response
   */
  _buildMessage () {
    let result = this._response;

    let message = {
      meta: this.meta$ || {},
      trace: this.trace$ || {},
      request: this.request$,
      result: result.error? null : result.payload,
      error: result.error? Errio.toObject(result.error) : null
    };

    let m = this._encoderPipeline.run(message, this);

    // attach encoding issues
    if (m.error) {
      let internalError = new Errors.ParseError(Constants.PAYLOAD_PARSING_ERROR).causedBy(m.error);
      message.error = Errio.toObject(internalError);
      message.result = null;

      // Retry to encode with issue perhaps the reason was data related
      m = this._encoderPipeline.run(message, this);
      this.log.error(internalError);
      this.emit('serverResponseError', m.error);
    }

    // final response
    this._message = m.value;
  }


  /**
   * Last step before the response is send to the callee.
   * The preResponse extension is dispatched and previous errors are evaluated.
   */
  finish () {
    this._extensions.onServerPreResponse.dispatch(this, (err, val) => {
      return Handlers.onServerPreResponseHandler(this, err, val);
    });
  }

  _actionHandler (err, resp) {
    const self = this;

    if (err) {
      debug('actionHandler:error', err);
      const errorDetails = {
        service: self.trace$.service,
        method: self._actMeta.method,
        app: self._config.name,
        ts: Util.nowHrTime()
      };

      // collect hops
      if (err.hops) {
        err.hops.push(errorDetails);
      } else {
        err.hops = [errorDetails];
      }

      if (err instanceof SuperError) {
        self._response.error = err.rootCause || err.cause || err;
      } else {
        self._response.error = err;
      }

      return self.finish();
    }

    // assign action result
    self._response.payload = resp;
    // delete error we have payload
    self._response.error = null;

    self.finish();
  }

  /**
   * Attach one handler to the topic subscriber.
   * With subToMany and maxMessages you control NATS specific behaviour.
   */
  subscribe (topic, subToMany, maxMessages, queue) {
    const self = this;

    // avoid duplicate subscribers of the emit stream
    // we use one subscriber per topic
    if (self._topics[topic]) {
      return;
    }

    let handler = (request, replyTo) => {
      // create new execution context
      let ctx = this.createContext();
      ctx._shouldCrash = false;
      ctx._replyTo = replyTo;
      ctx._topic = topic;
      ctx._request = new ServerRequest(request);
      ctx._response = new ServerResponse();
      ctx._pattern = {};
      ctx._actMeta = {};
      ctx._isServer = true;

      ctx._extensions.onServerPreRequest.dispatch(ctx, (err, val) => {
        return Handlers.onServerPreRequestHandler(ctx, err, val);
      });
    };

    // standard pubsub with optional max proceed messages
    if (subToMany) {
      self._topics[topic] = self._transport.subscribe(topic, {
        max: maxMessages
      }, handler);
    } else {
      const queueGroup = queue || `${Constants.NATS_QUEUEGROUP_PREFIX}.${topic}`;
      // queue group names allow load balancing of services
      self._topics[topic] = self._transport.subscribe(topic, {
        'queue': queueGroup,
        max: maxMessages
      }, handler);
    }
  }

  /**
   * Unsubscribe a topic or subscription id from NATS
   */
  remove (topic, maxMessages) {
    const self = this;

    if (!topic) {
      let error = new Errors.MostlyError(Constants.TOPIC_SID_REQUIRED_FOR_DELETION);
      self.log.error(error);
      throw error;
    }

    if (_.isNumber(topic)) {
      self._transport.unsubscribe(topic, maxMessages);
      return true;
    } else {
      const subId = self._topics[topic];
      if (subId) {
        self._transport.unsubscribe(subId, maxMessages);
        this.cleanTopic(topic);
        return true;
      }
    }

    return false;
  }

  /**
   * Remove topic from list and clean pattern index of topic
   */
  cleanTopic (topic) {
    // release topic so we can add it again
    delete this._topics[topic];
    // remove pattern which belongs to the topic
    _.each(this.list(), add => {
      if (add.pattern.topic === topic) {
        debug('remove topic', add.pattern);
        this.router.remove(add.pattern);
      }
    });
  }

  /**
   * The topic is subscribed on NATS and can be called from any client.
   */
  add (pattern, cb) {
    // check for use quick syntax for JSON objects
    if (_.isString(pattern)) {
      pattern = TinySonic(pattern);
    }

    if (!_.isObject(pattern)) {
      let error = new Errors.MostlyError(Constants.ADD_PATTERN_REQUIRED);
      this.log.error(error);
      throw error;
    }

    // topic is needed to subscribe on a subject in NATS
    if (!pattern.topic) {
      let error = new Errors.MostlyError(Constants.NO_TOPIC_TO_SUBSCRIBE, {
        pattern,
        app: this._config.name
      });

      this.log.error(error);
      throw error;
    }

    let origPattern = _.cloneDeep(pattern);
    let schema = Util.extractSchema(origPattern);
    origPattern = Util.cleanPattern(origPattern);

    let actMeta = {
      schema: schema,
      pattern: origPattern,
      plugin: this.plugin$
    };

    // create message object which represent the object behind the matched pattern
    let addDefinition = new Add(actMeta);

    // set callback
    if (cb) { // cb is null when use chaining syntax
      addDefinition.action = cb;
    }

    // Support full / token wildcards in subject
    const bloomrunPattern = _.clone(origPattern);
    // Convert nats wildcard tokens to RegexExp
    bloomrunPattern.topic = Util.natsWildcardToRegex(bloomrunPattern.topic);

    let handler = this._router.lookup(bloomrunPattern);

    // check if pattern is already registered
    if (this._config.bloomrun.lookupBeforeAdd && handler) {
      let error = new Errors.MostlyError(Constants.PATTERN_ALREADY_IN_USE, { pattern });
      this.log.error({ pattern }, error);
      this.emit('error', error);
    }

    // add to bloomrun
    this._router.add(bloomrunPattern, addDefinition);

    this.log.info(origPattern, Constants.ADD_ADDED);

    // subscribe on topic
    this.subscribe(
      pattern.topic,
      pattern.pubsub$,
      pattern.maxMessages$,
      pattern.queue$);

    return addDefinition;
  }

  _sendRequestHandler (response) {
    const self = this;
    const res = self._decoderPipeline.run(response, self);
    self._response.payload = res.value;
    self._response.error = res.error;

    try {
      // if payload is invalid (decoding error)
      if (self._response.error) {
        let error = new Errors.ParseError(Constants.PAYLOAD_PARSING_ERROR, self.errorDetails)
          .causedBy(self._response.error);
        self.log.error(error);
        self.emit('clientResponseError', error);

        self._execute(error);
        return;
      }

      self._extensions.onClientPostRequest.dispatch(self, (err) => {
        return Handlers.onClientPostRequestHandler(self, err);
      });
    } catch (err) {
      let error = null;
      if (err instanceof SuperError) {
        error = err.rootCause || err.cause || err;
      } else {
        error = err;
      }

      const internalError = new Errors.FatalError(Constants.FATAL_ERROR, self.errorDetails).causedBy(err);
      self.log.fatal(internalError);

      self.emit('clientResponseError', error);

      // let it crash
      if (self._config.crashOnFatal) {
        self.fatal();
      }
    }
  }

  /**
   * Start an action.
   */
  act (pattern, cb) {
    // check for use quick syntax for JSON objects
    if (_.isString(pattern)) {
      pattern = TinySonic(pattern);
    }

    if (!_.isObject(pattern)) {
      let error = new Errors.MostlyError(Constants.ACT_PATTERN_REQUIRED);
      this.log.error(error);
      throw error;
    }

    // create new execution context
    let ctx = this.createContext();
    ctx._pattern = pattern;
    ctx._prevContext = this;
    ctx._actCallback = _.isFunction(cb)? cb.bind(ctx) : null;
    ctx._cleanPattern = Util.cleanFromSpecialVars(pattern);
    ctx._response = new ClientResponse();
    ctx._request = new ClientRequest();
    ctx._isServer = false;
    ctx._execute = null;
    ctx._hasCallback = false;
    ctx._isPromisable = false;

    // topic is needed to subscribe on a subject in NATS
    if (!pattern.topic) {
      let error = new Errors.MostlyError(Constants.NO_TOPIC_TO_REQUEST, { pattern });
      this.log.error(error);
      throw error;
    }

    if (cb) {
      ctx._hasCallback = true;
      if (Util.isGeneratorFunction(cb)) {
        ctx._actCallback = Co.wrap(cb.bind(ctx));
        ctx._isPromisable = true;
      } else if (Util.isAsyncFunction(cb)) {
        ctx._actCallback = cb.bind(ctx);
        ctx._isPromisable = true;
      } else {
        ctx._actCallback = cb.bind(ctx);
        ctx._isPromisable = false;
      }
    }
    
    const promise = new Promise((resolve, reject) => {
      ctx._execute = (err, result) => {
        if (ctx._config.circuitBreaker.enabled) {
          const circuitBreaker = ctx._circuitBreakerMap.get(ctx.trace$.method);
          if (err) {
            circuitBreaker.failure();
          } else {
            circuitBreaker.success();
          }
        }

        if (ctx._hasCallback) {
          if (ctx._isPromisable) {
            ctx._actCallback(err, result)
              .then(x => resolve(x))
              .catch(x => reject(x));
          } else {
            // any return value in a callback function will fullfilled the
            // promise but an error will reject it
            const r = ctx._actCallback(err, result);
            if (r instanceof Error) {
              reject(r);
            } else {
              resolve(r);
            }
          }
        } else {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      };
    });
    
    ctx._extensions.onClientPreRequest.dispatch(ctx, (err) => {
      return Handlers.onPreRequestHandler(ctx, err);
    });
    return promise;
  }

  /**
   * Handle the timeout when a pattern could not be resolved. Can have different reasons:
   * - No one was connected at the time (service unavailable)
   * - Service is actually still processing the request (service takes too long)
   * - Service was processing the request but crashed (service error)
   */
  handleTimeout () {
    const self = this;
    const timeout = self._pattern.timeout$ || this._config.timeout;

    let timeoutHandler = () => {
      const error = new Errors.TimeoutError(Constants.ACT_TIMEOUT_ERROR, self.errorDetails);
      self.log.error(error);
      self._response.error = error;
      self.emit('clientResponseError', error);
      self._extensions.onClientPostRequest.dispatch(self, (err) => {
        return Handlers.onClientTimeoutPostRequestHandler(self, err);
      });
    };

    self._transport.timeout(self._sid, timeout, 1, timeoutHandler);
  }

  /**
   * Create new instance of mostly but but based on the current prototype
   * so we are able to create a scope per act without lossing the reference to the core api.
   */
  createContext () {
    const self = this;

    const ctx = Object.create(self);

    return ctx;
  }

  /**
   * Return the list of all registered actions
   */
  list (pattern, options) {
    return this._router.list(pattern, options);
  }

  /**
   * Remove all registered pattern and release topic from NATS
   */
  removeAll () {
    _.each(this._topics, (_, topic) => this.remove(topic));
  }

  /**
   * Gracefully shutdown of all resources.
   * Unsubscribe all subscriptiuons and close the underlying NATS connection
   */
  close (cb) {
    this._extensions.onClose.dispatch(this, (err, val) => {
      return Handlers.onClose(this, err, val, cb);
    });
  }
}

module.exports = MostlyCore;
