'use strict';

var should = require('chai').should();
var EventMatcher = require('../lib/event-matcher').EventMatcher;


describe('Event Matcher', function(){
    var em;
    beforeEach(function(){
        em = new EventMatcher();
    });

    describe('function .matchEventTypes', function(){
        it('should return false when there is no filterEventType array', function () {
            em.matchEventTypes(undefined, {}).should.equal(false);
        });

        it('should return false when there is no entHapiEvent object', function () {
            em.matchEventTypes([], undefined).should.equal(false);
        });

        it('should return true when the filterEventTypes array contains the "all" override keyword', function () {
            em.matchEventTypes(['all'], {eventType: 'type'}).should.equal(true);
        });

        it('should return false when entHapiEvent.eventType field does not exist', function () {
            em.matchEventTypes([], {someKey: 'someValue'}).should.equal(false);
        });

        it('should return false when entHapiEvent.eventType is the constant "__neverlog__"', function () {
            em.matchEventTypes([], {eventType: '__neverlog__'}).should.equal(false);
        });

        it('should return true whene the filterEventTypes array contains the entHapiEvent.eventType value', function () {
            em.matchEventTypes(['something', 'someType'], {eventType: 'someType'}).should.equal(true);
        });
    });

    describe('function .matchTags', function(){
        it('should return false when there is no filterTags array', function () {
            em.matchTags(undefined, {key: 'value'}).should.equal(false);
        });

        it('should return false when there is no entHapiEvent object', function () {
            em.matchTags(['tag'], undefined).should.equal(false);
        });

        it('should return true when the filterTags array contains the "all" override keyword', function () {
            em.matchTags(['tag', 'all'], {key: 'value'}).should.equal(true);
        });

        it('should return false when entHapiEvent.tags field does not exist', function () {
            em.matchTags(['filter'], {key: 'value'}).should.equal(false);
        });

        it('should return false when entHapiEvent.tags field exists but its value is not an array', function () {
            em.matchTags([], {tags: 'not an array'}).should.equal(false);
        });

        it('should return false when entHapiEvent.tags field array exists but has no elements', function () {
            em.matchTags(['filter'], {tags: []}).should.equal(false);
        });

        it('should return false when entHapiEvent.tags contains the constant "__neverlog__"', function () {
            em.matchTags(['filter'], {tags: ['tag0', '__neverlog__']}).should.equal(false);
        });

        it('should return true when at least 1 of the filterTags array elements matches one of the entHapiEvent.tags array elements', function () {
            em.matchTags(['filter', 'other-filter'], {tags: ['other-filter']}).should.equal(true);
        });

        it('should return false when none of the filterTags array elements match any of the entHapiEvent.tags array elements', function () {
            em.matchTags(['filter'], {tags: ['other-filter']}).should.equal(false);
        });
    });

    describe('function .matchExcludes', function(){
        it('should return false when there is no filterExcludes object', function () {
            em.matchExcludes(undefined, {}).should.equal(false);
        });

        it('should return false when there is no entHapiEvent object', function () {
            em.matchExcludes({}, undefined).should.equal(false);
        });

        it('should return true if the filterExcludes object has the "all:" field defined', function () {
            em.matchExcludes({all: true}, {}).should.equal(true);
        });

        it('should return false if the entHapiEvent has no eventType field', function () {
            em.matchExcludes({}, {key: 'not event type'}).should.equal(false);
        });

        it('should return false if the filterExcludes object does not have a field for the entHapiEvent\'s eventType', function () {
            em.matchExcludes({excludesEventType: 'someValue'}, {eventType: 'event_eventType'}).should.equal(false);
        });

        it('should return true if the exclude filter matching the entHapiEvent.eventType has the "all:" override field defined', function () {
            em.matchExcludes({someEvent: {all: true}}, {eventType: 'someEvent'}).should.equal(true);
        });

        it('should return true if the entHapiEvent.eventType\'s exclude filter has the "all" override keyword as an element in the value array for a field that exists in the entHapiEvent object', function () {
            em.matchExcludes({someEvent: {someField: ['something', 'all']}}, {eventType: 'someEvent', someField: 'someValue'}).should.equal(true);
        });

        it('should return true if one of the values in the array of one of the fields in the excludeFilter matches at least one of the values for that same field in the entHapiEvent', function () {
            em.matchExcludes({someEventType: {someField: ['shouldFilter']}}, {eventType: 'someEventType', aField: {someField: ['event0', 'shouldFilter']}}).should.equal(true);
        });

        it('should return false if none of the values in the array of one of the fields in the excludeFilter matches any of the values for that same field in the entHapiEvent', function () {
            em.matchExcludes({someEvent: {someField: ['notFiltering']}}, {eventType: 'someEvent', aField: {someField: 'no match'}}).should.equal(false);
        });
    });

    describe('function .pluckAllValues', function(){
        it('should return an empty array when there is no obj defined', function () {
            em.pluckAllValues(undefined, 'targetKey').should.be.empty;
        });

        it('should return an empty array when there is no targetKey', function () {
            em.pluckAllValues({}, undefined).should.be.empty;
        });

        it('should return an array containing all values for all occurrances of the targetKey in obj at any depth', function () {
            var obj = {
                key0: 'key0.val0',
                key1: {
                    key0: 'key1.key0.val0'
                },
                key2: {
                    key1: {
                        key0: 'key2.key1.key0.val0'
                    }
                }
            };
            var result = em.pluckAllValues(obj, 'key0');
            result.should.exist;
            result.should.not.be.empty;
            result.length.should.equal(3);
            result.should.eql(['key0.val0', 'key1.key0.val0', 'key2.key1.key0.val0']);
        });

        it('should always return a flat array of values even when a value for the targetKey in obj is an array', function () {
            var obj = {
                key0: 'key0.val0',
                key1: {
                    key0: ['key1.key0.val0', 'key1.key0.val1']
                }
            };
            var result = em.pluckAllValues(obj, 'key0');
            result.should.exist;
            result.should.not.be.empty;
            result.length.should.equal(3);
            result.should.eql(['key0.val0', 'key1.key0.val0', 'key1.key0.val1']);
        });

        it('should always return a flat array of values even when the targetKey in obj actually resides within an array of objects', function () {
            var obj = {
                arrayOfObjects: [
                    {
                        key0: '[0].key0'
                    },
                    {
                        key0: ['[1].key0[0]', '[1].key0[1]']
                    },
                    {
                        key2: ['[2].key2']
                    },
                    {
                        key1: [
                            {
                                someKey: '[3].key1[0].someVal'
                            },
                            {
                                key0: '[3].key1[1].key0'
                            }
                        ]
                    }
                ]
            };
            var result = em.pluckAllValues(obj, 'key0');
            result.should.exist;
            result.should.not.be.empty;
            result.length.should.equal(4);
            result.should.eql(['[0].key0', '[1].key0[0]', '[1].key0[1]', '[3].key1[1].key0']);
        });
    });

});