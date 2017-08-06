import _ from 'lodash';
import makeDebug from 'debug';
import Errio from 'errio';
import SuperError from 'super-error';

import Errors from './errors';
import Constants from './constants';

const debug = makeDebug('mostly:core:handlers');

function onClientPostRequestHandler (ctx, err) {
  // extension error
  if (err) {
    let error = null;
    if (err instanceof SuperError) {
      error = err.rootCause || err.cause || err;
    } else {
      error = err;
    }
    const internalError = new Errors.MostlyError(Constants.EXTENSION_ERROR, ctx.errorDetails).causedBy(err);
    ctx.log.error(internalError);

    ctx.emit('clientResponseError', error);

    ctx._execute(error);
    return;
  }

  if (ctx._response.payload.error) {
    debug('act:response.payload.error', ctx._response.payload.error);
    let error = Errio.fromObject(ctx._response.payload.error);

    const internalError = new Errors.BusinessError(Constants.BUSINESS_ERROR, ctx.errorDetails).causedBy(error);
    ctx.log.error(internalError);

    ctx.emit('clientResponseError', error);

    ctx._execute(error);
    return;
  }

  ctx._execute(null, ctx._response.payload.result);
}

function onClientTimeoutPostRequestHandler (ctx, err) {
  if (err) {
    let error = null;
    if (err instanceof SuperError) {
      error = err.rootCause || err.cause || err;
    } else {
      error = err;
    }

    let internalError = new Errors.MostlyError(Constants.EXTENSION_ERROR).causedBy(err);
    ctx.log.error(internalError);

    ctx._response.error = error;
    ctx.emit('clientResponseError', error);
  }

  try {
    ctx._execute(ctx._response.error);
  } catch(err) {
    let error = null;
    if (err instanceof SuperError) {
      error = err.rootCause || err.cause || err;
    } else {
      error = err;
    }

    let internalError = new Errors.FatalError(Constants.FATAL_ERROR, ctx.errorDetails).causedBy(err);
    ctx.log.fatal(internalError);

    ctx.emit('clientResponseError', error);

    // let it crash
    if (ctx._config.crashOnFatal) {
      ctx.fatal();
    }
  }
}

function onPreRequestHandler (ctx, err) {
  let m = ctx._encoderPipeline.run(ctx._message, ctx);

  // encoding issue
  if (m.error) {
    let error = new Errors.ParseError(Constants.PAYLOAD_PARSING_ERROR).causedBy(m.error);
    ctx.log.error(error);
    ctx.emit('clientResponseError', error);

    ctx._execute(error);
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
    ctx.log.error(internalError);

    ctx.emit('clientResponseError', error);

    ctx._execute(error);
    return;
  }

  ctx._request.payload = m.value;
  ctx._request.error = m.error;

  // use simple publish mechanism instead of request/reply
  if (ctx._pattern.pubsub$ === true) {
    if (ctx._actCallback) {
      ctx.log.info(Constants.PUB_CALLBACK_REDUNDANT);
    }

    ctx._transport.send(ctx._pattern.topic, ctx._request.payload);
  } else {
    const optOptions = {};
    // limit on the number of responses the requestor may receive
    if (ctx._pattern.maxMessages$ > 0) {
      optOptions.max = ctx._pattern.maxMessages$;
    } else if (ctx._pattern.maxMessages$ !== -1) {
      optOptions.max = 1;
    } // else unlimited messages

    // send request
    ctx._sid = ctx._transport.sendRequest(ctx._pattern.topic,
      ctx._request.payload, optOptions, ctx._sendRequestHandler.bind(ctx));

    // handle timeout
    ctx.handleTimeout();
  }
}

function onServerPreHandler (ctx, err, value) {
  if (err) {
    if (err instanceof SuperError) {
      ctx._response.error = err.rootCause || err.cause || err;
    } else {
      ctx._response.error = err;
    }

    const internalError = new Errors.MostlyError(
        Constants.EXTENSION_ERROR, ctx.errorDetails).causedBy(err);
    ctx.log.error(internalError);

    return ctx.finish();
  }

  // reply value from extension
  if (value) {
    ctx._response.payload = value;
    return ctx.finish();
  }

  try {
    let action = ctx._actMeta.action.bind(ctx);

    // execute add middlewares
    ctx._actMeta.dispatch(ctx._request, ctx._response, (err) => {
      // middleware error
      if (err) {
        if (err instanceof SuperError) {
          ctx._response.error = err.rootCause || err.cause || err;
        } else {
          ctx._response.error = err;
        }

        let internalError = new Errors.MostlyError(
            Constants.ADD_MIDDLEWARE_ERROR, ctx.errorDetails).causedBy(err);
        ctx.log.error(internalError);

        return ctx.finish();
      }

      // if request type is 'pubsub' we dont have to reply back
      if (ctx._request.payload.request.type === Constants.REQUEST_TYPE_PUBSUB) {
        action(ctx._request.payload.pattern);
        return ctx.finish();
      }

      // execute RPC action
      if (ctx._actMeta.isPromisable) {
        action(ctx._request.payload.pattern)
          .then(x => ctx._actionHandler(null, x))
          .catch(e => ctx._actionHandler(e));
      } else {
        action(ctx._request.payload.pattern, ctx._actionHandler.bind(ctx));
      }
    });
  } catch (err) {
    if (err instanceof SuperError) {
      ctx._response.error = err.rootCause || err.cause || err;
    } else {
      ctx._response.error = err;
    }

    // service should exit
    ctx._shouldCrash = true;

    ctx.finish();
  }
}

function onServerPreRequestHandler (ctx, err, value) {
  if (err) {
    if (err instanceof SuperError) {
      ctx._response.error = err.rootCause || err.cause || err;
    } else {
      ctx._response.error = err;
    }

    return ctx.finish();
  }

  // reply value from extension
  if (value) {
    ctx._response.payload = value;
    return ctx.finish();
  }

  // check if a handler is registered with this pattern
  if (ctx._actMeta) {
    ctx._extensions.onServerPreHandler.dispatch(ctx, (err, val) => {
      return onServerPreHandler(ctx, err, val);
    });
  } else {
    const internalError = new Errors.PatternNotFound(Constants.PATTERN_NOT_FOUND, ctx.errorDetails);
    ctx.log.error(internalError);
    ctx._response.error = internalError;

    // send error back to callee
    ctx.finish();
  }
}

function onServerPreResponseHandler (ctx, err, value) {
  // check if an error was already wrapped
  if (ctx._response.error) {
    ctx.emit('serverResponseError', ctx._response.error);
    ctx.log.error(ctx._response.error);
  } else if (err) { // check for an extension error
    if (err instanceof SuperError) {
      ctx._response.error = err.rootCause || err.cause || err;
    } else {
      ctx._response.error = err;
    }
    const internalError = new Errors.MostlyError(
        Constants.EXTENSION_ERROR, ctx.errorDetails).causedBy(err);
    ctx.log.error(internalError);

    ctx.emit('serverResponseError', ctx._response.error);
  }

  // reply value from extension
  if (value) {
    ctx._response.payload = value;
  }

  // create message payload
  ctx._buildMessage();

  // indicates that an error occurs and that the program should exit
  if (ctx._shouldCrash) {
    // only when we have an inbox othwerwise exit the service immediately
    if (ctx._replyTo) {
      // send error back to callee
      return ctx._transport.send(ctx._replyTo, ctx._message, () => {
        // let it crash
        if (ctx._config.crashOnFatal) {
          ctx.fatal();
        }
      });
    } else if (ctx._config.crashOnFatal) {
      return ctx.fatal();
    }
  }

  // reply only when we have an inbox
  if (ctx._replyTo) {
    return ctx._transport.send(ctx._replyTo, ctx._message);
  }
}

function onClose(ctx, err, val, cb) {
  // no callback no queue processing
  if (!_.isFunction(cb)) {
    ctx._heavy.stop();
    ctx._transport.close();
    if (err) {
      ctx.log.fatal(err);
      ctx.emit('error', err);
    }
    return;
  }

  // unsubscribe all active subscriptions
  ctx.removeAll();

  // wait until the client has flush all messages to nats
  ctx._transport.flush(() => {
    ctx._heavy.stop();
    // close NATS
    ctx._transport.close();

    if (err) {
      ctx.log.error(err);
      ctx.emit('error', err);
      if (_.isFunction(cb)) {
        cb(err);
      }
    } else {
      ctx.log.info(Constants.GRACEFULLY_SHUTDOWN);
      if (_.isFunction(cb)) {
        cb(null, val);
      }
    }
  });
}

export {
  onClientPostRequestHandler,
  onClientTimeoutPostRequestHandler,
  onPreRequestHandler,
  onServerPreHandler,
  onServerPreRequestHandler,
  onServerPreResponseHandler,
  onClose
};