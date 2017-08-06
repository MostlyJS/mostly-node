import _ from 'lodash';
import Errors from './errors';

export default class BeforeExit {

  constructor () {
    this.actions = [];
    this.signals = ['SIGINT', 'SIGTERM'];
  }

  addAction (fn) {
    if (!_.isFunction(fn)) {
      throw new Errors.MostlyError('Expected a function but got a ' + typeof fn);
    }
    this.actions.push(fn);
  }

  doActions (signal) {
    try {
      Promise.all(this.actions.map(action => action(signal)))
        .then(() => {
          process.exit(0);
        })
        .catch(() => {
          process.exit(1);
        });
    } catch (err) {
      process.exit(1);
    }
  }

  init () {
    this.signals.forEach((signal) => {
      process.on(signal, () => {
        this.doActions(signal);
      });
    });

    // PM2 Cluster shutdown message. Caught to support async handlers with pm2, needed because
    // explicitly calling process.exit() doesn't trigger the beforeExit event, and the exit
    // event cannot support async handlers, since the event loop is never called after it.
    process.on('message', (msg) => {
      if (msg === 'shutdown') {
        this.doActions('shutdown');
      }
    });
  }
}
