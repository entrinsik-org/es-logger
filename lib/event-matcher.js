'use strict';

var _ = require('lodash');
var safestringify = require('json-stringify-safe');

var internals = {};

internals.constants = {
    NEVER_LOG: '__neverlog__',//internal constant override to never log this event to elasticsearch
    ALL: 'all'
};

function EventMatcher(){

}

/**
 * compares the entHapiEvent's eventType property value to the array of filterEventTypes. if the filterEventTypes
 * contains the entHapiEvent's eventType, then a match was found and the function returns true.
 * This function also takes into account the eventType override 'all' which, when exists in the
 * filterEventTypes array, will cause this function to return true prior to comparing against the
 * entHapiEvent.
 * This function also takes into account the eventType '__neverlog__' which, when exists as the entHapiEvent's
 * eventType value, will always cause the function to return false except when the 'all' override exists in
 * the configuration.
 * @param filterEventTypes array of eventType strings
 * @param entHapiEvent event being checked to have an 'eventType' matching one of the elements in the filterEventTypes
 * @returns {*}
 */
EventMatcher.prototype.matchEventTypes = function (filterEventTypes, entHapiEvent) {
    //filterEventTypes is always an array of eventType strings
    if (!filterEventTypes || !entHapiEvent)
        return false;
    if (filterEventTypes.indexOf(internals.constants.ALL) >= 0)
        return true;
    if(!entHapiEvent.eventType)
        return false;
    return entHapiEvent.eventType !== internals.constants.NEVER_LOG && filterEventTypes.indexOf(entHapiEvent.eventType) >= 0;
};

/**
 * compares the entHapiEvent's tags property value to the array of filterTags. If the entHapiEvent's
 * tags array contains at least one of the tags if the filterTags array, then a match was found
 * and the function returns true.
 * This function also takes into account the tags override 'all' which,
 * when exists in the filterTags array, will cause this function to return true prior to
 * performing any comparisons against the entHapiEvent.
 * This function also takes into account the tag '__neverlog__' which, when exists in the entHapiEvent's
 * tags array, will cause this function to return false except when the 'all' override exists in the
 * configuration.
 * @param filterTags
 * @param entHapiEvent
 * @returns {*}
 */
EventMatcher.prototype.matchTags = function (filterTags, entHapiEvent) {
    //filterTags is always an array of tag strings
    if (!filterTags || !entHapiEvent)
        return false;
    if (filterTags.indexOf(internals.constants.ALL) >= 0)
        return true;
    if (!entHapiEvent.tags || !Array.isArray(entHapiEvent.tags) || entHapiEvent.tags.length === 0 || entHapiEvent.tags.indexOf(internals.constants.NEVER_LOG) >= 0)
        return false;

    var eventContainsFilterTag = function (filterTag) {
        return entHapiEvent.tags.indexOf(filterTag) >= 0;
    };
    return filterTags.some(eventContainsFilterTag);
};

/**
 * locates the 'excludes' configuration object for the entHapiEvent's eventType and, when present,
 * iterates through each of the keys of that configured exclude object and searches
 * the entHapiEvent plucking all values of all occurances of that key. if any of the plucked entHapiEvent
 * values matches an element of that configured exclude object key's value array, the function
 * returns true, which will prevent the entHapiEvent from being logged to elasticsearch (and
 * will also prevent its owning container from being logged as well in the case of request
 * lifecycle events having a matching exclude config).
 * This function also takes into account the global 'all' override which, when specified as a top-level
 * excludes key, overrides all other exclude configuration settings regardless of eventType.
 * This function also takes into account an eventType 'all' override which, when specified as a top-level
 * key for an eventType's exclude config, overrides all other exclude configurations settings for that
 * specific eventType.
 * This function also takes into account an 'all' array element override which, when exists in the
 * value array for a key in an eventType's exclude config, overrides any other configured values that would otherwise
 * cause exclusion for that specific eventType's key and causes the function to return true prior to
 * involving any plucking of / comparing with the entHapiEvent.
 * @param filterExcludes
 * @param entHapiEvent
 * @returns {*}
 */
EventMatcher.prototype.matchExcludes = function (filterExcludes, entHapiEvent) {
    var self = this;
    if (!filterExcludes || !entHapiEvent)
        return false;
    if (filterExcludes.all)
        return true;
    if (!entHapiEvent.eventType || !filterExcludes[entHapiEvent.eventType])
        return false;

    var excludeFilter = filterExcludes[entHapiEvent.eventType];
    if (excludeFilter.all)
        return true;
    //each key in the exclude filter is assumed to be a leaf key of the entHapiEvent and its value is an array of values for that key that invalidates the event
    var excludeFilterKeys = Object.keys(excludeFilter);
    return excludeFilterKeys.some(function (excludeFilterKey) {
        var excludeFilterValueArray = excludeFilter[excludeFilterKey];
        if (excludeFilterValueArray.indexOf(internals.constants.ALL) >= 0)
            return true;
        var eventValueArray = self.pluckAllValues(entHapiEvent, excludeFilterKey);
        return eventValueArray.some(function (eventValue) {
            return eventValue && (excludeFilterValueArray.indexOf(eventValue) >= 0 || safestringify(excludeFilterValueArray).indexOf(safestringify(eventValue)) >= 0);
        });
    });
};

/**
 * plucks the values of all occurrances of targetKey in the obj
 * and returns them in a flat array. the targetKey is assumed to be
 * a leaf key, as this function returns an array of all values for the targetKey
 * regardless of how deep the targetKey occurs
 *
 * @param obj object to search in
 * @param targetKey the key to pluck all values for
 * @returns {*}
 */
EventMatcher.prototype.pluckAllValues = function (obj, targetKey) {
    var self = this;
    if (!obj || !targetKey) return [];
    var acc = [];
    //either pluck each array element or object key/value pair
    if (Array.isArray(obj)) {
        //pluck all of each array element
        obj.forEach(function (val) {
            var res = self.pluckAllValues(val, targetKey);
            if (res)
                acc.push(_.flatten(res));
        });
    } else if (typeof obj === 'object') {
        //pluck all of the subobject
        _.forIn(obj, function (val, key) {
            if (key === targetKey && obj.hasOwnProperty(key)) {
                //we matched the key and it's not a prototype, log the value
                acc.push(val);
            } else {
                //not the right key, checkpluck all from the value
                var res = self.pluckAllValues(val, targetKey);
                if (res)
                    acc.push(_.flatten(res));
            }
        });
    }
    return _.flatten(acc);
};

exports.EventMatcher = EventMatcher;