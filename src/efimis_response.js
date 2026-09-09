'use strict';

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value, key);

const getSuccessfulData = (result, operation) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`${operation} returned an invalid Efimis response.`);
  }

  if (result.success === false) {
    throw new Error(result.reason || `${operation} failed.`);
  }

  if (!hasOwn(result, 'data')) {
    throw new Error(`${operation} returned no data.`);
  }

  return result.data;
};

const getSuccessfulRows = (result, operation) => {
  const data = getSuccessfulData(result, operation);
  if (!data || !Array.isArray(data.rows)) {
    throw new Error(`${operation} returned an invalid row collection.`);
  }
  return data.rows;
};

module.exports = {
  getSuccessfulData,
  getSuccessfulRows,
};
