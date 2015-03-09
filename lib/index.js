'use strict';

var hoek = require('hoek');
var Os = require('os');
var pkg = require('../package.json');
var _ = require('lodash');
var safestringify = require('json-stringify-safe');
var EntLogger = require('./ent-logger').EntLogger;


var internals = {
    //operating system info (attach when logging is to occur maybe?)
    osInfo: function () {
        return {
            osHost: Os.hostname(),//server host operating system net hostname
            osFreeMemory: Os.freemem(),//free memory on the server host
            osTotalMemory: Os.totalmem(),//total available memory on the server host
            osUptime: Os.uptime(),//system uptime in seconds
            osArch: Os.arch(),//CPU architecture
            osCPUs: Os.cpus(),//number of CPUs
            osLoadAvg: Os.loadavg(),//1, 5, 15 minute CPU load averages. ideally should be < #logical CPUs in the system
            osNetInterfaces: Os.networkInterfaces()//list of network interfaces
        };
    },

    //most of the defaults below are here for reference of what's possible. the opts have proper defaults. a handful of the events have a few defaulted values
    defaults: {
        opts: {
            //elasticsearch configs
            es: {
                //name of the index within elasticsearch to which the log event messages are written
                index: 'logs'
            },
            buffer: {
                //minimum time interval (in ms) to allow flushing of the buffer to elasticsearch
                flushIntervalMillis: 1000
            }//,
//            filters: {
//                //specify only what is desired to be logged from tags and eventType. can have global 'all:' field or ['all'] value array element as override.
//                all: true,
//                eventType: ['all'],
//                tags: ['all'],
//                //config values that prevent logging and/or fully terminate request tracking & override allowed values. keys are by eventType, values are arrays. can have global 'all:' field or ['all'] value array element as override
//                excludes: {
//                    all: true,
//                    request: {
//                        all: true,
//                        method: ['get'],
//                        path: ['all']
//                    },
//                    response: {
//                        all: true,
//                        statusCode: [304]
//                    },
//                    internalError: {
//                        all: true,
//                        eventType: ['all']
//                    },
//                    tail: {
//                        all: true
//                    }
//                }
//            }
        }
    }
};


/**
 * pushes logging events into elasticsearch so log data can easily get accessed, queried,
 * and analyzed (eg. by i5 itself, Kibana, or other tools)
 *
 * - elasticsearch expects an 'index' name to write to. By default index='logs', but the value can be
 * configured in the plugin options supplied via config.js.
 * - elasticsearch expects a 'type' which will be determined and created internally based on the
 *      hapi event type ('log', 'request', 'response', 'internalError', 'tail')
 *
 * this plugin is configurable in $INFORMER_ROOT/config.js
 *
 * @param server
 * @param opts -> es { index: <elasticsearchIndexName> }, buffer { flushIntervalMillis: <msIntervalToThrottleBufferFlushing>, maxSize: <sizeBasedAutoFlushThreshold>, maxLength: <lengthBasedAutoFlushThreshold> }, filters: { eventType: <eventTypeStringArray>, tags: <tagStringArray>, excludes: { <eventType>: { <eventTypeKeys>: <eventTypeKeyValueArray> } } }
 * @param next
 */
module.exports.register = function (server, opts, next) {
    server.log(['ent-log', 'info'], 'Arrived @ "ent-log/index.js" -- registering with HAPI server events...');
    server.log(['ent-log', 'info'], 'opts:');
    server.log(['ent-log', 'info'], opts);
    server.log(['ent-log', 'info'], 'Operating System:\n' + safestringify(internals.osInfo()));

    var esClient = server.plugins['ent-elasticsearch'].client;

    //configuration validation. 1st param = validation criteria. 2nd is violation error message.
    hoek.assert( (!opts.es && !opts.es.index) || (opts.es.index && typeof opts.es.index === 'string' && opts.es.index.length > 0), 'Invalid ent-log configuration: "ent-log.es.index" must either not exist or have non-zero-length string value when specified. If not specified, value will default to "logs".');
    hoek.assert( (!opts.buffer && !opts.buffer.flushIntervalMillis) || (opts.buffer.flushIntervalMillis && typeof opts.buffer.flushIntervalMillis === 'number' && opts.buffer.flushIntervalMillis >= 0), 'Invalid ent-log configuration: "ent-log.buffer.flushIntervalMillis" must either not exist or have number value >= 0 when specified). If not specified, value will default to 1000.');
    // ... other config validation for filters goes here

    var config = hoek.applyToDefaults(internals.defaults.opts, opts);
    var entLogger = new EntLogger(server, config, esClient);

    //test route that spits out a log message that should emit a 'request' event and should occur during the lifecycle of the route's http request
    server.route({
        config: {
            auth: false,
            handler: function (request, reply) {
                request.log(['request', 'info'], 'api request.log() test. remember to check if hapiRequestEvent.data is string or obj. it must be obj for ES.');
                reply();
            }
        },
        path: '/api/test',
        method: 'GET'
    });

    //=================================================================================
    //hapi event handlers - need to invoke the handler functions ensuring 'this' is the logger & not the
    // EventEmitter because the EventEmitter invokes the handler functions using .call() and assigns the EventEmitter
    // to 'this' but the handlers expect 'this' to be the handler object.
    server.on('log', entLogger.onLog.bind(entLogger));
    server.on('request', entLogger.onRequest.bind(entLogger));
    server.on('response', entLogger.onResponse.bind(entLogger));
    server.on('tail', entLogger.onTail.bind(entLogger));
    server.on('internalError', entLogger.onInternalError.bind(entLogger));

    next();
};

module.exports.register.attributes = {
    pkg: require('../package.json')
};
