MostlyJS Microservice on Node.js
================================

[![Build Status](https://travis-ci.org/mostlyjs/mostly-node.svg)](https://travis-ci.org/mostlyjs/mostly-node)

MostlyJS is a toolkit to develop distributed microservices in a mostly simple way. It uses [NATS](http://nats.io) as the internal communication system for both service discovery and load balancing. NATS is fast and reliable, and is able to handle millions of request per second.

MostlyJS is targeting breaking current Monolith API application into small services that running on the network transparent to you without knowing where the service physical located.

It provides well integration with existing node frameworks so that you can change a few code to convert your RESTfull api into microservices.

* [Express](http://www.expressjs.com) with [express-gateway](https://github.com/MostlyJS/mostly-demos)
* [Feathers](https://feathersjs.com/) with [mostly-feathers](https://github.com/MostlyJS/mostly-feathers) and [mostly-feathers-rest](https://github.com/MostlyJS/mostly-feathers-rest)
* [Poplarjs](https://github.com/poplarjs/poplar) with [mostly-poplarjs](https://github.com/MostlyJS/mostly-poplarjs) and [mostly-poplarjs-rest](https://github.com/MostlyJS/mostly-poplarjs-rest)

Integration with Koa and Hapi is also planned.

# Documentation

Please see the [documentation site](https://mostlyjs.github.io).

# Usage

## Installation

#### 1. Install Mostly-node and NATS driver
```bash
npm install nats
npm install mostly-node
```

#### 2. Install and Run NATS Server

[https://nats.io/documentation/tutorials/gnatsd-install](https://nats.io/documentation/tutorials/gnatsd-install)

## Quick Example

```javascript
var mostly = require('mostly-node')()

// register the service
mostly.add({topic: 'sample', cmd: 'math'}, function (msg, done) {
  var rate  = 0.13;
  var total = msg.foo * (1 + rate);
  done(null, {total: total});
});

// call the service
mostly.act({topic: 'sample', cmd: 'math', foo: 100}, function (err, result) {
  console.log(result.total);
});
```

# License

MIT