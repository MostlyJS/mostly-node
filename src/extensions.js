import Constants from './constants';
import Util from './util';
const Errors = require('./errors');

function onClientPreRequest (next) {
  let ctx = this;

  let pattern = this._pattern;

  let prevCtx = this._prevContext;
  let cleanPattern = this._cleanPattern;
  let currentTime = Util.nowHrTime();

  // shared context
  ctx.context$ = pattern.context$ || prevCtx.context$;

  // set metadata by passed pattern or current message context
  ctx.meta$ = Object.assign(pattern.meta$ || {}, ctx.meta$);
  // is only passed by msg
  ctx.delegate$ = pattern.delegate$ || {};

  // tracing
  ctx.trace$ = pattern.trace$ || {};
  ctx.trace$.parentSpanId = prevCtx.trace$.spanId;
  ctx.trace$.traceId = prevCtx.trace$.traceId || Util.randomId();
  ctx.trace$.spanId = pattern.trace$ ? pattern.trace$.spanId : Util.randomId();
  ctx.trace$.timestamp = currentTime;
  ctx.trace$.service = pattern.topic;
  ctx.trace$.method = Util.pattern(pattern);
  
  // detect recursion
  if (this._config.maxRecursion > 1) {
    const callSignature = `${ctx.trace$.traceId}:${ctx.trace$.method}`;
    if (ctx.meta$ && ctx.meta$.referrers) {
      let count = ctx.meta$.referrers[callSignature];
      count += 1;
      ctx.meta$.referrers[callSignature] = count;
      if (count > this._config.maxRecursion) {
        ctx.meta$.referrers = null;
        return next(new Errors.MaxRecursionError({ count: --count }));
      }
    } else {
      ctx.meta$.referrers = {};
      ctx.meta$.referrers[callSignature] = 1;
    }
  }

  // request
  let request = {
    id: pattern.requestId$ || Util.randomId(),
    parentId: ctx.request$.id || pattern.requestParentId$,
    timestamp: currentTime,
    type: pattern.pubsub$ === true ? Constants.REQUEST_TYPE_PUBSUB : Constants.REQUEST_TYPE_REQUEST,
    duration: 0
  };

  // build msg
  let message = {
    pattern: cleanPattern,
    meta: ctx.meta$,
    delegate: ctx.delegate$,
    trace: ctx.trace$,
    request: request
  };

  ctx._message = message;

  ctx.log.info({
    outbound: ctx
  });

  ctx.emit('clientPreRequest');

  next();
}

function onClientPostRequest (next) {
  let ctx = this;
  let pattern = this._pattern;
  let msg = ctx._response.payload;

  // pass to act context
  if (msg) {
    ctx.request$ = msg.request || {};
    ctx.trace$ = msg.trace || {};
    ctx.meta$ = msg.meta || {};
  }

  ctx.request$.service = pattern.topic;
  ctx.request$.method = Util.pattern(pattern);

  ctx.log.info({
    inbound: ctx
  });

  ctx.emit('clientPostRequest');

  next();
}

function onServerPreRequest (req, res, next) {
  let ctx = this;

  let m = ctx._decoder.decode.call(ctx, ctx._request.payload);

  if (m.error) {
    return res.send(m.error);
  }

  let msg = m.value;

  if (msg) {
    ctx.meta$ = msg.meta || {};
    ctx.trace$ = msg.trace || {};
    ctx.delegate$ = msg.delegate || {};
    ctx.request$ = msg.request || {};
    ctx.auth$ = {};
  }

  ctx._request.payload = m.value;
  ctx._request.error = m.error;

  ctx.emit('serverPreRequest');

  next();
}

function onServerPreRequestLoadTest (req, res, next) {
  let ctx = this;

  if (ctx._config.load.checkPolicy) {
    const error = this._loadPolicy.check();
    if (error) {
      return next(new Errors.ProcessLoadError(error.message, error.data));
    }
  }

  next();
}

function onServerPreHandler (req, res, next) {
  let ctx = this;

  ctx.emit('serverPreHandler');

  next();
}

function onServerPreResponse (req, res, next) {
  let ctx = this;

  ctx.emit('serverPreResponse');

  next();
}

module.exports.onClientPreRequest = [onClientPreRequest];
module.exports.onClientPostRequest = [onClientPostRequest];
module.exports.onServerPreRequest = [onServerPreRequest, onServerPreRequestLoadTest];
module.exports.onServerPreHandler = [onServerPreHandler];
module.exports.onServerPreResponse = [onServerPreResponse];