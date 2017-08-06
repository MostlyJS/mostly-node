import EventEmitter from 'events';
import Bloomrun from 'bloomrun';
import Errio from 'errio';
import Heavy from 'heavy';
import _ from 'lodash';
import Pino from 'pino';
import OnExit from 'signal-exit';
import TinySonic from 'tinysonic';
import SuperError from 'super-error';
import Co from 'co';
import makeDebug from 'debug';

import Errors from './errors';
import Constants from './constants';
import Extension from './extension';
import Util from './util';
import NatsTransport from './transport';
import DefaultExtensions from './extensions';
import DefaultEncoder from './encoder';
import DefaultDecoder from './decoder';
import ServerResponse from './serverResponse';
import ServerRequest from './serverRequest';
import ClientRequest from './clientRequest';
import ClientResponse from './clientResponse';
import Serializers from './serializer';
import Add from './add';

const debug = makeDebug('mostly:core');

const defaultConfig = {
  timeout: 2000, // max execution time of a request
  debug: false,
  generators: false,  // promise and generators support
  name: 'mostly-' + Util.randomId(), // node name
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

export default class MostlyCore extends EventEmitter {

  constructor(transport, options) {
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
    this.plugin$ = {
      options: {},
      attributes: {
        name: 'core'
      }
    };
    this.trace$ = {};
    this.request$ = {
      duration: 0,
      parentId: '',
      timestamp: 0,
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
      core: this.plugin$.attributes
    };

    this._encoder = {
      encode: DefaultEncoder.encode
    };
    this._decoder = {
      decode: DefaultDecoder.decode
    };

    // define extension points
    this._extensions = {
      onClientPreRequest: new Extension('onClientPreRequest', { server: false, generators: this._config.generators }),
      onClientPostRequest: new Extension('onClientPostRequest', { server: false, generators: this._config.generators }),
      onServerPreHandler: new Extension('onServerPreHandler', { server: true, generators: this._config.generators }),
      onServerPreRequest: new Extension('onServerPreRequest', { server: true, generators: this._config.generators }),
      onServerPreResponse: new Extension('onServerPreResponse', { server: true, generators: this._config.generators })
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
    // will be executed after the client received and decoded the request
    this._extensions.onClientPostRequest.add(DefaultExtensions.onClientPostRequest);
    // will be executed before the server received the requests
    this._extensions.onServerPreRequest.add(DefaultExtensions.onServerPreRequest);
    // will be executed before the server action is executed
    this._extensions.onServerPreHandler.add(DefaultExtensions.onServerPreHandler);
    // will be executed before the server reply the response and build the message
    this._extensions.onServerPreResponse.add(DefaultExtensions.onServerPreResponse);

    // use own logger
    if (this._config.logger) {
      this.log = this._config.logger;
    } else {
      let pretty = Pino.pretty();

      // Leads to too much listeners in tests
      if (this._config.logLevel !== 'silent') {
        pretty.pipe(process.stdout);
      }

      this.log = Pino({
        name: this._config.name,
        safe: true, // avoid error caused by circular references
        level: this._config.logLevel,
        serializers: Serializers
      }, pretty);
    }

    // no matter how a process exits log and fire event
    OnExit((code, signal) => {
      this.log.fatal({
        code,
        signal
      }, 'process exited');
      this.emit('teardown', {
        code,
        signal
      });
      this.close();
    });
  }

  /**
   * Return all registered plugins
   */
  get plugins() {
    return this._plugins;
  }

  /**
   * Return the bloomrun instance
   */
  get router() {
    return this._router;
  }

  /**
   * Return the heavy instance
   */
  get load() {
    return this._heavy.load;
  }

  /**
   * Return the shared object of all exposed data
   */
  get exposition() {
    return this._exposition;
  }

  /**
   * Exposed data in context of the current plugin
   * It is accessible by this.expositions[<plugin>][<key>]
   */
  expose(key, object) {
    let pluginName = this.plugin$.attributes.name;

    if (!this._exposition[pluginName]) {
      this._exposition[pluginName] = {};
      this._exposition[pluginName][key] = object;
    } else {
      this._exposition[pluginName][key] = object;
    }
  }

  /**
   * Return the underlying NATS driver
   */
  get transport() {
    return this._transport.driver;
  }

  /**
   * Return all registered topics
   */
  get topics() {
    return this._topics;
  }

  /**
   * Add an extension. Extensions are called in serie
   */
  ext(type, handler) {
    if (!this._extensions[type]) {
      let error = new Errors.MostlyError(Constants.INVALID_EXTENSION_TYPE, {
        type
      });
      this.log.error(error);
      throw(error);
    }

    this._extensions[type].add(handler);
  }

  /**
   * Use a plugin.
   */
  use(params, options) {
    // use plugin infos from package.json
    if (_.isObject(params.attributes.pkg)) {
      params.attributes = params.attributes || {};
      params.attributes = Object.assign(params.attributes,
        _.pick(params.attributes.pkg, ['name', 'description', 'version']));
    }

    // pass options as second argument during plugin registration
    if (_.isObject(options)) {
      params.options = params.options || {};
      params.options = Object.assign(params.options, options);
    }

    // plugin name is required
    if (!params.attributes.name) {
      let error = new Errors.MostlyError(Constants.PLUGIN_NAME_REQUIRED);
      this.log.error(error);
      throw(error);
    }

    // check plugin dependenciess
    if (params.attributes.dependencies) {
      params.attributes.dependencies.forEach((dep) => {
        if (!this._plugins[dep]) {
          this.log.error(Constants.PLUGIN_DEPENDENCY_MISSING, params.attributes.name, dep, dep);
          throw new Errors.HemeraError(Constants.PLUGIN_DEPENDENCY_NOT_FOUND);
        }
      });
    }

    // check dependencies
    _.each(params.attributes.dependencies, (pluginName) => {
      if (!this._plugins[pluginName]) {
        this.log.error(Constants.PLUGIN_DEPENDENCY_MISSING, params.attributes.name, pluginName, pluginName);
        throw new Errors.HemeraError(Constants.PLUGIN_DEPENDENCY_NOT_FOUND);
      }
    });

    // create new execution context
    let ctx = this.createContext();
    ctx.plugin$ = {};
    ctx.plugin$.register = params.plugin.bind(ctx);
    ctx.plugin$.attributes = params.attributes || {};
    ctx.plugin$.attributes.dependencies = params.attributes.dependencies || [];
    ctx.plugin$.parentPlugin = this.plugin$.attributes.name;
    ctx.plugin$.options = params.options || {};

    if (ctx._config.childLogger) {
      ctx.log = this.log.child({ plugin: params.attributes.name });
    }

    this._pluginRegistrations.push(ctx.plugin$);

    this.log.info(params.attributes.name, Constants.PLUGIN_ADDED);
    this._plugins[params.attributes.name] = ctx.plugin$;
  }

  /**
   * Change the current plugin configuration
   * e.g to set the payload validator
   */
  setOption(key, value) {
    this.plugin$.options[key] = value;
  }

  /**
   * Change the base configuration.
   */
  setConfig(key, value) {
    this._config[key] = value;
  }

  get config() {
    return this._config;
  }

  /**
   * Exit the process
   */
  fatal() {
    this.close();

    // give nats driver chance to do rest work
    setImmediate(() => {
      process.exit(1);
    });
  }

  /**
   * Create a custom super error object without to start mostly
   */
  static createError(name) {
    return SuperError.subclass(name);
  }

  /**
   * Decorate the root instance with a method or other value
   * Value is globaly accesible
   */
  decorate(prop, value) {
    if (this._decorations[prop]) {
      throw new Error(Constants.DECORATION_ALREADY_DEFINED);
    } else if (this[prop]) {
      throw new Error(Constants.OVERRIDE_BUILTIN_METHOD_NOT_ALLOWED);
    }

    this._decorations[prop] = { plugin: this.plugin$, value };
    // decorate root mostly instance
    this._root[prop] = value;
  }

  /**
   * Create a custom super error object in a running mostly instance
   */
  createError(name) {
    return SuperError.subclass(name);
  }

  get errorDetails () {
    if (this._isServer) {
      return {
        app: this._config.name,
        isServer: this._isServer,
        pattern: this._actMeta ? this._actMeta.pattern : false // when pattern could not be found
      };
    } else {
      return {
        app: this._config.name,
        isServer: this._isServer,
        pattern: this._pattern
      };
    }
  }
  
  /**
   * Return all mostly errors
   */
  static get errors() {
    return Errors;
  }

  /**
   * Ready callback when Nats connected
   */
  ready(cb) {
    this._transport.driver.on('error', (error) => {
      this.log.error(error, Constants.TRANSPORT_ERROR);
      this.log.error('NATS Code: \'%s\', Message: %s', error.code, error.message);

      // exit only on connection issues
      if (Constants.NATS_CONN_ERROR_CODES.indexOf(error.code) > -1) {
        throw (error);
      }
    });
    this._transport.driver.on('reconnect', () => {
      this.log.info(Constants.TRANSPORT_RECONNECTED);
    });
    this._transport.driver.on('reconnecting', () => {
      this.log.warn(Constants.TRANSPORT_RECONNECTING);
    });
    this._transport.driver.on('close', () => {
      this.log.warn(Constants.TRANSPORT_CLOSED);
    });
    this._transport.driver.on('connect', () => {
      this.log.info(Constants.TRANSPORT_CONNECTED);

      const each = (item, next) => {
        if (item.register.length < 2) {
          item.register(item.options);
          return next();
        }
        item.register(item.options, next);
      };

      Util.serial(this._pluginRegistrations, each, (err) => {
        if (err) {
          if (err instanceof SuperError) {
            err = err.rootCause || err.cause || err;
          }
          const internalError = new Errors.MostlyError(Constants.PLUGIN_REGISTRATION_ERROR).causedBy(err);
          this.log.error(internalError);
          throw(internalError);
        }
        if (_.isFunction(cb)) {
          cb.call(this);
        }
      });
    });
  }

  /**
   * Ready callback when Nats connected
   */
  onError(cb) {
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
  _buildMessage() {
    let result = this._response;

    let message = {
      meta: this.meta$ || {},
      trace: this.trace$ || {},
      request: this.request$,
      result: result.error ? null : result.payload,
      error: result.error ? Errio.toObject(result.error) : null
    };

    let endTime = Util.nowHrTime();
    message.request.duration = endTime - message.request.timestamp;
    message.trace.duration = endTime - message.request.timestamp;

    let m = this._encoder.encode.call(this, message);

    // attach encoding issues
    if (m.error) {
      message.error = Errio.toObject(m.error);
      message.result = null;
    }

    // final response
    this._message = m.value;
  }

  _onServerPreResponseHandler(err, value) {
    const self = this;

    // check if an error was already wrapped
    if (self._response.error) {
      self.emit('serverResponseError', self._response.error);
      self.log.error(self._response.error);
    } else if (err) { // check for an extension error
      if (err instanceof SuperError) {
        self._response.error = err.rootCause || err.cause || err;
      } else {
        self._response.error = err;
      }
      const internalError = new Errors.MostlyError(
          Constants.EXTENSION_ERROR, self.errorDetails).causedBy(err);
      self.log.error(internalError);

      self.emit('serverResponseError', self._response.error);
    }

    // reply value from extension
    if (value) {
      self._response.payload = value;
    }

    // create message payload
    self._buildMessage();

    // indicates that an error occurs and that the program should exit
    if (self._shouldCrash) {
      // only when we have an inbox othwerwise exit the service immediately
      if (self._replyTo) {
        // send error back to callee
        return self._transport.send(self._replyTo, self._message, () => {
          // let it crash
          if (self._config.crashOnFatal) {
            self.fatal();
          }
        });
      } else if (self._config.crashOnFatal) {
        return self.fatal();
      }
    }

    // reply only when we have an inbox
    if (self._replyTo) {
      return this._transport.send(this._replyTo, self._message);
    }
  }

  /**
   * Last step before the response is send to the callee.
   * The preResponse extension is dispatched and previous errors are evaluated.
   */
  finish() {
    this._extensions.onServerPreResponse.dispatch(this, (err, val) => {
      return this._onServerPreResponseHandler(err, val);
    });
  }

  _actionHandler(err, resp) {
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

  _onServerPreHandler(err, value) {
    const self = this;

    if (err) {
      if (err instanceof SuperError) {
        self._response.error = err.rootCause || err.cause || err;
      } else {
        self._response.error = err;
      }

      const internalError = new Errors.MostlyError(
          Constants.EXTENSION_ERROR, self.errorDetails).causedBy(err);
      self.log.error(internalError);

      return self.finish();
    }

    // reply value from extension
    if (value) {
      self._response.payload = value;
      return self.finish();
    }

    try {
      let action = self._actMeta.action.bind(self);

      // execute add middlewares
      self._actMeta.dispatch(self._request, self._response, (err) => {
        // middleware error
        if (err) {
          if (err instanceof SuperError) {
            self._response.error = err.rootCause || err.cause || err;
          } else {
            self._response.error = err;
          }

          let internalError = new Errors.MostlyError(
              Constants.ADD_MIDDLEWARE_ERROR, self.errorDetails).causedBy(err);
          self.log.error(internalError);

          return self.finish();
        }

        // if request type is 'pubsub' we dont have to reply back
        if (self._request.payload.request.type === Constants.REQUEST_TYPE_PUBSUB) {
          action(self._request.payload.pattern);
          return self.finish();
        }

        // execute RPC action
        if (self._config.generators && self._actMeta.isGenFunc) {
          action(self._request.payload.pattern)
            .then(x => self._actionHandler(null, x))
            .catch(e => self._actionHandler(e));
        } else {
          action(self._request.payload.pattern, self._actionHandler.bind(self));
        }
      });
    } catch(err) {
      if (err instanceof SuperError) {
        self._response.error = err.rootCause || err.cause || err;
      } else {
        self._response.error = err;
      }

      // service should exit
      self._shouldCrash = true;

      self.finish();
    }
  }

  _onServerPreRequestHandler(err, value) {
    let self = this;

    // icnoming pattern
    self._pattern = self._request.payload.pattern;

    // find matched route
    self._actMeta = self._router.lookup(self._pattern);

    if (err) {
      if (err instanceof SuperError) {
        self._response.error = err.rootCause || err.cause || err;
      } else {
        self._response.error = err;
      }

      return self.finish();
    }

    // reply value from extension
    if (value) {
      self._response.payload = value;
      return self.finish();
    }

    // check if a handler is registered with this pattern
    if (self._actMeta) {
      self._extensions.onServerPreHandler.dispatch(self, (err, val) => {
        return self._onServerPreHandler(err, val);
      });
    } else {
      self.log.info({ topic: self._topic }, Constants.PATTERN_NOT_FOUND);
      self._response.error = new Errors.PatternNotFound(Constants.PATTERN_NOT_FOUND, self.errorDetails);

      // send error back to callee
      self.finish();
    }
  }

  /**
   * Attach one handler to the topic subscriber.
   * With subToMany and maxMessages you control NATS specific behaviour.
   */
  subscribe(topic, subToMany, maxMessages) {
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
        return ctx._onServerPreRequestHandler(err, val);
      });
    };

    // standard pubsub with optional max proceed messages
    if (subToMany) {
      self._topics[topic] = self._transport.subscribe(topic, {
        max: maxMessages
      }, handler);
    } else {
      // queue group names allow load balancing of services
      self._topics[topic] = self._transport.subscribe(topic, {
        'queue': `${Constants.NATS_QUEUEGROUP_PREFIX}.${topic}`,
        max: maxMessages
      }, handler);
    }
  }

  /**
   * Unsubscribe a topic from NATS
   */
  remove(topic, maxMessages) {
    const self = this;
    const subId = self._topics[topic];
    if (subId) {
      self._transport.unsubscribe(subId, maxMessages);
      // release topic
      delete self._topics[topic];
      return true;
    }

    return false;
  }

  /**
   * The topic is subscribed on NATS and can be called from any client.
   */
  add(pattern, cb) {
    // check for use quick syntax for JSON objects
    if (_.isString(pattern)) {
      pattern = TinySonic(pattern);
    }

    // topic is needed to subscribe on a subject in NATS
    if (!pattern.topic) {
      let error = new Errors.MostlyError(Constants.NO_TOPIC_TO_SUBSCRIBE, {
        pattern,
        app: this._config.name
      });

      this.log.error(error);
      throw(error);
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
    let addDefinition = new Add(actMeta, { generators: this._config.generators });

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
      let error = new Errors.MostlyError(Constants.PATTERN_ALREADY_IN_USE, {
        pattern,
        app: this._config.name
      });

      this.log.error(error);
      throw(error);
    }

    // add to bloomrun
    this._router.add(bloomrunPattern, addDefinition);

    this.log.info(origPattern, Constants.ADD_ADDED);

    // subscribe on topic
    this.subscribe(pattern.topic, pattern.pubsub$, pattern.maxMessages$);

    return addDefinition;
  }

  _onClientPostRequestHandler(err) {
    const self = this;
    // extension error
    if (err) {
      let error = null;
      if (err instanceof SuperError) {
        error = err.rootCause || err.cause || err;
      } else {
        error = err;
      }
      const internalError = new Errors.MostlyError(Constants.EXTENSION_ERROR, self.errorDetails).causedBy(err);
      self.log.error(internalError);

      self.emit('clientResponseError', error);

      self._execute(error);
      return;
    }

    if (self._response.payload.error) {
      debug('act:response.payload.error', self._response.payload.error);
      let error = Errio.fromObject(self._response.payload.error);

      const internalError = new Errors.BusinessError(Constants.BUSINESS_ERROR, self.errorDetails).causedBy(error);
      self.log.error(internalError);

      self.emit('clientResponseError', error);

      self._execute(error);
      return;
    }

    self._execute(null, self._response.payload.result);
  }

  _sendRequestHandler(response) {
    const self = this;
    const res = self._decoder.decode.call(self, response);
    self._response.payload = res.value;
    self._response.error = res.error;

    try {
      // if payload is invalid (decoding error)
      if (self._response.error) {
        let error = new Errors.ParseError(Constants.PAYLOAD_PARSING_ERROR, self.errorDetails).causedBy(self._response.error);
        self.log.error(error);
        self.emit('clientResponseError', error);

        self._execute(error);
        return;
      }

      self._extensions.onClientPostRequest.dispatch(self, (err) => {
        return self._onClientPostRequestHandler(err);
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

  _onPreRequestHandler(err) {
    const self = this;

    let m = self._encoder.encode.call(self, self._message);

    // encoding issue
    if (m.error) {
      let error = new Errors.ParseError(Constants.PAYLOAD_PARSING_ERROR).causedBy(m.error);
      self.log.error(error);
      self.emit('clientResponseError', error);

      self._execute(error);
      return;
    }

    if (err) {
      let error = null;
      if (err instanceof SuperError) {
        error = err.rootCause || err.cause || err;
      } else {
        error = err;
      }

      const internalError = new Errors.MostlyError(Constants.EXTENSION_ERROR).causedBy(err);
      self.log.error(internalError);

      self.emit('clientResponseError', error);

      self._execute(error);
      return;
    }

    self._request.payload = m.value;
    self._request.error = m.error;

    // use simple publish mechanism instead of request/reply
    if (self._pattern.pubsub$ === true) {
      if (self._actCallback) {
        self.log.info(Constants.PUB_CALLBACK_REDUNDANT);
      }

      self._transport.send(self._pattern.topic, self._request.payload);
    } else {
      const optOptions = {};
      // limit on the number of responses the requestor may receive
      if (self._pattern.maxMessages$ > 0) {
        optOptions.max = self._pattern.maxMessages$;
      } else if (self._pattern.maxMessages$ !== -1) {
        optOptions.max = 1;
      } // else unlimited messages

      // send request
      self._sid = self._transport.sendRequest(self._pattern.topic,
        self._request.payload, optOptions, self._sendRequestHandler.bind(self));

      // handle timeout
      self.handleTimeout();
    }
  }

  /**
   * Start an action.
   */
  act(pattern, cb) {
    // check for use quick syntax for JSON objects
    if (_.isString(pattern)) {
      pattern = TinySonic(pattern);
    }

    // create new execution context
    let ctx = this.createContext();
    ctx._pattern = pattern;
    ctx._prevContext = this;
    ctx._actCallback = _.isFunction(cb) ? cb.bind(ctx) : null;
    ctx._cleanPattern = Util.cleanFromSpecialVars(pattern);
    ctx._response = new ClientResponse();
    ctx._request = new ClientRequest();
    ctx._isServer = false;
    ctx._execute = null;

    // topic is needed to subscribe on a subject in NATS
    if (!pattern.topic) {
      let error = new Errors.MostlyError(Constants.NO_TOPIC_TO_REQUEST, {
        pattern
      });

      this.log.error(error);
      throw(error);
    }

    if (cb) {
      if (this._config.generators) {
        ctx._actCallback = Co.wrap(cb.bind(ctx));
      } else {
        ctx._actCallback = cb.bind(ctx);
      }
    }
    
    // dont return promise when generators is set to false
    if (this._config.generators) {
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

          if (ctx._actCallback) {
            ctx._actCallback(err, result).then(x => resolve(x)).catch(x => reject(x));
          } else {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          }
        };
      });
      
      ctx._extensions.onClientPreRequest.dispatch(ctx, (err) => ctx._onPreRequestHandler(err));
      return promise;
    } else {
      ctx._execute = (err, result) => {
        if (ctx._config.circuitBreaker.enabled) {
          const circuitBreaker = ctx._circuitBreakerMap.get(ctx.trace$.method);
          if (err) {
            circuitBreaker.failure();
          } else {
            circuitBreaker.success();
          }
        }
        if (ctx._actCallback) {
          ctx._actCallback(err, result);
        }
      };
      ctx._extensions.onClientPreRequest.dispatch(ctx, (err) => ctx._onPreRequestHandler(err));
    }
  }

  _onClientTimeoutPostRequestHandler(err) {
    const self = this;
    if (err) {
      let error = null;
      if (err instanceof SuperError) {
        error = err.rootCause || err.cause || err;
      } else {
        error = err;
      }

      let internalError = new Errors.MostlyError(Constants.EXTENSION_ERROR).causedBy(err);
      self.log.error(internalError);

      self._response.error = error;
      self.emit('clientResponseError', error);
    }

    try {
      self._execute(self._response.error);
    } catch(err) {
      let error = null;
      if (err instanceof SuperError) {
        error = err.rootCause || err.cause || err;
      } else {
        error = err;
      }

      let internalError = new Errors.FatalError(Constants.FATAL_ERROR, self.errorDetails).causedBy(err);
      self.log.fatal(internalError);

      self.emit('clientResponseError', error);

      // let it crash
      if (self._config.crashOnFatal) {
        self.fatal();
      }
    }
  }

  /**
   * Handle the timeout when a pattern could not be resolved. Can have different reasons:
   * - No one was connected at the time (service unavailable)
   * - Service is actually still processing the request (service takes too long)
   * - Service was processing the request but crashed (service error)
   */
  handleTimeout() {
    const self = this;
    const timeout = self._pattern.timeout$ || this._config.timeout;

    let timeoutHandler = () => {
      const error = new Errors.TimeoutError(Constants.ACT_TIMEOUT_ERROR, self.errorDetails);
      self.log.error(error);
      self._response.error = error;
      self.emit('clientResponseError', error);
      self._extensions.onClientPostRequest.dispatch(self, (err) => {
        return self._onClientTimeoutPostRequestHandler(err);
      });
    };

    self._transport.timeout(self._sid, timeout, 1, timeoutHandler);
  }

  /**
   * Create new instance of mostly but with pointer on the previous propertys
   * so we are able to create a scope per act without lossing the reference to the core api.
   */
  createContext() {
    const self = this;

    const ctx = Object.create(self);

    return ctx;
  }

  /**
   * Return the list of all registered actions
   */
  list(pattern, options) {
    return this._router.list(pattern, options);
  }

  /**
   * Close the process watcher and the underlying transort driver.
   */
  close() {
    this.emit('close');

    this._heavy.stop();
    return this._transport.close();
  }
}
