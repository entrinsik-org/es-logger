'use strict';

var should = require('chai').should();
var EventValidator = require('../lib/event-validator').EventValidator;

describe('Event Validator', function () {
    var ev, config;

    describe('function .shouldLog', function () {
        beforeEach(function () {
            config = {};
        });

        it('should return false when there are no filters configured', function () {
            ev = new EventValidator(config);
            ev.shouldLog({}).should.equal(false);
        });

        it('should return false when there is no entHapiEvent', function () {
            config = {
                filters: {
                    field: 'value'
                }
            };
            ev = new EventValidator(config);
            ev.shouldLog(undefined).should.equal(false);
        });

        it('should return true when the configured filters has the global "all:" override field', function () {
            config = {
                filters: {
                    all: true
                }
            };
            ev = new EventValidator(config);
            ev.shouldLog({}).should.equal(true);
        });

        it('should return true when the entHapiEvent matches the eventType filter', function () {
            config = {
                filters: {
                    eventType: ['eventType']
                }
            };
            ev = new EventValidator(config);
            ev.shouldLog({
                eventType: 'eventType'
            }).should.equal(true);
        });

        it('should return true when the entHapiEvent matches the tags filter', function () {
            config = {
                filters: {
                    tags: ['tag0']
                }
            };
            ev = new EventValidator(config);
            ev.shouldLog({
                tags: ['tag', 'tagg', 'tag0', 'tag1']
            }).should.equal(true);
        });

        it('should return false when the entHapiEvent does not match either the filtereventType or tags filters', function () {
            config = {
                filters: {
                    eventType: 'filterEventType',
                    tags: ['filterTag0', 'filterTag1']
                }
            };
            ev = new EventValidator(config);
            ev.shouldLog({
                eventType: 'eventType',
                tags: ['eventTag0', 'eventTag1']
            }).should.equal(false);
        });
    });

    describe('function .shouldExclude', function(){
        beforeEach(function () {
            config = {};
        });

        it('should return false when there are no configured filters', function () {
            ev = new EventValidator(config);
            ev.shouldExclude({}).should.equal(false);
        });

        it('should return false when there is no entHapiEvent', function () {
            config = {
                filters: {
                }
            };
            ev = new EventValidator(config);
            ev.shouldExclude(undefined).should.equal(false);
        });

        it('should return false when there is no configured "excludes" filters field', function () {
            config = {
                filters: {
                    field: 'value'
                }
            };
            ev = new EventValidator(config);
            ev.shouldExclude({}).should.equal(false);
        });

        it('should return false when the entHapiEvent does not match the configured excludes filters field', function () {
            config = {
                filters: {
                    excludes: {
                        someEventType: {
                            excludedField: 'excludedValue'
                        }
                    }
                }
            };
            ev = new EventValidator(config);
            ev.shouldExclude({
                eventType: 'someEventType',
                nonMatchingField: 'nonMatchingValue'
            }).should.equal(false);
        });

        it('should return true when the entHapiEvent matches a configured excludes filters field', function () {
            config = {
                filters: {
                    excludes: {
                        someEventType: {
                            excludedField: 'matchingValue'
                        }
                    }
                }
            };
            ev = new EventValidator(config);
            ev.shouldExclude({
                eventType: 'someEventType',
                excludedField: 'matchingValue'
            }).should.equal(true);
        });
    })
});