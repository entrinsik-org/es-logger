'use strict';

var EventMatcher = require('./event-matcher').EventMatcher;

function EventValidator(config){
    this.config = config;
    this.matcher = new EventMatcher();
}

/**
 * determines if the supplied hapiEvent (actually, it's our version of the hapiEvent) is allowed to
 * be pushed into elasticsearch based on the filters configured in the plugin opts. This function
 * specifically checks the eventType & tags of the event against the configured filters for those
 * keys to determine if the event is allowed to be logged.
 * This function also takes into account the global 'all' override which, when specified as a top-level
 * filter key, overrides all other configuration settings having control over what is allowed (does not
 * apply to the excludes configurations however)
 * @param entHapiEvent our version of a hapiEvent with all of the appropriate information we would want to log to elasticsearch
 * @returns {*}
 */
EventValidator.prototype.shouldLog = function (entHapiEvent) {
    var filterConfig = this.config.filters;
    if (!filterConfig || !entHapiEvent)
        return false;
    if (filterConfig.all)
        return Boolean(filterConfig.all);
    var eventTypeOK = (filterConfig.eventType && this.matcher.matchEventTypes(filterConfig.eventType, entHapiEvent));
    var tagsOK = (filterConfig.tags && this.matcher.matchTags(filterConfig.tags, entHapiEvent));
    return eventTypeOK || tagsOK;
};

/**
 * determines if the supplied event should override any inclusions specified in the plugin opts 'filters'
 * and be prevented from getting flushed to elasticsearch. this function gets the configured 'excludes'
 * and if there are any, checks if any of the excludes exist in the entHapiEvent.
 * Anything configured in the 'excludes' filter object overrides any other filters configurations
 * that would otherwise potentially allow an event to get logged to elasticsearch
 * @param entHapiEvent event to check. can be any type of event.
 * @returns {*}
 */
EventValidator.prototype.shouldExclude = function (entHapiEvent) {
    var filterConfig = this.config.filters;
    if(!filterConfig || !entHapiEvent || !filterConfig.excludes)
        return false;
    return this.matcher.matchExcludes(filterConfig.excludes, entHapiEvent);
};


exports.EventValidator = EventValidator;