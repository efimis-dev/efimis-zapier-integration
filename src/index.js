const client_actions = require('./actions/client_actions');
const matter_actions = require('./actions/matter_actions');
const selectionResources = require('./actions/selection_resources');
const {
  config: authentication,
  befores = [],
  afters = [],
} = require('./authentication');
const events = require('./triggers/events');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  flags: {
    cleanInputData: false,
  },

  authentication,

  beforeRequest: [...befores],
  afterResponse: [...afters],

  triggers: {
    [events.key]: events,
  },
  searches: {
    ...matter_actions.searches.reduce((acc, action) => {
    acc[action.key] = action;
    return acc;
  }, {}),
    ...client_actions.searches.reduce((acc, action) => {
    acc[action.key] = action;
    return acc;
  }, {}),
  },
  creates: {
    ...matter_actions.creates.reduce((acc, action) => {
    acc[action.key] = action;
    return acc;
  }, {}),
  },

  resources: {
    ...selectionResources.resources.reduce((acc, resource) => {
      acc[resource.key] = resource;
      return acc;
    }, {}),
  },
}
