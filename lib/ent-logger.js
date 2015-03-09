'use strict';

var hoek = require('hoek');
var _ = require('lodash');
var safestringify = require('json-stringify-safe');
var Os = require('os');
var EventValidator = require('./event-validator').EventValidator;

var internals = {};

internals.defaults = {
    //===================   'log' elasticsearch index   ==================
    //LOG event ('log' elasticsearch index)
    _hapiLog: {
        eventType: 'log',//elasticsearch _type
        server: Os.hostname(),//defaults to Os.hostname()
        timestamp: null,
        tags: [],//subscriber name, plugin name, log level etc.
        data: {}//message
    },
    //==================    'request' elasticsearch index   ==================
    //REQUEST event envelope defaults (and structure for watered down obj)
    _requestEnvelope: {
        eventType: 'request',//elasticsearch _type
        id: null,
        timestamp: null,
        path: null,
        query: {},
        method: null,
        httpVersion: null,
        headers: {//actual Node request headers (host, connection, accept, 'user-agent', referrer)
            host: null,
            connection: null,
            user_agent: null,
            referrer: null
        },
        isRouteAuthRequired: null, //route.auth (true/false - if this route requires authentication)
        isRequestAuthenticated: null, //auth information at this state (isAuthenticated, credentials, artifacts, session)
        remoteInfo: {//additional info about the request & its origin (receivedTimestamp, remoteAddress, remotePort, referrer, host, acceptEncoding)
            received: null,//timestamp when initial request received
            remoteAddress: null,//source IP of request
            referrer: null,//previous page
            host: null//request target host
        },
        serverInfo: {
            host: null,
            port: null,
            protocol: null,
            uri: null
        },
        lifecycle: []//sequence of related hapi events emitted+handled during the lifecycle of the request
    },
    //REQUEST (request lifecycle event)
    _hapiRequest: {
        eventType: 'request',
        request: null,//the corresponding request ID
        timestamp: null,//timestamp
        tags: [],//['hapi', {'received'|'handler'|'response'|...}]
        data: {}//received:(id, method, url, agent) | handler:(msec) | response:(undefined)
    },
    //RESPONSE (request lifecycle event)
    _hapiResponse: {
        eventType: 'response',//elasticsearch _type
        request: null,//corresponding request.id
        timestamp: null,//timestamp of this event
        data: {
            statusCode: 400,//default the statusCode to 'Bad Request' b/c the request is no good until we're told otherwise
            responseTime: -1//default the responseTime to -1, meaning it hasn't returned yet
        }
    },
    //TAIL (request lifecycle event)
    _hapiTail: {
        eventType: 'tail',//elasticsearch _type
        request: null,//corresponsing request.id
        timestamp: null//timestamp of this event
    },

    //==================    'internalError' elasticsearch index    ==================
    //INTERNAL ERROR (500 error, request lifecycle event, independent elasticsearch index)
    _internalError: {
        eventType: 'internalError',//elasticsearch _type
        request: null,//corresponding request.id
        timestamp: null,//timestamp of this event
        err: null//error message and other info
    }
};


function EntLogger(plugin, config, esClient) {
    this.plugin = plugin;
    //config settings passed to this plugin via opts in config.js
    this.config = config;
    this.esClient = esClient;
    //queue of 'request' events awaiting their matching 'tail' events to be emitted so they can all get combined together into 1 log message. is object so elements can actually be deleted from memory
    this.requestEventQueue = {};
    //buffer of log messages waiting to be flushed to elasticsearch
    this.esWriteBuffer = [];

    this.validator = new EventValidator(this.config);

    this.flushLog = _.throttle(this._flushLog.bind(this), this.config.buffer.flushIntervalMillis, {leading: false, trailing: true});
}

/**
 * emitted by the 'log' event via plugin.log() or server.log()
 *
 * the log event should only get flushed if:
 *  - the configured filters.eventType array contains the eventType 'log' or 'all'
 *  - at least one element in the configured filters.tags array matches one of the event's tags or the filters.tags array contains 'all'
 *  - no 'excludes' are met for the 'log' eventType. (any met exclude will always prevent flushing of a log event)
 * @param event
 */
EntLogger.prototype.onLog = function (event) {
    var logEvent = hoek.applyToDefaults(internals.defaults._hapiLog, event);
    if (!logEvent.timestamp)
        logEvent.timestamp = Date.now();
    if (this.validator.shouldLog(logEvent) && !this.validator.shouldExclude(logEvent)) {
        this.esWriteBuffer.push(logEvent);
        this.flushLog();
    }
};

/**
 * each individual server 'request' emits this event N-times during the lifecycle of an http request
 * and will emit these 'request' events any time 'reqest.log' is called during the lifecycle.
 * Tags tend to indicate state: eg. ['received', 'handler', 'response', 'tail'] along with
 * the 'hapi' tag if the event was generated internally by hapi. The 'request' in the
 * handler function is the hapi request -- the raw Node http request can
 * be accessed through 'request.raw.req'.
 *
 * Some known tag configurations for 'request' events:
 *      Tags: ['hapi', 'received'] -> initial event emission
 *          - upon event receipt + hapi request creation
 *
 *      Tags: ['hapi', 'handler'] -> intermediate emission
 *          - event.data.msec will contain numeric data corresponding to processing time of the request
 *
 *      Tags: ['hapi', 'response'] -> final event emission
 *          - after sending response & before actual logging of the event to subscribers in good
 *
 * A request should only go to elasticsearch once that request.id has gone full circle (gets a tail) so
 * this handler stores pertinent info for open hapi request events, creating when necessary,
 * and handles tracking additional 'request' events from the lifecycle of each open http request
 * if it is allowed based on configured filters.
 * @param request
 * @param event
 * @param tags
 */
EntLogger.prototype.onRequest = function (request, event, tags) {
    if (tags.received && !this.requestEventQueue[request.id]) {
        var requestEnvelope = hoek.applyToDefaults(internals.defaults._requestEnvelope, {
            id: request.id,
            timestamp: Date.now(),
            path: request.path,
            query: request.query,
            method: request.method,
            httpVersion: request.raw.req.httpVersion,
            headers: {
                host: request.headers.host,
                connection: request.headers.connection,
                user_agent: request.headers['user-agent'],
                referrer: request.headers.referrer
            },
            isRouteAuthRequired: request.route.auth,
            isRequestAuthenticated: request.auth.isAuthenticated,
            remoteInfo: request.info,
            serverInfo: request.server.info,
            lifecycle: []
        });
        this.requestEventQueue[requestEnvelope.id] = requestEnvelope;
    }
    //there is possibility of emission of other request events associated with the initial request event (eg. handler, response, other custom ones)
    // locate the request by its id and push a copy of the hapi event onto the requestEvent's lifecycle
    if (this.requestEventQueue[request.id]) {
        //clone the corresonding hapi event and push it into the request event's lifecycle
        var requestEvent = hoek.applyToDefaults(internals.defaults._hapiRequest, event);
        if (requestEvent.data && !(_.isObject(requestEvent.data))) {
            //must make the data field consistent as an object (b/c 'data' on the hapi event can be string OR object
            requestEvent.data = {
                value: requestEvent.data
            };
        }
        if (this.validator.shouldExclude(requestEvent)) {
            this.purgeRequest(request.id);
        }
        if (this.requestEventQueue[request.id] && this.validator.shouldLog(requestEvent)) {
            this.requestEventQueue[request.id].lifecycle.push(requestEvent);
        }
    } else {
        //somehow we got a request event id that's unknown
        this.plugin.log(['ent-log', 'request', 'error', 'ent-log-internal'], '"request" event with unrecognized request.id=' + request.id + ' - Most likely it was previously discarded due to exclude config.');
    }
};

/**
 * emitted AFTER the http response has been sent to the client. This handler
 * locates the cached request matching this response event (by request.id) which should be
 * in the requestEventQueue if it wasn't excluded during its lifecycle. It then extracts
 * pertitnent information from the response and stores it in the lifecycle of its
 * corresponding request in the requestEventQueue if it is allowed based on configured
 * filters.
 *
 * Only 1 of these happens per request.
 * @param request
 */
EntLogger.prototype.onResponse = function (request) {
    if (this.requestEventQueue[request.id]) {
        var responseEvent = hoek.applyToDefaults(internals.defaults._hapiResponse, {
            request: request.id,
            timestamp: Date.now(),
            data: {
                statusCode: request.response.statusCode,
                responseTime: Date.now() - Number(request.info.received || (Date.now() + 1))//round-trip response time (received -> response)
            }
        });
        if (this.validator.shouldExclude(responseEvent)) {
            this.purgeRequest(responseEvent.request);
        }
        if (this.requestEventQueue[responseEvent.request] && this.validator.shouldLog(responseEvent)) {
            this.requestEventQueue[responseEvent.request].lifecycle.push(responseEvent);
        }
    } else {
        //otherwise, somehow we got a request event id that's unknown
        this.plugin.log(['ent-log', 'response', 'error', 'ent-log-internal'], '"response" event with unrecognized request.id=' + request.id + ' - Most likely it was previously discarded due to exclude config.');
    }
};

/**
 * emitted when all tail functions have completed for a request, meaning the request has completed
 * its full lifecycle. This 'tail' event occurs at the very end of the request lifecycle
 * but AFTER the request is sent to the client + ALL tails are done, if any. The 'tail' event is always emitted
 * regardless of the existence of tail functions. A request is not complete
 * until this event is emitted for it.
 *
 * Only 1 of these happens per request.
 *
 * THIS method should be the only method in the request lifecycle that attempts to trigger
 * a flush to elasticsearch since a request is not complete until this occurs, and therefore
 * should not be logged until then.
 *
 * This handles retrieves the request event by its id, adds pertinent tail information to the
 * request event lifecycle, and queues the completed request event for flushing to elasticsearch
 * if it is allowed based on configured filters.
 * @param request
 */
EntLogger.prototype.onTail = function (request) {
    if (this.requestEventQueue[request.id]) {
        var tailEvent = hoek.applyToDefaults(internals.defaults._hapiTail, {
            request: request.id,
            timestamp: Date.now()
        });
        if (this.validator.shouldExclude(tailEvent)) {
            this.purgeRequest(tailEvent.request);
        }
        if (this.requestEventQueue[tailEvent.request]) {
            if (this.validator.shouldLog(tailEvent)) {
                this.requestEventQueue[tailEvent.request].lifecycle.push(tailEvent);
            }
            var fullRequest = this.requestEventQueue[tailEvent.request];
            if (this.validator.shouldLog(fullRequest) && !this.validator.shouldExclude(fullRequest)) {
                this.esWriteBuffer.push(fullRequest);
                this.flushLog();
            } else {
                this.purgeRequest(tailEvent.request);
            }
        }
    } else {
        //otherwise, somehow we got a request event id that's unknown
        this.plugin.log(['ent-log', 'tail', 'error', 'ent-log-internal'], '"tail" event with unrecognized request.id=' + request.id + ' - Most likely it was previously discarded due to exclude config.');
    }
};

/**
 * emitted whenever an Internal Server Error (500) error response is sent.
 * This handler extracts pertinent informtaion and then adds it to the corresponding queued
 * request's lifecycle and flushes to elasticsearch if it is allowed based on configured filters
 *
 * Only 1 of these happens per request.
 * @param request
 * @param err
 */
EntLogger.prototype.onInternalError = function (request, err) {
    var errorEvent = hoek.applyToDefaults(internals.defaults._internalError, {
        request: request.id,
        timestamp: Date.now(),
        err: err
    });
    if (this.validator.shouldLog(errorEvent)) {
        if (this.requestEventQueue[request.id]) {
            //if the request event is still around, push this error onto that request event's lifecycle
            this.requestEventQueue[errorEvent.request].lifecycle.push(errorEvent);
        } else {
            //otherwise, somehow we got a request event id that's unknown
            this.plugin.log(['ent-log', 'internalError', 'error', 'ent-log-internal'], '"internalError" event with unrecognized request.id=' + request.id + ' - Most likely it was previously discarded due to exclude config.');
        }
        //internalErrors always logged to their own elasticsearch _type
        this.esWriteBuffer.push(errorEvent);
        this.flushLog();
        if (this.validator.shouldExclude(errorEvent)) {
            this.purgeRequest(errorEvent.request);
        }
    }
};


/**
 * massages the contents of the esWriteBuffer into a body format that the elasticsearch .bulk(...)
 * function recognizes, flushes that body to elasticsearch, and manages the toggling of a
 * final flush to occur 5 flush intervals of idle time after the last completed flush in order
 * to ensure the esWriteBuffer is truly empty. After the schedule idle-time check is performed and
 * confirms the esWriteBuffer is empty, this method goes to sleep until awakened by the next valid
 * call to the throttled delegate function.
 *
 * This function gets throttled during plugin init (with the help of lodash.throttle(...) to only get executed every
 * N-millis based on the flush interval value configured in the plugin opts (or the default value of 1000ms [1s])
 *
 * @private
 */
EntLogger.prototype._flushLog = function () {
    var self = this;

    if (self._finalFlushTimeoutID) {
        self.writeLog(Date.now() + '\tent-log: Clearing final idle-time log message queue flush task...');
        clearTimeout(self._finalFlushTimeoutID);
        self._finalFlushTimeoutID = null;
    }
    self.writeLog(Date.now() + '\tent-log: Checking log message buffer...');
    var buff = self.esWriteBuffer;
    self.esWriteBuffer = [];
    if (buff && buff.length > 0) {
        self.writeLog(Date.now() + '\tent-log: Preparing ' + buff.length + ' messages for flush...');
        var flushedRequests = [];
        var body = buff.reduce(function (acc, item) {
            acc.push({index: {_index: self.config.es.index, _type: item.eventType}}, safestringify(item));
            if (item.eventType === 'request')
                flushedRequests.push(item.id);
            return acc;
        }, []);
        if (body && body.length > 0) {
            self.esClient.bulk({
                body: body
            }, function (err, res) {
                if (err) {
                    self.writeLog(Date.now() + '\tent-log: Elasticsearch Error err: ' + safestringify(err));
                    self.writeLog(Date.now() + '\tent-log: Elasticsearch Error res: ' + safestringify(res));
                }
                if (res) {
                    self.writeLog(Date.now() + '\tent-log: Flushed ' + (res.items ? res.items.length || 0 : '-1 (error likely)') + ' messages to elasticsearch in ' + res.took + 'ms ' + (res.errors ? '---> some error(s) occurred: ' + safestringify(res) : ''));
                }
                if (flushedRequests.length > 0)
                    self.purgeRequests(flushedRequests);
                self.writeLog(Date.now() + '\tent-log: requestQueue has ' + Object.keys(self.requestEventQueue).length + ' requests waiting for "tail".');
            });
        }
        self.writeLog(Date.now() + '\tent-log: Scheduling final idle-time log message queue flush task <=' + (self.config.buffer.flushIntervalMillis * 5) + 'ms from now...');
        self._finalFlushTimeoutID = setTimeout(self.flushLog, self.config.buffer.flushIntervalMillis * 5);
    } else {
        self.writeLog(Date.now() + '\tent-log: No remaining log messages queued for flush. Here is your cab fare. Entering sleep mode. zzzzzzzzzzzz');
    }
};

/**
 * convenience function to purge a single requestId
 * @param requestId id of the request to purge from the requestEventQueue if it exists there
 */
EntLogger.prototype.purgeRequest = function (requestId) {
    this.purgeRequests([requestId]);
};

/**
 * purges each of the supplied requestIds from the requestEventQueue if they exist
 * @param requestIdArray array of ids corresponding to keys in the requestEventQueue that should be purged from that queue obj
 */
EntLogger.prototype.purgeRequests = function (requestIdArray) {
    var self = this;
    if (requestIdArray && requestIdArray.length > 0) {
        self.writeLog(Date.now() + '\tent-log: Purging ' + requestIdArray.length + ' requests from requestQueue(size=' + Object.keys(self.requestEventQueue).length + ')...');
        requestIdArray.forEach(function (id) {
            delete self.requestEventQueue[id];
        });
    }
};

EntLogger.prototype.writeLog = function (message) {
    if (this.config.debug)
        console.log(Date.now() + message);
};

exports.EntLogger = EntLogger;