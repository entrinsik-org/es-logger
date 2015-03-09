'use strict';
var chai = require('chai');
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
chai.use(sinonChai);
var should = chai.should();
var expect = chai.expect();
var safestringify = require('json-stringify-safe');

var EntLogger = require('../lib/ent-logger').EntLogger;

describe('Ent Logger', function () {
    var esClient, plugin, logger, config;

    beforeEach(function () {
        esClient = {
            bulk: function (payload, callback) {
                callback(null, {
                    items: ['flushed items array']
                });
            }
        };
        plugin = {
            log: function (tags, message) {

            }
        };
        config = {
            es: {
                index: 'testEsIndex'
            },
            buffer: {
                flushIntervalMillis: 0
            },
            filters: {
                all: true
            }
        };
    });

    function createLogger() {
        logger = new EntLogger(plugin, config, esClient);
    }

    describe('function .onLog', function () {
        it('should add a logEvent to the esWriteBuffer when the filter config allows the event', function () {
            createLogger();
            sinon.stub(logger, 'flushLog');
            should.exist(logger.esWriteBuffer);
            logger.esWriteBuffer.length.should.equal(0);
            logger.onLog({eventType: 'allowed'});
            logger.esWriteBuffer.length.should.equal(1);
            logger.esWriteBuffer[0].should.be.an('object');
        });

        it('should not add a logEvent to the esWriteBuffer when the filter config does not specify allowing the event', function () {
            config.filters = {
                eventType: ['allowedEventType']
            };
            createLogger();
            sinon.stub(logger, 'flushLog');
            should.exist(logger.esWriteBuffer);
            logger.esWriteBuffer.length.should.equal(0);
            logger.onLog({eventType: 'notAllowed'});
            logger.esWriteBuffer.length.should.equal(0);
        });

        it('should add a logEvent to the esWriteBuffer when the configured excludes filter does not match the event', function () {
            config.filters = {
                all: true,
                excludes: {
                    someEventType: {
                        someField: ['someExcludedValue']
                    }
                }
            };
            createLogger();
            var _flushLog = sinon.stub(logger, '_flushLog');
            sinon.stub(logger, 'flushLog');
            should.exist(logger.esWriteBuffer);
            logger.esWriteBuffer.length.should.equal(0);
            logger.onLog({eventType: 'someEventType'});
            logger.esWriteBuffer.length.should.equal(1);
            logger.esWriteBuffer[0].should.be.an('object');
        });

        it('should not add a logEvent to the esWriteBuffer when the configured excludes filter matches the event', function () {
            config.filters = {
                all: true,
                excludes: {
                    all: true
                }
            };
            createLogger();
            var _flushLog = sinon.stub(logger, '_flushLog');
            should.exist(logger.esWriteBuffer);
            logger.esWriteBuffer.length.should.equal(0);
            logger.onLog({eventType: 'included'});
            logger.esWriteBuffer.length.should.equal(0);
        });

        it('should attempt to flush the esWriteBuffer to elasticsearch exactly once when the filter config allows the event', function () {
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onLog({});
            flush.should.have.been.calledOnce;
        });

        it('should not attempt to flush the esWriteBuffer to elasticsearch when the filter config does not specify that the event is allowed', function () {
            config.filters = {
                eventType: ['allowedEventType']
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onLog({});
            flush.should.not.have.been.called;
        });

        it('should attempt to flush the esWriteBuffer to elasticsearch exactly once when the configured excludes filter does not match the event', function () {
            config.filters = {
                all: true,
                excludes: {
                    someEventType: {
                        someField: ['someExcludedValue']
                    }
                }
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onLog({eventType: 'included'});
            flush.should.have.been.calledOnce;
        });

        it('should not attempt to flush the esWriteBuffer to elasticsearch when the configured excludes filter matches the event', function () {
            config.filters = {
                all: true,
                excludes: {
                    all: true
                }
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onLog({eventType: 'included'});
            flush.should.not.have.been.called;
        });

        it('should not assign a timestamp to the logEvent if it initially already has one', function () {
            config.filters = {
                all: true,
                excludes: {
                    all: true
                }
            };
            createLogger();
            var nowSpy = sinon.spy(Date, 'now');
            logger.onLog({eventType: 'included', timestamp: 4});
            nowSpy.should.not.have.been.called;
        });
    });

    describe('function .onRequest', function () {
        var request, event, tags;
        beforeEach(function () {
            request = {
                id: 'requestId',
                raw: {
                    req: {}
                },
                headers: {},
                route: {},
                auth: {},
                server: {}
            };
            event = {

            };
            tags = {

            };
        });

        it('should add a new requestEnvelope to the requestEventQueue keyed by the request parameter\'s id field when the tags parameter contains the \'received\' tag', function () {
            createLogger();
            should.not.exist(logger.requestEventQueue[request.id]);
            logger.onRequest(request, {}, {received: true});
            logger.requestEventQueue[request.id].should.exist;
            logger.requestEventQueue[request.id].should.be.an('object');
        });

        it('should not overwrite an existing requestEnvelope in the requestEventQueue with a new requestEnvelope if the requestEventQueue already contains one with the same request.id but should still add the event to the lifecycle of the existing requestEnvelope', function () {
            createLogger();
            should.not.exist(logger.requestEventQueue[request.id]);
            request.path = 'first';
            logger.onRequest(request, {}, {received: true});
            request.path = 'second'
            logger.onRequest(request, {}, {received: true});
            logger.requestEventQueue[request.id].should.exist;
            logger.requestEventQueue[request.id].path.should.equal('first');
            logger.requestEventQueue[request.id].lifecycle.length.should.equal(2);
        });

        it('should add a new requestEvent to the lifecycle array of the requestEnvolope with matching request.id for each event encountered while a requestEnvelope exists in the requestEventQueue and the configured filters permit the event', function () {
            createLogger();
            should.not.exist(logger.requestEventQueue[request.id]);
            logger.onRequest(request, {data: {value: 'event0'}}, {received: true});
            logger.requestEventQueue[request.id].should.exist;
            logger.requestEventQueue[request.id].lifecycle.length.should.equal(1);
            logger.requestEventQueue[request.id].lifecycle[0].data.value.should.equal('event0');
            logger.onRequest(request, {data: {value: 'event1'}}, {someTag: true});
            logger.requestEventQueue[request.id].lifecycle.length.should.equal(2);
            logger.requestEventQueue[request.id].lifecycle[1].data.value.should.equal('event1');
        });

        it('should ensure the created requestEvent has a \'data\' field that is an object', function () {
            createLogger();
            should.not.exist(logger.requestEventQueue[request.id]);
            logger.onRequest(request, {data: 'event0'}, {received: true});
            logger.requestEventQueue[request.id].should.exist;
            logger.requestEventQueue[request.id].lifecycle.length.should.equal(1);
            should.exist(logger.requestEventQueue[request.id].lifecycle[0].data);
            logger.requestEventQueue[request.id].lifecycle[0].data.should.be.an('object');
            should.exist(logger.requestEventQueue[request.id].lifecycle[0].data.value);
            logger.requestEventQueue[request.id].lifecycle[0].data.value.should.equal('event0');
        });

        it('should not keep the initial requestEnvelope in the requestEventQueue when the initial lifecycle requestEvent matches the configured excludes filter', function () {
            config.filters = {
                all: true,
                excludes: {
                    all: true
                }
            };
            createLogger();
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.onRequest(request, {}, {received: true});
            purge.should.have.been.calledOnce;
        });

        it('should attempt to purge an existing requestEnvelope from the requestEventQueue when a new lifecycle requestEvent matches the configured excludes filter', function () {
            config.filters = {
                all: true,
                excludes: {
                    request: {
                        tags: ['purge when seen']
                    }
                }
            };
            createLogger();
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.onRequest(request, {}, {received: true});
            purge.should.not.have.been.called;
            logger.requestEventQueue[request.id].should.exist;
            logger.requestEventQueue[request.id].lifecycle.length.should.equal(1);
            logger.onRequest(request, {eventType: 'request', tags: ['tag0', 'tag1', 'purge when seen']}, {});
            purge.should.have.been.calledOnce;
        });

        it('should log any instances when the function encounters a request with an id that does not match any envelope in the queue and a new requestEnvelope was not created', function () {
            createLogger();
            var pluginLog = sinon.spy(plugin, 'log');
            logger.onRequest(request, {}, {notReceived: true});
            should.not.exist(logger.requestEventQueue[request.id]);
            pluginLog.should.have.been.calledOnce;
        });
    });

    describe('function .onResponse', function () {
        var request;
        beforeEach(function () {
            request = {
                id: 'requestId',
                response: {},
                info: {}
            };
        });

        it('should attempt to purge the corresponding requestEnvelope from the requestEventQueue when the configured excludes filters match the new responseEvent', function () {
            config.filters.excludes = {
                response: {
                    all: true
                }
            };
            createLogger();
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: []};
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.onResponse(request);
            purge.should.have.been.calledOnce;
        });

        it('should NOT attempt to purge the corresponding requestEnvelope from the requestEventQueue when the responseEvent does not match any of the configured excludes filters', function () {
            config.filters.excludes = {
                response: {
                    someField: ['excludeMe']
                }
            };
            createLogger();
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: []};
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.onResponse(request);
            purge.should.not.have.been.called;
        });

        it('should add the new responseEvent to the corresponding requestEnvelope in the requestEventQueue when the requestEventQueue contains an entry for the responseEvent\' request field (request.id)', function () {
            createLogger();
            var ls = [];
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: ls};
            logger.onResponse(request);
            ls.length.should.equal(1);
        });

        it('should not add the new responseEvent to the requestEnvelope lifecycle when the config filters do not specify that the event should get logged', function () {
            config.filters = {
                eventType: ['request']
            };
            createLogger();
            var ls = [];
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: ls};
            logger.onResponse(request);
            ls.length.should.equal(0);
        });

        it('should calculate a positive responseTime for the responseEvent when the request.info.received numeric field exists', function () {
            createLogger();
            var ls = [];
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: ls};
            request.info = {
                received: 100
            };
            logger.onResponse(request);
            ls.length.should.equal(1);
            should.exist(ls[0].data);
            should.exist(ls[0].data.responseTime);
            ls[0].data.responseTime.should.be.greaterThan(0);
        });

        it('should calculate a negative responseTime for the responseEvent when the request.info.received numeric field does not exist', function () {
            createLogger();
            var ls = [];
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: ls};
            logger.onResponse(request);
            ls.length.should.equal(1);
            should.exist(ls[0].data);
            should.exist(ls[0].data.responseTime);
            ls[0].data.responseTime.should.be.lessThan(0);
        });

        it('should log any instances when the function encounters a response with an id that does not match any envelope in the queue and should not do any processing', function () {
            createLogger();
            var pluginLog = sinon.spy(plugin, 'log');
            logger.onResponse(request);
            pluginLog.should.have.been.calledOnce;
        });
    });

    describe('function .onTail', function () {
        var request;
        beforeEach(function () {
            request = {
                id: 'requestId'
            };
        });

        it('should attempt to purge the corresponding requestEnvelope from the requestEventQueue when the configured excludes filters match the new tailEvent', function () {
            config.filters.excludes = {
                tail: {
                    all: true
                }
            };
            createLogger();
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: []};
            var purge = sinon.stub(logger, 'purgeRequest');
            var flush = sinon.stub(logger, 'flushLog');
            logger.onTail(request);
            purge.should.have.been.calledOnce;
        });

        it('should NOT attempt to purge the corresponding requestEnvelope from the requestEventQueue when the tailEvent does not match any of the configured excludes filters', function () {
            config.filters.excludes = {
                tail: {
                    someField: ['excludeMe']
                }
            };
            createLogger();
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: []};
            var purge = sinon.stub(logger, 'purgeRequest');
            var flush = sinon.stub(logger, 'flushLog');
            logger.onTail(request);
            purge.should.not.have.been.called;
        });

        it('should add the new tailEvent to the lifecycle of the corresponding requestEnvelope if it exists in the requestEventQueue and the tailEvent matches the filter config', function () {
            config.filters = {
                eventType: ['tail']
            };
            createLogger();
            var ls = [];
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: ls};
            logger.onTail(request);
            ls.length.should.equal(1);
        });

        it('should attempt to purge the requestEnvelope from the requestEventQueue when the existing full requestEnvelope does not match the configured filters', function () {
            config.filters = {
                eventType: ['tail']
            };
            createLogger();
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: []};
            logger.onTail(request);
            purge.should.have.been.calledOnce;
        });

        it('should attempt to purge the requestEnvelope from the requestEventQueue when the existing full requestEnvelope matches the configured filters but also matches the configured excludes', function () {
            config.filters = {
                eventType: ['request'],
                excludes: {
                    request: {
                        all: true
                    }
                }
            };
            createLogger();
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: []};
            logger.onTail(request);
            purge.should.have.been.calledOnce;
        });

        it('should add the full requestEnvelope to the esWriteBuffer when the full requestEnvelope matches the configured filters and does not match the configured excludes', function () {
            config.filters = {
                eventType: ['tail', 'request']
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.requestEventQueue[request.id] = {eventType: 'request', data: 'some request stored during onRequest', lifecycle: []};
            logger.onTail(request);
            logger.esWriteBuffer.length.should.equal(1);
        });

        it('should attempt to flush the esWriteBuffer when the full requestEnvelope matches the configured filters and does not match the configured excludes', function () {
            config.filters = {
                eventType: ['tail', 'request']
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.requestEventQueue[request.id] = {eventType: 'request', data: 'some request stored during onRequest', lifecycle: []};
            logger.onTail(request);
            flush.should.have.been.calledOnce;
        });

        it('should log any instances when the function encounters a tail with an id that does not match any envelope in the queue and should not do any processing', function () {
            createLogger();
            var pluginLog = sinon.spy(plugin, 'log');
            var flush = sinon.stub(logger, 'flushLog');
            logger.onTail(request);
            pluginLog.should.have.been.calledOnce;
        });
    });

    describe('function .onInternalError', function () {
        var request, err;
        beforeEach(function () {
            request = {
                id: 'requestId'
            };
            err = {};
        });

        it('should add the new errorEvent to the lifecycle of the corresponding requestEnvelope if it exists in the requestEventQueue and the errorEvent matches the filter config', function () {
            config.filters = {
                eventType: ['internalError']
            };
            createLogger();
            var ls = [];
            var flush = sinon.stub(logger, 'flushLog');
            logger.requestEventQueue[request.id] = {data: 'some request stored during onRequest', lifecycle: ls};
            logger.onInternalError(request, err);
            ls.length.should.equal(1);
        });

        it('should log any instances when the function encounters an internalError that is allowed to get logged but corresponds to a request id that does not match any envelope in the requestEventQueue and should not do any processing', function () {
            createLogger();
            var pluginLog = sinon.spy(plugin, 'log');
            var flush = sinon.stub(logger, 'flushLog');
            logger.onInternalError(request, err);
            pluginLog.should.have.been.calledOnce;
        });

        it('should add the new errorEvent to the esWriteBuffer if the errorEvent matches the configured filters', function () {
            config.filters = {
                eventType: ['internalError']
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onInternalError(request, err);
            logger.esWriteBuffer.length.should.equal(1);
        });

        it('should NOT add the new errorEvent to the esWriteBuffer if the errorEvent does NOT match any of the configured filters', function () {
            config.filters = {
                eventType: ['tail']
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onInternalError(request, err);
            logger.esWriteBuffer.length.should.equal(0);
        });

        it('should attempt to flush the esWriteBuffer to elasticsearch if the errorEvent matches the configured filters', function () {
            config.filters = {
                eventType: ['internalError']
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onInternalError(request, err);
            flush.should.have.been.calledOnce;
        });

        it('should NOT attempt to flush the esWriteBuffer to elasticsearch if the errorEvent does not match any of the configured filters', function () {
            config.filters = {
                eventType: ['tail']
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            logger.onInternalError(request, err);
            flush.should.not.have.been.called;
        });

        it('should attempt to purge the corresponding requestEnvelope from the requestEventQueue if the errorEvent matches any of the configured excludes filters and the event matches the configured filters', function () {
            config.filters = {
                all: true,
                excludes: {
                    internalError: {
                        all: true
                    }
                }
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.onInternalError(request, err);
            flush.should.have.been.calledOnce;
            purge.should.have.been.calledOnce;
        });

        it('should NOT attempt to purge the corresponding requestEnvelope from the requestEventQueue if the errorEvent does not match any of the configured excludes filters and the event matches the configured filters', function () {
            config.filters = {
                all: true,
                excludes: {
                    internalError: {
                        someField: ['someValue']
                    }
                }
            };
            createLogger();
            var flush = sinon.stub(logger, 'flushLog');
            var purge = sinon.stub(logger, 'purgeRequest');
            logger.onInternalError(request, err);
            flush.should.have.been.calledOnce;
            purge.should.not.have.been.called;
        });
    });

    describe('function ._flushLog', function () {
        var clock, purge, logStub, bulkPayload , bulkCallbackErr, bulkCallbackRes;
        beforeEach(function () {
            clock = sinon.useFakeTimers(Date.now());
            config.debug = true;
            config.buffer = {
                flushIntervalMillis: 100
            };
            bulkCallbackErr = {};
            bulkCallbackRes = {
                items: ['array of flushed items (this is just a mock)'],
                took: 123,
                errors: function () {
                    return (bulkCallbackErr && safestringify(bulkCallbackErr)) || null;
                }
            };
            esClient = {
                bulk: function (payload, callback) {
                    bulkPayload = payload;
                    callback(bulkCallbackErr, bulkCallbackRes);
                }
            };

            createLogger();
            purge = sinon.stub(logger, 'purgeRequests');
            logStub = sinon.stub(logger, 'writeLog');
        });
        afterEach(function () {
            clock.restore();
            logger.writeLog.restore();
            logger.purgeRequests.restore();
        });

        it('should attempt to clear the final flush timeout task and nullify the stored _finalFlushTimeoutID when it exists when _flushLog is called', function () {
            var clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
            logger._finalFlushTimeoutID = 'id';
            logger._flushLog();
            clearTimeoutSpy.should.have.been.calledOnce;
            clearTimeoutSpy.should.have.been.calledWith('id');
            should.not.exist(logger._finalFlushTimeoutID);
        });

        it('should NOT attempt to clear the final flush timeout task when no _finalFlushTimeoutID exists when _flushLog is called', function () {
            var clearTimeoutSpy = sinon.spy(clock, 'clearTimeout');
            logger._flushLog();
            clearTimeoutSpy.should.not.have.been.called;
            should.not.exist(logger._finalFlushTimeoutID);
        });

        it('should collect the id of each item in the esWriteBuffer where the item has the eventType of \'request\'', function () {
            var item0 = {eventType: 'someEvent', id: 'someId'};
            var item1 = {eventType: 'request', id: 'requestId'};
            logger.esWriteBuffer.push(item0);
            logger.esWriteBuffer.push(item1);
            logger._flushLog();
            should.exist(bulkPayload);
            should.exist(bulkPayload.body);
            bulkPayload.body.length.should.equal(4);
            purge.should.have.been.calledWith([item1.id]);
        });

        it('should attempt to purge requestEnvelopes from the requestEventQueue using the collected requestIds when there are any', function () {
            var item0 = {eventType: 'someEvent', id: 'someId'};
            var item1 = {eventType: 'request', id: 'requestId'};
            logger.esWriteBuffer.push(item0);
            logger.esWriteBuffer.push(item1);
            logger._flushLog();
            should.exist(bulkPayload);
            should.exist(bulkPayload.body);
            bulkPayload.body.length.should.equal(4);
            purge.should.have.been.calledWith([item1.id]);
        });

        it('should NOT attempt to purge requestEnvelopes from the requestEventQueue when there were no requestIds collected', function () {
            var item0 = {eventType: 'someEvent', id: 'someId'};
            var item1 = {eventType: 'someOtherEvent', id: 'requestId'};
            logger.esWriteBuffer.push(item0);
            logger.esWriteBuffer.push(item1);
            logger._flushLog();
            should.exist(bulkPayload);
            should.exist(bulkPayload.body);
            bulkPayload.body.length.should.equal(4);
            purge.should.not.have.been.called;
        });

        it('should log information to the console when the esClient.bulk() function callback err parameter exists', function () {
            bulkCallbackErr.message = 'callback error message';
            logger.esWriteBuffer.push({eventType: 'someEventType', id: 'someId'});
            logger._flushLog();
            safestringify(logStub.args).should.have.string(bulkCallbackErr.message);
        });

        it('should log information to the console when the esClient.bulk() function callback res parameter exists', function () {
            bulkCallbackErr = null;
            bulkCallbackRes.items = ['item0', 'item1', 'item2'];
            bulkCallbackRes.took = 456;
            var bulkSpy = sinon.spy(esClient, 'bulk');
            logger.esWriteBuffer.push({eventType: 'someEventType', id: 'someId'});
            logger._flushLog();
            bulkSpy.should.have.been.calledOnce;
            safestringify(logStub.args).should.have.string(bulkCallbackRes.items.length + ' messages');
            safestringify(logStub.args).should.have.string(bulkCallbackRes.took + 'ms');
            safestringify(logStub.args).indexOf(bulkCallbackRes.items.length + ' messages').should.be.below(safestringify(logStub.args).indexOf(bulkCallbackRes.took + 'ms'));
        });

        it('should call the esClient.bulk() function when there is something in the buffer to write', function () {
            var bulkSpy = sinon.spy(esClient, 'bulk');
            logger.esWriteBuffer.push({eventType: 'someEventType', id: 'someId'});
            logger._flushLog();
            bulkSpy.should.have.been.calledOnce;
        });

        it('should NOT call the esClient.bulk() function when there nothing in the buffer', function () {
            var bulkSpy = sinon.spy(esClient, 'bulk');
            logger._flushLog();
            bulkSpy.should.not.have.been.called;
        });

        it('should create a final flush timeout task when a call to the esClient.bulk() when there was something in the buffer to write previously', function () {
            var bulkSpy = sinon.spy(esClient, 'bulk');
            logger.esWriteBuffer.push({eventType: 'someEventType', id: 'someId'});
            logger._flushLog();
            bulkSpy.should.have.been.calledOnce;
            should.exist(logger._finalFlushTimeoutID);
        });

    });

    describe('function .purgeRequest', function () {
        beforeEach(function () {
            createLogger();
        });

        it('should wrap the \'requestId\' parameter as a single-element array and pass it as the only parameter in a call to the function .purgeRequests', function () {
            var plural = sinon.stub(logger, 'purgeRequests');
            logger.purgeRequest('id');
            plural.should.have.been.calledWith(['id']);
        });
    });

    describe('function .purgeRequests', function () {
        var EVENTS_IN_QUEUE = 5;
        beforeEach(function () {
            createLogger();
            for (var l = 0; l < EVENTS_IN_QUEUE; l++) {
                logger.requestEventQueue[('id' + l)] = {
                    id: ('id' + l),
                    data: ('queuedRequest' + l)
                };
            }
        });

        it('should not do anything if the requestIdArray parameter does not exist', function () {
            logger.purgeRequests(undefined);
            Object.keys(logger.requestEventQueue).length.should.equal(EVENTS_IN_QUEUE);
        });

        it('should not do anything if the requestIdArray parameter has no elements', function () {
            logger.purgeRequests([]);
            Object.keys(logger.requestEventQueue).length.should.equal(EVENTS_IN_QUEUE);
        });

        it('should completely delete the element for each requestId in the requestIdArray parameter from the requestEventQueue, which should also remove them from memory ie. the requestEventQueue does not know of it any longer', function () {
            sinon.stub(logger, 'writeLog');
            logger.purgeRequests(['id0', 'id3']);
            Object.keys(logger.requestEventQueue).length.should.equal(EVENTS_IN_QUEUE - 2);
            logger.requestEventQueue.should.not.have.keys('id0', 'id3');
            safestringify(logger.requestEventQueue).should.not.have.string('id0');
            safestringify(logger.requestEventQueue).should.not.have.string('id3');
            logger.writeLog.restore();
        });
    });
});